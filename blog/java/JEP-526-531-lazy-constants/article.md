# Lazy Constants in Java: Deferred Initialization with JIT Constant Folding

## Content

- [Introduction](#introduction)
- [The Final Field Dilemma](#the-final-field-dilemma)
- [Enter Lazy Constants](#enter-lazy-constants)
- [Technical Deep Dive](#technical-deep-dive)
- [Performance Analysis](#performance-analysis)
- [Practical Examples](#practical-examples)
- [Migration Considerations](#migration-considerations)
- [Conclusions](#conclusions)
- [References](#references)

## Introduction

Most of us have written a holder class or a double-checked locking block at least once, just to initialize something lazily and safely. The Lazy Constants API, in its second preview in JDK 26 (JEP 526) and third preview in JDK 27 (JEP 531), offers a standard alternative, and, more interesting from a performance point of view, one that the JIT compiler can constant-fold.

A lazy constant is an object of type `java.lang.LazyConstant<T>` that holds a single value, computed at most once by a function supplied at construction and never modified afterwards. The JVM treats the content of a lazy constant as a true constant, which enables the same constant-folding optimizations that are otherwise reserved to `final` fields, while the moment of initialization is decoupled from the constructor or the class initializer. The JEP summarizes this as *deferred immutability*.

The API started its life in JDK 25 as `StableValue` (JEP 502), a rather low-level abstraction with explicit `trySet` and `orElseSet` methods. JDK 26 renamed and simplified it, and JDK 27 trimmed it further. The feature is still a preview API in both releases and requires `--enable-preview`.

## The Final Field Dilemma

Java developers are routinely advised to prefer immutability, and the main language tool for it is the `final` field. A `final` field, however, must be assigned eagerly: in the constructor for instance fields, or in the static initializer for static fields, and always in the textual order of the declarations. JEP 526 uses the example of a component that owns a logger:

```java
class OrderController {
    private final Logger logger = Logger.create(OrderController.class);
}
```

Creating a logger may involve reading configuration or preparing storage, so every `new OrderController()` pays that cost even if the instance never logs anything. When an application is composed of many such components, all declared as `static final` fields, startup time becomes the sum of all these eager initializations. The upside is that the JIT compiler trusts `static final` fields and can constant-fold reads through them.

The usual remedy is to give up `final` and initialize on demand, either with a plain `if (logger == null)` check, with the class-holder idiom, or with double-checked locking on a `volatile` field:

```java
class OrderController {
    private volatile Logger logger;

    public Logger getLogger() {
        Logger v = logger;
        if (v == null) {
            synchronized (this) {
                v = logger;
                if (v == null) {
                    logger = v = Logger.create(OrderController.class);
                }
            }
        }
        return v;
    }
}
```

Each of these alternatives has a cost, which the JEP lists under *Alternatives*. The plain mutable field introduces an invariant (all accesses must go through `getLogger()`) and is not safe under concurrency. The class-holder idiom works only for static fields and needs one additional class per lazily initialized value. Double-checked locking is correct, but the field is `volatile` and mutable, so the JIT cannot assume it will never change again and cannot fold the read; the same applies to `ConcurrentHashMap.computeIfAbsent`. For arrays of lazily initialized elements there is no such thing as a `volatile` element, and one must resort to `VarHandle.getVolatile` / `setVolatile` plus one mutex per index.

In other words, the language offers two extremes: `final` fields are constant-foldable but eagerly initialized, and mutable fields are flexibly initialized but opaque to the optimizer. The JDK itself has had a third option for years, the internal `@Stable` annotation, but it was not available to application code.

## Enter Lazy Constants

The public API after JDK 27 is deliberately small. `LazyConstant<T>` is a sealed interface extending `Supplier<T>` with a single abstract method `get()` and a single factory method, as declared in [`src/java.base/share/classes/java/lang/LazyConstant.java`](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/lang/LazyConstant.java):

```java
@PreviewFeature(feature = PreviewFeature.Feature.LAZY_CONSTANTS)
public sealed interface LazyConstant<T>
        extends Supplier<T>
        permits LazyConstantImpl {

    T get();

    static <T> LazyConstant<T> of(Supplier<? extends T> computingFunction) {
        Objects.requireNonNull(computingFunction);
        return LazyConstantImpl.ofLazy(computingFunction);
    }
}
```

The logger example becomes:

```java
class OrderController {
    private final LazyConstant<Logger> logger =
        LazyConstant.of(() -> Logger.create(OrderController.class));

    void submitOrder(User user, List<Product> products) {
        logger.get().info("order started");
    }
}
```

The first call to `get()` runs the computing function and stores the result; every subsequent call returns the same content. If several threads call `get()` concurrently on an uninitialized constant, exactly one of them runs the function and the others block until it finishes. The field holding the lazy constant stays `final`, so the reference to the holder is trusted by the JIT, and the content inside the holder is a stable value; together they make the whole chain constant-foldable once initialized.

JEP 526 positions lazy constants between the two kinds of fields: a `final` field is updated exactly once, eagerly, and is constant-folded; a `LazyConstant` is updated zero or one times, by the computing function, and is constant-folded after initialization; a non-final field is updated any number of times and is never constant-folded.

Three further factories cover aggregates of lazily initialized values, all backed by stable arrays rather than by individual `LazyConstant` objects:

- **`List.ofLazy(int size, IntFunction<? extends E> computingFunction)`**: A fixed-size list whose elements are computed independently, per index, on first access (`@since 26`).
- **`Map.ofLazy(Set<? extends K> keys, Function<? super K, ? extends V> computingFunction)`**: A map with a fixed key set known at construction, whose values are computed on first access of a given key (`@since 26`). When `keys` is an `EnumSet`, the implementation switches to an ordinal-indexed variant.
- **`Set.ofLazy(Set<? extends E> elementCandidates, Predicate<? super E> computingFunction)`**: A set whose membership status per candidate is computed on first `contains` (`@since 27`).

Both lists and maps reject `null` as a computed value, as does `LazyConstant` itself. This was a deliberate decision in JDK 26; a nullable result must be wrapped in an `Optional`.

## Technical Deep Dive

### The single implementation class

`LazyConstant` has exactly one permitted implementation, [`src/java.base/share/classes/jdk/internal/lang/LazyConstantImpl.java`](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/jdk/internal/lang/LazyConstantImpl.java). The code snapshot below shows its two fields and the fast path:

```java
@AOTSafeClassInitializer
public final class LazyConstantImpl<T> implements LazyConstant<T> {

    private static final Unsafe UNSAFE = Unsafe.getUnsafe();
    private static final long CONSTANT_OFFSET =
            UNSAFE.objectFieldOffset(LazyConstantImpl.class, "constant");

    @Stable
    private T constant;

    // Supplier until computed; null after success; exception class name after failure
    private volatile Object computingFunctionOrExceptionType;

    @ForceInline
    @Override
    public T get() {
        final T t = getAcquire();
        return (t != null) ? t : getSlowPath();
    }

    @ForceInline
    private T getAcquire() {
        return (T) UNSAFE.getReferenceAcquire(this, CONSTANT_OFFSET);
    }

    private void setRelease(T newValue) {
        UNSAFE.putReferenceRelease(this, CONSTANT_OFFSET, newValue);
    }
    // ...
}
```

The content lives in a non-final field annotated with `jdk.internal.vm.annotation.Stable`. It is written exactly once, through `Unsafe.putReferenceRelease`, and read with `Unsafe.getReferenceAcquire`. The implementation comments explain the choice: acquire/release is the cheapest way to establish a happens-before relation between the store of the content and later loads, which is what the API documentation promises (the content, including the `final` fields of any newly created objects, is safely published). A plain read would have sufficed only if the supplier were guaranteed to create a fresh object, and no such restriction exists.

The slow path takes care of at-most-once semantics and of failures:

```java
@DontInline
private T getSlowPath() {
    preventReentry();
    synchronized (this) {
        T t = getAcquire();
        if (t == null) {
            final Object cf = computingFunctionOrExceptionType;
            if (cf instanceof Supplier<?> computingFunction) {
                try {
                    final T newT = (T) computingFunction.get();
                    t = newT;
                    Objects.requireNonNull(t);
                    setRelease(t);
                    computingFunctionOrExceptionType = null;
                } catch (Throwable ex) {
                    final String exceptionType = ex.getClass().getName().intern();
                    computingFunctionOrExceptionType = exceptionType;
                    throw unableToAccessConstant(exceptionType, ex);
                }
            } else if (cf instanceof String exceptionType) {
                throw unableToAccessConstant(exceptionType, null);
            } // ...
        }
        return t;
    }
}

private void preventReentry() {
    if (Thread.holdsLock(this)) {
        throw new IllegalStateException("Recursive invocation of a LazyConstant's computing function: " + ...);
    }
}
```

A few observations are worth making:

- **Mutual exclusion**: The slow path synchronizes on the lazy constant itself; competing threads wait on the monitor, re-read the field, and never run the supplier a second time. Consequently, user code should not synchronize on a lazy constant.
- **Re-entrancy**: If the supplier calls `get()` on the same constant, `Thread.holdsLock(this)` is true and an `IllegalStateException` is thrown; it propagates out of the outer `computingFunction.get()`, is caught, and surfaces as a `NoSuchElementException` with the `IllegalStateException` as cause.
- **Null results**: `Objects.requireNonNull(t)` turns a `null` result into a `NullPointerException`, again wrapped in a `NoSuchElementException`.
- **Permanent error state**: After any failure the supplier is replaced by the interned class name of the exception (not the `Class` object, to avoid pinning a class loader), and all later `get()` calls throw `NoSuchElementException` without retrying. After success, the field is set to `null` so that the supplier and anything it captured become collectable.

### Lazy collections and stable arrays

The three collection factories delegate to [`src/java.base/share/classes/java/util/LazyCollections.java`](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/util/LazyCollections.java). A `LazyList` keeps its elements in a `@Stable private final E[] elements` array, and `AbstractLazyMap` keeps values in a `@Stable private final V[] values` array indexed either through an unmodifiable `Map<K, Integer>` (for arbitrary keys) or through `ordinal() - min` (for `EnumSet` keys, in `LazyEnumMap`). `LazySet` is a thin wrapper around `Map.ofLazy(elementCandidates, computingFunction::test)` whose `contains` is `map.getOrDefault(o, Boolean.FALSE)`.

The `@Stable` semantics on a one-dimensional array are what make this work: according to the Javadoc of [`src/java.base/share/classes/jdk/internal/vm/annotation/Stable.java`](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/jdk/internal/vm/annotation/Stable.java), both the array reference and each of its components are treated as independent stable variables, so a component that has become non-null can be folded individually while its neighbors remain uninitialized. The slow path (`orElseComputeSlowPath`) uses a lazily allocated per-index mutex, created with `Unsafe.compareAndExchangeReference` and replaced by a tombstone after use, and a `@Stable String[]` of exception class names per index, mirroring the single-value behavior. Once all indices have been computed, the mutex array and the function holder are released.

### How HotSpot folds the content

The final link is in the C2 compiler's view of fields, [`src/hotspot/share/ci/ciField.cpp`](https://github.com/openjdk/jdk/blob/master/src/hotspot/share/ci/ciField.cpp). The excerpt below decides whether a field may be treated as a compile-time constant:

```cpp
bool is_stable_field = FoldStableValues && is_stable();
if ((is_final() && !has_initialized_final_update()) || is_stable_field) {
  if (is_static()) {
    _is_constant = !fd->is_mutable_static_final();
  } else {
    // A final field should generally be constant, but reflection is allowed to subvert this
    // expection, so we only consider a final field constant if either it is strict, or it is one
    // of some special cases where we want constant folding
    _is_constant = is_strict() || is_stable_field || trust_final_nonstatic_fields(_holder);
  }
}
```

Two rules follow. First, a `@Stable` field is always a candidate for folding, static or not, but `ciField::constant_value` and `constant_value_of` return no constant while the observed value is still `null` or zero; this is the "null means not yet set" convention described in the `Stable` Javadoc, and the reason lazy constants cannot hold `null`. Second, a `final` *instance* field is trusted only in specific cases: `trust_final_nonstatic_fields` returns true for classes annotated with the internal `@TrustFinalFields` (used by `LazyList` and `AbstractLazyMap`), for a handful of JDK packages, for hidden classes and for records; otherwise it falls back to the experimental flag `TrustFinalNonStaticFields`, whose default is `false` in `src/hotspot/share/runtime/globals.hpp`. (`is_strict()` refers to strict fields, a newer mechanism not covered here.) The `FoldStableValues` flag defaults to `true`.

Therefore, for a read such as `Application.ORDERS.get().getLogger().get()` to fold completely, each hop must be trusted: a `static final` field, a record component, or a `final` field in a hidden class, down to a `@Stable` field that already holds a non-null value at compile time. A `LazyConstant` stored in a plain `final` instance field of an ordinary class is still thread-safe and initialized at most once, but the JIT will not fold through that field. The JEP states this limitation openly under *Risks and assumptions* and attributes it to core reflection being allowed to modify instance `final` fields.

## Performance Analysis

Neither JEP 526 nor JEP 531 publishes measurements, so no speed-up figure can be quoted. The JDK tree does contain JMH benchmarks under `test/micro/org/openjdk/bench/java/lang/stable/` (for instance `StableValueBenchmark.java`, which compares `LazyConstant` against double-checked locking, `AtomicReference`, a holder class and a record holder, in static and instance variants, with `--enable-preview` and `Threads.MAX`), but the sources do not ship any results.

Reasoning from the implementation, the costs are as follows:

- **Folded fast path**: When the lazy constant is reachable through trusted fields and was initialized before C2 compiled the caller, the read in `get()` disappears entirely; the content becomes an embedded constant, and any `null` check or `instanceof` on it can be eliminated as well.
- **Non-folded fast path**: Otherwise `get()` is a `@ForceInline` acquire load plus a null check. On x86 an acquire load is a plain load; on weaker architectures such as AArch64 it is a load-acquire instruction, which the implementation comment acknowledges as "a price (on certain platforms) on every `get()` operation that is not constant-folded".
- **First access**: One monitor acquisition, the supplier invocation, a release store and a volatile store. Threads that lose the race block on the monitor for the duration of the supplier.
- **Memory**: A `LazyConstantImpl` holds two references (the content and the supplier-or-marker). Lazy collections additionally carry a mutex array and a `String[]` for failures until all elements are computed. The content is strongly referenced for as long as the lazy constant is, which the API Javadoc flags as a potential source of unintended memory retention.

Constant folding happens at JIT compilation time. If the compiled method was produced while the constant was still uninitialized, the code keeps the acquire-load path until a recompilation occurs, exactly as `@Stable` behaves for JDK-internal code.

## Practical Examples

The examples below target JDK 26 or 27 with preview features enabled. The `Logger` type stands for any expensive dependency; it is not `java.util.logging.Logger`.

### 1. A lazily created dependency

```java
public final class OrderController {

    private final LazyConstant<Logger> logger =
            LazyConstant.of(() -> Logger.create(OrderController.class));

    public void submitOrder(String orderId) {
        logger.get().info("order " + orderId + " started");
        // ... business logic
        logger.get().info("order " + orderId + " submitted");
    }
}
```

The constructor of `OrderController` is now cheap, and the logger is created on the first `submitOrder` call by exactly one thread. Because `logger` is an instance field of an ordinary class, this variant is about deferred initialization and thread safety; full constant folding requires the holder to be reachable through trusted fields, as discussed above.

### 2. Lazy per-enum lookup with `Map.ofLazy` and a lazy pool with `List.ofLazy`

```java
import java.util.EnumSet;
import java.util.List;
import java.util.Map;

public final class Codecs {

    enum Format { JSON, XML, PROTOBUF }

    // One codec per format, created on first lookup; EnumSet keys select
    // the ordinal-indexed LazyEnumMap implementation
    static final Map<Format, Codec> CODECS =
            Map.ofLazy(EnumSet.allOf(Format.class), Codec::forFormat);

    // A fixed-size pool whose members are created only when their slot is first used
    static final int POOL_SIZE = 8;
    static final List<Encoder> ENCODERS =
            List.ofLazy(POOL_SIZE, _ -> new Encoder());

    public static byte[] encode(Format format, Object payload) {
        Encoder encoder = ENCODERS.get((int) (Thread.currentThread().threadId() % POOL_SIZE));
        return encoder.encode(CODECS.get(format), payload);
    }
}
```

`CODECS.get(Format.XML)` computes only the XML codec; `JSON` and `PROTOBUF` remain uninitialized until requested. A key outside the original set returns `null` from `get`, without invoking the function. Both collections are stored in `static final` fields, so after warm-up the JIT may fold the lookups for already computed entries.

### 3. Static fields and class-initialization order

With eager `static final` fields, the textual order of declarations matters. The following code compiles (the qualified name bypasses the illegal-forward-reference check) and yields an array whose single element is `null`:

```java
public final class Registry {
    static final Handler[] HANDLERS = { Registry.DEFAULT }; // DEFAULT is still null here
    static final Handler DEFAULT = new Handler("default");
}
```

With lazy constants, the static initializer only creates the holders, and the dependency is resolved at first use:

```java
import java.util.Map;

public final class Registry {
    static final LazyConstant<Map<String, Handler>> HANDLERS =
            LazyConstant.of(() -> Map.of("default", Registry.DEFAULT.get()));
    static final LazyConstant<Handler> DEFAULT =
            LazyConstant.of(() -> new Handler("default"));

    public static Handler handler(String name) {
        return HANDLERS.get().getOrDefault(name, DEFAULT.get());
    }
}
```

Nevertheless, two pitfalls remain. A genuine cycle (if `DEFAULT`'s supplier also called `HANDLERS.get()`) is detected by `preventReentry()` and fails deterministically with `NoSuchElementException`, unlike the silent `null` above. Furthermore, `LazyConstant.of(...)` itself still runs during `<clinit>`, and the API Javadoc reminds that a supplier which triggers initialization of another class remains subject to the class-initialization rules of JLS §12.4, including the classic initialization deadlock between two threads.

### 4. When the supplier may fail

```java
import java.util.NoSuchElementException;
import java.util.Optional;

public final class DataSourceHolder {

    // Any unchecked exception leaves the constant in a permanent error state
    private static final LazyConstant<DataSource> DATA_SOURCE =
            LazyConstant.of(() -> DataSource.connect(System.getenv("DB_URL")));

    // Alternative: capture the failure as part of the content so that callers can decide
    private static final LazyConstant<Optional<DataSource>> OPTIONAL_DATA_SOURCE =
            LazyConstant.of(() -> {
                try {
                    return Optional.of(DataSource.connect(System.getenv("DB_URL")));
                } catch (RuntimeException e) {
                    return Optional.empty();
                }
            });

    public static DataSource dataSource() {
        try {
            return DATA_SOURCE.get();
        } catch (NoSuchElementException e) {
            // e.getCause() is the original exception only on the first failing call
            throw new IllegalStateException("database unavailable", e);
        }
    }
}
```

A lazy constant models a value that, once computed, is correct forever. If a failure is transient and a retry is meaningful, either handle the retry inside the supplier before returning, or do not use a lazy constant for that value at all, because the API offers no reset.

## Migration Considerations

- **JDK versions and flags**: `LazyConstant`, `List.ofLazy` and `Map.ofLazy` are available in JDK 26 (`@since 26`); `Set.ofLazy` in JDK 27 (`@since 27`). All live in `java.base`, in `java.lang` and `java.util` respectively, so no `--add-modules` is needed. Compile with `javac --release 26 --enable-preview` (or `--release 27`) and run with `java --enable-preview`; the source launcher and `jshell` accept the same flag. Classes compiled with `--enable-preview` only run on the same feature release.
- **From JDK 25 (JEP 502) to JDK 26 (JEP 526)**: The type `StableValue` was renamed to `LazyConstant`. The low-level methods `orElseSet`, `setOrThrow` and `trySet` were removed, leaving only factories that take a computing function. The lazy list and map factories moved from `StableValue` to `List.ofLazy` and `Map.ofLazy`. The `function` and `intFunction` factories were removed in favor of lazy maps and lists. Returning `null` from a computing function became an error.
- **From JDK 26 (JEP 526) to JDK 27 (JEP 531)**: The methods `isInitialized()` and `orElse(T)` were removed, because they allowed usage inconsistent with the design goals (querying or bypassing initialization). `Set.ofLazy(Set, Predicate)` was added so that lazy variants exist for `List`, `Set` and `Map`. Code written against JDK 26 that called `isInitialized()` or `orElse()` must be revised; `toString()` remains available and never triggers initialization. JEP 547 re-previews the API in JDK 28 without changes.
- **Behavioral pitfalls**: The computing function runs under the lazy constant's monitor; never synchronize on a lazy constant yourself, and do not block indefinitely in a supplier, because every other caller blocks with you. Interruption does not cancel initialization. Content is strongly reachable for the lifetime of the constant. `LazyConstant` and the lazy collections are not `Serializable`. `equals` and `hashCode` are identity-based.
- **Performance expectations**: Full constant folding requires a chain of trusted fields (`static final`, record components, hidden-class `final` fields) ending at the lazy constant. A `LazyConstant` in a regular `final` instance field is still correct and cheap, but not folded. The JEP indicates that the long-term plan is to make all instance `final` fields trustworthy as part of integrity by default.

## Conclusions

- **Use `LazyConstant` where you would have written a holder class or double-checked locking**. It is shorter, cannot be initialized twice, publishes safely, and keeps the field `final`, which no mutable-field idiom achieves.
- **Prefer `static final` holders, records or lazy collections when the goal is JIT performance**. The thread-safety guarantees hold everywhere, but the constant-folding benefit depends on the trust rules in `ciField.cpp`, which exclude ordinary `final` instance fields today.
- **Treat failures as permanent and design suppliers accordingly**. There is no reset or retry; if a value can legitimately fail and recover, encode that in the content (for example via `Optional`) rather than relying on exceptions from `get()`.
- **Adoption recommendation**: In JDK 26 and 27 the API is a preview feature whose method set has already shrunk twice, so I would try it in non-production code, internal tools and benchmarks, and to postpone wide adoption until it is finalized. That said, the JDK 27 shape (a single `get()` plus three collection factories) is stable enough that code written against it should need little change later.

## References

- [JEP 526: Lazy Constants (Second Preview)](https://openjdk.org/jeps/526)
- [JEP 531: Lazy Constants (Third Preview)](https://openjdk.org/jeps/531)
- [OpenJDK Source: LazyConstantImpl.java](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/jdk/internal/lang/LazyConstantImpl.java)

---

**Tags**: Java, JDK 26, JDK 27, Lazy Constants, LazyConstant, Stable Values, Constant Folding, JIT Compilation, HotSpot, C2, Lazy Initialization, Immutability, Double-Checked Locking, Preview Features

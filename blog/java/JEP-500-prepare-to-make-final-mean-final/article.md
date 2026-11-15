# Making Final Mean Final: Preparing Java Code for Truly Immutable Final Fields

## Content

- [Introduction](#introduction)
- [The Final Field Mutation Problem](#the-final-field-mutation-problem)
- [Final Field Restrictions in JDK 26](#final-field-restrictions-in-jdk-26)
- [Technical Deep Dive](#technical-deep-dive)
- [Performance Analysis](#performance-analysis)
- [Practical Examples](#practical-examples)
- [Migration Considerations](#migration-considerations)
- [Conclusions](#conclusions)
- [References](#references)

## Introduction

Since JDK 5, any Java code has been able to reassign a `final` instance field through deep reflection, that is, by calling `Field.setAccessible(true)` followed by `Field.set(...)`. This capability was added so that third-party serialization libraries could reconstruct objects without calling their constructors, but it quietly turned `final` into a hint rather than a guarantee. Neither the developer reading the code nor the JIT compiler can fully trust that a final field keeps the value assigned in the constructor.

JEP 500, delivered in JDK 26, is the first step towards closing this gap. It does not remove any API. Instead, it issues a run-time warning the first time code in a module mutates a final field via deep reflection, introduces two new launcher options (`--enable-final-field-mutation` and `--illegal-final-field-mutation`), a matching JAR manifest attribute, and a JFR event. A future release will turn the warning into an `IllegalAccessException` by default.

The change is part of the broader "integrity by default" direction of the Java Platform (JEP draft 8305968), which already produced strong encapsulation of JDK internals in JDK 17 (JEP 403) and, in JDK 24, warnings for unsupervised native access (JEP 472) and for the memory-access methods of `sun.misc.Unsafe` (JEP 498). Application developers, library maintainers (serialization, dependency injection, mocking) and anyone interested in JVM performance are affected by it.

## The Final Field Mutation Problem

A final field is supposed to represent immutable state: it is assigned once, in a constructor for instance fields or in the class initializer for static fields, and never again. This expectation matters in two different ways.

The first is correctness. Since JDK 5, final fields have a special role in the Java Memory Model: once a constructor finishes, every thread that obtains a reference to the object is guaranteed to see the correctly initialized values of its final fields, without additional synchronization. Reasoning about thread safety of immutable objects relies on this. If a final field can be reassigned from anywhere in the program, that reasoning no longer holds.

The second is performance. The more constraints the JVM can rely on, the more optimizations it can apply. If the JIT compiler can trust that a final field is never reassigned, it can constant fold the value, which in turn enables further inlining and dead-code elimination. The JEP describes constant folding as "often the first step in a chain of optimizations that together can provide significant speedups".

The code snapshot below, adapted from the JEP, shows how little it takes to break both guarantees:

```java
class C {
    final int x;
    C() { x = 100; }
}

java.lang.reflect.Field f = C.class.getDeclaredField("x");
f.setAccessible(true);      // make C's final field mutable

C obj = new C();
System.out.println(obj.x);  // prints 100
f.set(obj, 200);
System.out.println(obj.x);  // prints 200
```

Because this is possible, HotSpot's C2 compiler does not, by default, trust final instance fields in ordinary classes. The decision is encoded in `src/hotspot/share/ci/ciField.cpp`, trimmed below:

```cpp
static bool trust_final_nonstatic_fields(ciInstanceKlass* holder) {
  if (holder == nullptr)
    return false;
  // ...
  // Even if general trusting is disabled, trust system-built closures in these packages.
  if (holder->is_in_package("java/lang/invoke") || holder->is_in_package("sun/invoke") ||
      holder->is_in_package("java/lang/reflect") || holder->is_in_package("jdk/internal/reflect") ||
      // ...
      holder->is_in_package("java/lang"))
    return true;
  // Trust hidden classes. They are created via Lookup.defineHiddenClass and
  // can't be serialized, so there is no hacking of finals going on with them.
  if (holder->is_hidden())
    return true;
  // Trust final fields in records
  if (holder->is_record())
    return true;
  return TrustFinalNonStaticFields;
}
```

Final fields in selected JDK packages, in hidden classes and in records are trusted precisely because deep reflection cannot mutate them (hidden classes were restricted in JDK 15, records in JDK 16). For every other class, the result falls back to `TrustFinalNonStaticFields`, an experimental flag declared in `src/hotspot/share/runtime/globals.hpp` with a default value of `false`. In other words, the vast majority of final instance fields written by application developers get no constant-folding benefit today, because the platform has to assume that some library may reassign them.

It is worth mentioning that the JEP rejects the alternative of relying purely on speculation (optimize optimistically and deoptimise when a mutation is detected), because future optimizations may depend on immutability across runs of the application, which speculation within a single process cannot provide.

## Final Field Restrictions in JDK 26

JDK 26 introduces the notion of *final field restrictions*. Mutating a final instance field via deep reflection is now considered *illegal* when either of the following holds:

- **No opt-in**: The code performing the mutation is in a module for which final field mutation has not been enabled.
- **Not deeply accessible**: The code is in a module to which the package of the declaring class is not statically open (or, for a public field in a public class, not statically exported).

In JDK 26 an illegal mutation still succeeds, but, by default, a warning such as the following is printed on the standard error stream the first time code in a given module performs one (this is the real output from JDK 26.0.2.1 for the example in the next sections):

```
WARNING: Final field timeoutMs in class FinalMutation$Config has been mutated reflectively by class FinalMutation in unnamed module @c387f44 (file:/.../)
WARNING: Use --enable-final-field-mutation=ALL-UNNAMED to avoid a warning
WARNING: Mutating final fields will be blocked in a future release unless final field mutation is enabled
```

When the mutation goes through `MethodHandles.Lookup.unreflectSetter` instead of `Field.set`, the first line says "has been unreflected for mutation" instead of "has been mutated reflectively".

Two launcher options control the behavior:

- **`--enable-final-field-mutation=M1,M2,...`**: Explicitly enables final field mutation for the named modules in the boot layer, or for all code on the class path via the special value `ALL-UNNAMED`. Enabling the capability for a module does not bypass the module system: the field must additionally be open to that module.
- **`--illegal-final-field-mutation=allow|warn|debug|deny`**: Selects what happens when an illegal mutation is attempted. `warn` (the default in JDK 26) prints at most one warning per module; `debug` prints a warning plus a stack trace for every mutation; `allow` is silent; `deny` makes `Field.set` throw `IllegalAccessException`. According to the JEP, `deny` will become the default in a future release, at which point `allow` will be removed, while `warn` and `debug` remain for at least one more release.

An important note to make is that `--add-opens` alone does not silence the warning. Opening a package grants deep reflection; it does not grant final field mutation. The two concerns are now separate.

The same opt-in can be expressed in several other ways: via `JDK_JAVA_OPTIONS`, via an argument file (`java @config`), via `jlink --add-options` when building a custom runtime, via the JNI Invocation API when embedding a JVM, or via the `Enable-Final-Field-Mutation: ALL-UNNAMED` attribute in the manifest of an executable JAR launched with `java -jar`. `ALL-UNNAMED` is the only value accepted in the manifest.

## Technical Deep Dive

The run-time logic lives almost entirely in `src/java.base/share/classes/java/lang/reflect/Field.java`. The public `set` method takes a separate path when the field is final and access checks have been suppressed with `setAccessible(true)`:

```java
@CallerSensitive
@ForceInline // to ensure Reflection.getCallerClass optimization
public void set(Object obj, Object value)
    throws IllegalArgumentException, IllegalAccessException
{
    if (!override) {
        Class<?> caller = Reflection.getCallerClass();
        checkAccess(caller, obj);
        getFieldAccessor().set(obj, value);
        return;
    }

    FieldAccessor fa = getOverrideFieldAccessor();
    if (!Modifier.isFinal(modifiers)) {
        fa.set(obj, value);
    } else {
        setFinal(Reflection.getCallerClass(), obj, () -> fa.set(obj, value));
    }
}
```

`setFinal` only applies the new checks to a final *instance* field declared in a *normal* class. Static final fields, and final fields in records or hidden classes, were already rejected by the field accessor before JDK 26, and this remains unchanged:

```java
private void setFinal(Class<?> caller, Object obj, FieldSetter setter) throws IllegalAccessException {
    if (obj != null && isFinalInstanceInNormalClass()) {
        preSetFinal(caller, false);
        setter.setFieldValue();
        postSetFinal(caller, false);
    } else {
        // throws IllegalAccessException if static, or field in record or hidden class
        setter.setFieldValue();
    }
}

private boolean isFinalInstanceInNormalClass() {
    return Modifier.isFinal(modifiers)
            && !Modifier.isStatic(modifiers)
            && !clazz.isRecord()
            && !clazz.isHidden();
}
```

`preSetFinal` implements the two conditions described earlier. It first verifies that the field is "deeply accessible" to the caller, using `Modules.isStaticallyOpened` and `Modules.isStaticallyExported`, which deliberately ignore packages opened at run time through `Module.addOpens`, `ModuleLayer.Controller.addOpens` or `Instrumentation.redefineModule`. It then consults the mode decoded at startup:

```java
// check if field mutation is enabled for caller module or illegal final field
// mutation is allowed
var mode = ModuleBootstrap.illegalFinalFieldMutation();
if (mode == ModuleBootstrap.IllegalFinalFieldMutation.DENY
        && !Modules.isFinalMutationEnabled(moduleToCheck(caller))) {
    throw new IllegalAccessException(callerNotAllowedToMutateMessage(caller, unreflect));
}
```

`postSetFinal` runs after the mutation has happened and is responsible for the diagnostics. The "at most one warning per module" rule is implemented in a compact way: in `warn` mode the code calls `Modules.tryEnableFinalMutation(module)`, a compare-and-set on a private `boolean enableFinalMutation` field of `java.lang.Module`. The first caller wins, prints the warning, and from that point on the module is treated as if it had been enabled on the command line. In `debug` mode a `StackWalker` appends the full stack trace, and in all modes a `jdk.FinalFieldMutation` JFR event is offered:

```java
var mode = ModuleBootstrap.illegalFinalFieldMutation();
if (mode == ModuleBootstrap.IllegalFinalFieldMutation.WARN) {
    // first mutation prints warning
    Module moduleToCheck = moduleToCheck(caller);
    if (Modules.tryEnableFinalMutation(moduleToCheck)) {
        String warningMsg = finalFieldMutationWarning(caller, unreflect);
        // ...
        VM.initialErr().printf("""
                WARNING: %s
                WARNING: Use --enable-final-field-mutation=%s to avoid a warning
                WARNING: Mutating final fields will be blocked in a future release unless final field mutation is enabled
                """, warningMsg, targetModule);
    }
} else if (mode == ModuleBootstrap.IllegalFinalFieldMutation.DEBUG) {
    // print warning and stack trace
    // ...
}
FinalFieldMutationEvent.offer(root);
```

The command-line options are decoded in `src/java.base/share/classes/jdk/internal/module/ModuleBootstrap.java`. The launcher (`src/java.base/share/native/libjli/java.c`) translates `--illegal-final-field-mutation` into the system property `jdk.module.illegal.final.field.mutation` and `--enable-final-field-mutation` into indexed properties `jdk.module.enable.final.field.mutation.<n>`; `ModuleBootstrap` reads and removes them during boot-layer initialization. An unrecognised mode value fails startup, and an unknown module name produces a warning rather than an error. The `Enable-Final-Field-Mutation` manifest attribute is handled in `src/java.base/share/classes/sun/launcher/LauncherHelper.java`, which aborts with "Error: illegal value ... Only ALL-UNNAMED is allowed" for any other value.

Method handles follow the same rules. In `src/java.base/share/classes/java/lang/invoke/MethodHandles.java`, `Lookup.unreflectField` calls back into `Field.checkAllowedToUnreflectFinalSetter(caller)` when a setter is requested for a non-static final field on a `Field` whose access checks were suppressed. Therefore the warning (or exception) is raised when the method handle is created, and not at each `invoke`. The list of affected "mutation methods" (`Field.set`, the eight primitive `setXxx` variants and `Lookup.unreflectSetter`) is documented in `src/java.base/share/classes/java/lang/reflect/doc-files/MutationMethods.html`.

Finally, the JFR event type is defined in `src/jdk.jfr/share/classes/jdk/jfr/events/FinalFieldMutationEvent.java`. It carries the declaring class and the field name, is enabled with stack traces in the default `default.jfc` profile, and its description is explicit that it "only represents a sample": the implementation offers the event on each mutation, but JFR may not record all of them.

## Performance Analysis

The JEP does not publish any benchmark numbers, and I did not find measurements in the JDK sources related to this change, so the discussion here is necessarily qualitative.

On the cost side, JDK 26 adds a few checks to a path that was already slow. `Field.set` on a final field with suppressed access checks now performs a module lookup, a static opens/exports check, a volatile read of a boolean flag and a JFR event offer. Code that mutates final fields in a hot loop would notice, but such code is unusual, and the JEP's position is that it should be rewritten anyway. The `debug` mode is considerably more expensive, since it walks the stack and prints on every mutation; it is intended for diagnosis, not for production.

On the benefit side, nothing improves in JDK 26 itself: `trust_final_nonstatic_fields` still returns `TrustFinalNonStaticFields` (default `false`) for ordinary classes. The gain is deferred to the release in which `deny` becomes the default. At that point the JVM can treat final instance fields in non-`Serializable` classes as permanently immutable and constant fold them, while continuing to assume that final fields in `Serializable` classes may be written by the `sun.reflect.ReflectionFactory` deserialization path. The JEP also hints that even some `Serializable` JDK classes (for example the unmodifiable collections, which deserialize through constructors) could be trusted when the JVM can prove the generated deserialization code does not write final fields.

## Practical Examples

The examples below were compiled and executed with JDK 26.0.2.1; the output shown is the actual output.

**Triggering the warning.** The simplest case is a class on the class path mutating its own final field:

```java
import java.lang.reflect.Field;

public class FinalMutation {

    static class Config {
        private final int timeoutMs;
        Config(int timeoutMs) { this.timeoutMs = timeoutMs; }
        int timeoutMs() { return timeoutMs; }
    }

    public static void main(String[] args) throws Exception {
        Config config = new Config(100);
        Field f = Config.class.getDeclaredField("timeoutMs");
        f.setAccessible(true);          // allowed, same module
        f.set(config, 200);             // JDK 26: warning printed here
        System.out.println(config.timeoutMs());
    }
}
```

```
$ java FinalMutation
WARNING: Final field timeoutMs in class FinalMutation$Config has been mutated reflectively by class FinalMutation in unnamed module @c387f44 (file:/.../)
WARNING: Use --enable-final-field-mutation=ALL-UNNAMED to avoid a warning
WARNING: Mutating final fields will be blocked in a future release unless final field mutation is enabled
200

$ java --enable-final-field-mutation=ALL-UNNAMED FinalMutation
200
```

**Locating the offender.** With `debug` the warning is followed by the stack trace, which identifies the exact call site. The same information is available as a JFR event without changing any option other than starting a recording:

```
$ java --illegal-final-field-mutation=debug FinalMutation
Final field timeoutMs in class FinalMutation$Config has been mutated reflectively by class FinalMutation in unnamed module @764c12b6 (file:/.../)
	at java.base/java.lang.reflect.Field.postSetFinal(Field.java:1534)
	at java.base/java.lang.reflect.Field.setFinal(Field.java:1449)
	at java.base/java.lang.reflect.Field.set(Field.java:909)
	at FinalMutation.main(FinalMutation.java:15)
200

$ java -XX:StartFlightRecording:filename=rec.jfr FinalMutation
$ jfr print --events jdk.FinalFieldMutation rec.jfr
jdk.FinalFieldMutation {
  declaringClass = FinalMutation$Config (classLoader = app)
  fieldName = "timeoutMs"
  eventThread = "main" (javaThreadId = 3)
  stackTrace = [
    FinalMutation.main(String[]) line: 15
  ]
}
```

**Testing against the future default.** Running with `deny` shows what the future behavior will be. The exception message names both the caller and the field:

```java
try {
    f.set(new Config(100), 200);
} catch (IllegalAccessException e) {
    System.err.println("Final field mutation denied: " + e.getMessage());
}
```

```
$ java --illegal-final-field-mutation=deny Detect
Final field mutation denied: class Detect (in unnamed module @c387f44) cannot set final field Detect$Config.timeoutMs (in unnamed module @c387f44), unnamed module @c387f44 is not allowed to mutate final fields
```

**Method handles.** `Lookup.unreflectSetter` is checked at creation time. The example below prints the "unreflected for mutation" variant of the warning once, and the subsequent `invoke` is silent:

```java
Field f = Holder.class.getDeclaredField("value");
f.setAccessible(true);
MethodHandle setter = MethodHandles.lookup().unreflectSetter(f);  // warning here
Holder h = new Holder("a");
setter.invoke(h, "b");                                            // no further check
```

**The safe alternative.** The recommended replacement for mutating final fields is to not mutate them: construct objects with the right values, derive new instances instead of changing existing ones, and inject dependencies through constructors. Records are a natural fit, since their canonical constructor is the only way to assign their components and deep reflection on record fields is rejected outright:

```java
record HttpSettings(Duration timeout, int maxRetries) {
    HttpSettings {
        if (maxRetries < 0) throw new IllegalArgumentException("maxRetries");
    }
    HttpSettings withTimeout(Duration newTimeout) {
        return new HttpSettings(newTimeout, maxRetries);
    }
}

static final class OrderService {
    private final PaymentGateway gateway;
    OrderService(PaymentGateway gateway) { this.gateway = gateway; }   // constructor injection
}
```

A test that previously injected a mock into a final field via reflection simply passes the test double to the constructor. No reflection, no warning, and the JIT compiler is free to trust the field.

It is crucial to understand that `sun.misc.Unsafe` is *not* an acceptable workaround. Its memory-access methods (`putInt`, `putReference` and friends) are deprecated for removal since JDK 23 (JEP 471) and already emit their own warnings since JDK 24 (JEP 498). Furthermore, the JEP states that there are no diagnostics at all for final field mutation through `Unsafe`, and that such mutations "may cause strange bugs or JVM crashes".

## Migration Considerations

**Affected versions.** The warning and the two options exist from JDK 26 onwards. This is a final (non-preview) feature; no `--enable-preview` or `--add-modules` flag is involved. On earlier releases the options are not recognized and the launcher will refuse to start.

**Who typically triggers it.** Application code rarely mutates final fields directly. The usual sources are:

- **Serialization libraries**: Frameworks that reconstruct objects without calling constructors and then write every field, including final ones.
- **Dependency injection with field injection**: Injecting into `private final` fields. Most DI frameworks already forbid or discourage this and recommend constructor injection.
- **Mocking and test utilities**: Helpers that replace a final collaborator inside an object under test.
- **`clone()` implementations**: Code that calls `super.clone()` and then fixes final fields reflectively. The JEP recommends a copy constructor or a static factory instead.

**What to do now.** Rule of thumb: run the test suite and a representative workload once with `--illegal-final-field-mutation=deny`, collect the exceptions (or use `debug` or JFR for a non-failing run), and fix or report each occurrence. If a dependency genuinely requires final field mutation, add `--enable-final-field-mutation=<module>` (or `ALL-UNNAMED`) to the launch configuration, exactly as you would add `--add-opens`, and treat it as technical debt to be removed when the library is updated.

**Guidance for library maintainers.** Under the integrity-by-default policy it is the application developer or deployer who grants the capability, not the library. A library cannot enable final field mutation for itself; the option only refers to modules in the boot layer and cannot target user-defined layers at all. Serialization libraries should move to the `sun.reflect.ReflectionFactory` API (`jdk.unsupported` module), which provides method handles such as `defaultReadObjectForSerialization(Class)` that assign fields, including final ones, in dynamically generated code without any opt-in. This API is limited to classes implementing `java.io.Serializable`, deliberately so that the JVM can trust final fields everywhere else.

**Pitfalls.** A few behaviors are easy to miss:

- `--add-opens` on its own no longer suffices; the warning concerns the *caller* module, not the field's module.
- `Module.addOpens` at run time does not make a field "deeply accessible" for final mutation, even if the receiving module is enabled on the command line.
- A `Field` made accessible in one module and handed to another is checked against the module that calls `set`, not the one that called `setAccessible`.
- In `warn` mode the first illegal mutation flips the module into the enabled state, so a single warning may hide further mutations by other classes in the same module. Use `debug` or JFR to see all of them.
- The `Enable-Final-Field-Mutation` manifest attribute only applies to `java -jar` and accepts `ALL-UNNAMED` exclusively.
- JNI `Set<type>Field` functions are not covered by these checks. HotSpot logs such writes at `-Xlog:jni=debug` (see `src/hotspot/share/prims/jni.cpp`) and warns under `-Xcheck:jni`; the JEP describes writes to final fields from JNI as undefined behavior.

## Conclusions

- **Audit now, not when `deny` becomes the default.** The flag `--illegal-final-field-mutation=deny` already exists and is cheap to add to a CI job. Finding the handful of libraries that mutate final fields today is considerably easier than debugging an `IllegalAccessException` in production after a JDK upgrade.
- **Prefer construction over mutation in your own code.** Records, canonical constructors, copy constructors and constructor injection cover virtually every legitimate use case that used to be solved by writing to a final field, and they are the only path that will eventually let the JIT compiler constant fold your final fields.
- **Treat `--enable-final-field-mutation` as a temporary waiver.** Like `--add-opens`, it records a known deficiency of a dependency on the command line. It is not a long-term solution, and `sun.misc.Unsafe` is an even worse one.
- **Expect a performance benefit later, not in JDK 26.** This JEP changes the contract first; the JVM optimizations that rely on the contract will follow once mutation is denied by default.

In my humble opinion, the adoption recommendation is straightforward: upgrade to JDK 26, keep the default `warn` mode in production, and run the test suite with `deny` from day one. Library users should report every warning upstream, and library maintainers should plan the move to constructor-based initialization or to `sun.reflect.ReflectionFactory` now, while the warning is still only a warning.

## References

- [JEP 500: Prepare to Make Final Mean Final](https://openjdk.org/jeps/500)
- [JEP draft 8305968: Integrity by Default](https://openjdk.org/jeps/8305968)
- [JEP 261: Module System](https://openjdk.org/jeps/261)
- [JEP 403: Strongly Encapsulate JDK Internals](https://openjdk.org/jeps/403)
- [JEP 471: Deprecate the Memory-Access Methods in sun.misc.Unsafe for Removal](https://openjdk.org/jeps/471)
- [JEP 472: Prepare to Restrict the Use of JNI](https://openjdk.org/jeps/472)
- [JEP 498: Warn upon Use of Memory-Access Methods in sun.misc.Unsafe](https://openjdk.org/jeps/498)
- [OpenJDK Source: java/lang/reflect/Field.java](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/lang/reflect/Field.java)
- [OpenJDK Source: java/lang/reflect/doc-files/MutationMethods.html](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/lang/reflect/doc-files/MutationMethods.html)
- [OpenJDK Source: java/lang/invoke/MethodHandles.java](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/lang/invoke/MethodHandles.java)
- [OpenJDK Source: java/lang/Module.java](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/lang/Module.java)
- [OpenJDK Source: jdk/internal/module/ModuleBootstrap.java](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/jdk/internal/module/ModuleBootstrap.java)
- [OpenJDK Source: sun/launcher/LauncherHelper.java](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/sun/launcher/LauncherHelper.java)
- [OpenJDK Source: sun/launcher/resources/launcher.properties](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/sun/launcher/resources/launcher.properties)
- [OpenJDK Source: java.base/share/man/java.md](https://github.com/openjdk/jdk/blob/master/src/java.base/share/man/java.md)
- [OpenJDK Source: libjli/java.c](https://github.com/openjdk/jdk/blob/master/src/java.base/share/native/libjli/java.c)
- [OpenJDK Source: jdk/jfr/events/FinalFieldMutationEvent.java](https://github.com/openjdk/jdk/blob/master/src/jdk.jfr/share/classes/jdk/jfr/events/FinalFieldMutationEvent.java)
- [OpenJDK Source: sun/reflect/ReflectionFactory.java](https://github.com/openjdk/jdk/blob/master/src/jdk.unsupported/share/classes/sun/reflect/ReflectionFactory.java)
- [OpenJDK Source: hotspot/share/ci/ciField.cpp](https://github.com/openjdk/jdk/blob/master/src/hotspot/share/ci/ciField.cpp)
- [OpenJDK Source: hotspot/share/runtime/globals.hpp](https://github.com/openjdk/jdk/blob/master/src/hotspot/share/runtime/globals.hpp)
- [OpenJDK Source: hotspot/share/prims/jni.cpp](https://github.com/openjdk/jdk/blob/master/src/hotspot/share/prims/jni.cpp)
- [JSR 133: Java Memory Model and Thread Specification](https://jcp.org/en/jsr/detail?id=133)

---

**Tags**: Java, JDK 26, Final Fields, Reflection, Integrity by Default, Immutability, Module System, JIT Compiler, Constant Folding, Serialization, Dependency Injection, JFR, HotSpot, Java Memory Model

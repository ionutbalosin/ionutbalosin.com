# Structured Concurrency in Java: Treating Related Tasks as a Single Unit of Work

## Content

- [Introduction](#introduction)
- [The Unstructured Concurrency Problem](#the-unstructured-concurrency-problem)
- [Enter StructuredTaskScope](#enter-structuredtaskscope)
- [Technical Deep Dive](#technical-deep-dive)
- [Performance Analysis](#performance-analysis)
- [Practical Examples](#practical-examples)
- [Migration Considerations](#migration-considerations)
- [Conclusions](#conclusions)
- [References](#references)

## Introduction

If you have ever fanned out a request with `ExecutorService` and `Future`, you have probably also leaked a thread or two when one of the subtasks failed. Structured concurrency, in its sixth preview in JDK 26 and seventh preview in JDK 27, addresses exactly this. Below I go through what `StructuredTaskScope` changes in practice, how it is implemented, and what differs between the two preview iterations.

Structured concurrency is a programming style in which a task that splits into concurrent subtasks must wait for all of them before it completes, so that the lifetime of every subtask is confined to a lexical block of its parent. The idea is borrowed from structured programming, where a method invoked from a block must return (or throw) to that block and cannot outlive it. In the JDK, the `java.util.concurrent.StructuredTaskScope` interface applies this discipline to threads by grouping the threads of related subtasks into a unit that can be joined, cancelled, and observed together.

The feature has been in incubation or preview since JDK 19. Although still in preview in JDK 26 and JDK 27, the main beneficiaries are already clear: server applications that fan out one request into several I/O-bound calls, typically on virtual threads.

## The Unstructured Concurrency Problem

The `ExecutorService` API, available since Java 5, allows any thread to submit work and any thread holding a `Future` to wait for its result. Below is the request-handling example from the JEP text, which fans out into two subtasks:

```java
Response handle() throws ExecutionException, InterruptedException {
    Future<String> user = executor.submit(() -> findUser());
    Future<Integer> order = executor.submit(() -> fetchOrder());
    String theUser = user.get();   // Join findUser
    int theOrder = order.get();    // Join fetchOrder
    return new Response(theUser, theOrder);
}
```

The relationship between `handle()` and its two subtasks exists only in the mind of the developer, not in the runtime. The JEP enumerates the consequences:

- **Thread leaks**: If `findUser()` throws, `handle()` fails at `user.get()`, but `fetchOrder()` keeps running in its own thread, wasting resources or interfering with other work.
- **Lost cancellation**: If the thread running `handle()` is interrupted, the interrupt is not propagated to the subtasks. Both of them continue to run after `handle()` has already failed.
- **Unnecessary waiting**: If `fetchOrder()` fails quickly while `findUser()` is slow, `handle()` still blocks on `user.get()` instead of cancelling it, and only afterwards does `order.get()` report the failure.
- **No observability**: A thread dump shows `handle()`, `findUser()` and `fetchOrder()` on unrelated threads, with no hint of the parent-child relationship.

All of this can be handled manually, with `try`/`finally` blocks, explicit `Future::cancel(boolean)` calls and an `ExecutorService` wrapped in `try`-with-resources. Nevertheless, this bookkeeping is error-prone and obscures the intent of the code, because `ExecutorService` and `Future` impose no constraints on which thread submits, which thread joins, and how long the work may run.

## Enter StructuredTaskScope

The structured version of the same method (shown in full as [Example 1](#practical-examples) below) opens a `StructuredTaskScope` in a `try`-with-resources statement, forks `findUser()` and `fetchOrder()` as subtasks, calls `join()` once, and then reads both results. The lifetime of both subtasks is confined to the body of the block, and the API guarantees the following properties: if either subtask fails, the other is cancelled (i.e., interrupted); if the owner thread is interrupted before or during `join()`, both subtasks are cancelled when the scope closes; and a thread dump shows the two threads as children of the scope.

### The API in JDK 27

The code snapshot below is the public surface of the interface, extracted from [StructuredTaskScope.java](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/util/concurrent/StructuredTaskScope.java) with the Javadoc removed:

```java
public sealed interface StructuredTaskScope<T, R, R_X extends Throwable>
        extends AutoCloseable permits StructuredTaskScopeImpl {

    static <T> StructuredTaskScope<T, Void, ExecutionException> open();
    static <T> StructuredTaskScope<T, Void, ExecutionException>
        open(UnaryOperator<Configuration> configOperator);
    static <T, R, R_X extends Throwable> StructuredTaskScope<T, R, R_X>
        open(Joiner<? super T, ? extends R, R_X> joiner);
    static <T, R, R_X extends Throwable> StructuredTaskScope<T, R, R_X>
        open(Joiner<? super T, ? extends R, R_X> joiner, UnaryOperator<Configuration> configOperator);

    <U extends T> Subtask<U> fork(Callable<? extends U> task);
    <U extends T> Subtask<U> fork(Runnable task);
    R join() throws R_X, InterruptedException;
    boolean isCancelled();
    void close();
}
```

The three type parameters are `T` (the result type of the forked subtasks), `R` (the result type of `join()`), and `R_X` (the exception type that `join()` may throw). The workflow is always the same: open a scope (the opening thread becomes the owner), fork subtasks, join them as a unit, process the outcome, and close the scope, usually via `try`-with-resources.

`Subtask<T>` extends `Supplier<T>` and exposes `state()`, `get()` and `exception()`, with `Subtask.State` being one of `UNAVAILABLE`, `SUCCESS` or `FAILED`. `Subtask::get()` does not block; calling it before `join()` has completed throws an `IllegalStateException`. This is deliberate: the scope blocks exactly once, in `join()`, and then processes results centrally.

### Joiners

The completion policy is encapsulated in a `StructuredTaskScope.Joiner<T, R, R_X>`. A joiner receives callbacks when a subtask is forked and when it completes, decides whether the scope should be cancelled, and produces the outcome of `join()`:

```java
interface Joiner<T, R, R_X extends Throwable> {
    default boolean onFork(Subtask<T> subtask);
    default boolean onComplete(Subtask<T> subtask);
    R result() throws R_X;
    R timeout() throws R_X;
}
```

The factory methods declared on `Joiner` cover the common cases:

- **`awaitAllSuccessfulOrThrow()`**: Waits for all subtasks; `join()` returns `null` or throws `ExecutionException` with the first failure as cause. This is the default policy used by `open()`, which is why the owner reads results from the `Subtask` objects.
- **`allSuccessfulOrThrow()`**: Same policy, but `join()` returns a `List<T>` of the results in fork order, useful when all subtasks return the same type.
- **`anySuccessfulOrThrow()`**: Cancels the scope as soon as one subtask succeeds and returns its result; throws `ExecutionException` if all subtasks fail.
- **`allUntil(Predicate<? super Subtask<T>> isDone)`**: Waits until all subtasks complete or the predicate returns `true` for a completed subtask, then returns a `List<Subtask<T>>` so the owner can inspect every state.

Each of the three `...OrThrow()` methods also has an overload accepting a `Function<Throwable, R_X>`, which allows `join()` to throw an application-specific exception instead of `ExecutionException`. A `Joiner` instance is stateful and must be created fresh for every scope; the JEP is explicit that joiners must never be shared or reused after a scope is closed.

### Configuration

The `open` overloads that accept a `UnaryOperator<Configuration>` allow three settings, defined in the sealed `Configuration` interface: `withThreadFactory(ThreadFactory)`, `withName(String)` and `withTimeout(Duration)`. The default thread factory is `Thread.ofVirtual().factory()`, so every subtask runs on a new virtual thread unless configured otherwise.

## Technical Deep Dive

The implementation consists of `StructuredTaskScopeImpl` and the package-private `Joiners` class in `java.util.concurrent`, plus `jdk.internal.misc.ThreadFlock`, the thread container that enforces the structure. Below I describe the main paths through [StructuredTaskScopeImpl.java](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/util/concurrent/StructuredTaskScopeImpl.java) and [ThreadFlock.java](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/jdk/internal/misc/ThreadFlock.java).

### The owner and the scope stack

Opening a scope creates a `ThreadFlock`, and `ThreadFlock.open(name)` pushes an internal `ThreadContainerImpl` onto the current thread's stack of `StackableScope` objects (see [StackableScope.java](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/jdk/internal/vm/StackableScope.java)). The thread that performs the push is recorded as the owner, and `StackableScope::push` throws `WrongThreadException` if any other thread tries it. The same check is applied by `StructuredTaskScopeImpl::ensureOwner`, which guards `fork`, `join` and `close`:

```java
private void ensureOwner() {
    if (Thread.currentThread() != flock.owner()) {
        throw new WrongThreadException("Current thread not owner");
    }
}
```

This stack of containers is what reifies the tree of scopes at run time: a scope opened inside a subtask has the forking thread's container as its parent, and `ThreadContainer::parent()` and `children()` (in [ThreadContainer.java](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/jdk/internal/vm/ThreadContainer.java)) can reconstruct the whole hierarchy.

### How fork creates and tracks a thread

`fork` first checks that the owner has not yet started joining (the scope keeps a small state machine: `ST_FORKED`, `ST_JOIN_STARTED`, `ST_JOIN_COMPLETED`, closed), wraps the `Callable` in a `SubtaskImpl` (which is also a `Runnable`), notifies the joiner via `onFork`, and then asks the thread factory for a thread:

```java
var subtask = new SubtaskImpl<U>(this, task);
if (j.onFork(subtask)) {
    cancel();
}
if (!cancelled) {
    Thread thread = threadFactory.newThread(subtask);
    if (thread == null) {
        throw new RejectedExecutionException("Rejected by thread factory");
    }
    subtask.setThread(thread);
    flock.start(thread);   // IllegalStateException if the flock is already shut down
}
```

`ThreadFlock::start` delegates to the internal `Thread.start(ThreadContainer)` method, which binds the new thread to the container, calls `container.add(thread)` (incrementing the flock's volatile `threadCount` and adding the thread to a `ConcurrentHashMap`-backed set) and inherits the scoped value bindings before starting the thread. When the subtask thread terminates, `onExit` decrements the counter and unparks the owner once it reaches zero.

### Scoped value inheritance

The `ThreadFlock` constructor captures a `ScopedValueContainer.BindingsSnapshot` of the owner's current `ScopedValue` bindings. When a subtask thread is started, `Thread::inheritScopedValueBindings` (in [Thread.java](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/lang/Thread.java)) installs that snapshot on the child, and verifies that the owner's bindings have not changed since the scope was opened:

```java
Object bindings = snapshot.scopedValueBindings();
if (currentThread().scopedValueBindings != bindings) {
    throw new StructureViolationException("Scoped value bindings have changed");
}
this.scopedValueBindings = bindings;
```

Therefore, a subtask reads exactly the same scoped values as its owner, with no copying, which is the integration point between this API and JEP 506.

### Completion, cancellation and sibling interruption

A subtask reports its outcome from `SubtaskImpl::run`. If the scope has already been cancelled, the result is discarded; otherwise it is stored and the joiner's `onComplete` is invoked on the subtask's own thread. When `onComplete` returns `true`, the scope cancels:

```java
private void cancel() {
    if (!cancelled && CANCELLED.compareAndSet(this, false, true)) {
        flock.shutdown();   // prevent new threads from starting
        interruptAll();     // interrupt all unfinished threads
        flock.wakeup();     // wakeup join
    }
}
```

This is the mechanism by which a failing subtask cancels its siblings. For example, `Joiners.AwaitSuccessful::onComplete` returns `true` only for the first `FAILED` subtask, recorded with a `VarHandle` compare-and-set on `firstException`; `Joiners.AnySuccessful::onComplete` returns `true` for the first `SUCCESS`. Cancellation is cooperative: it only interrupts the subtask threads, so a subtask blocked in a non-interruptible operation will delay the closing of the scope.

### join, timeouts and close

`join()` calls `ThreadFlock::awaitAll`, which parks the owner until the thread count drops to zero or a wakeup permit is set by `cancel()`. On return, it dispatches to the joiner:

```java
state = ST_JOIN_COMPLETED;
if (timeoutExpired) {
    cancel();                  // ensure cancelled before calling joiner
    return joiner.timeout();
} else {
    cancelTimeout();
    return joiner.result();
}
```

Timeouts are implemented without a dedicated thread: `scheduleTimeout` submits a task to `ForkJoinPool.commonPool().schedule(...)` that sets `timeoutExpired` and calls `cancel()` when the deadline passes.

Finally, `close()` cancels the scope if `join()` did not complete, and then calls `ThreadFlock::close`, which parks the owner in a loop until `threadCount` is zero, re-asserting (but not acting on) any interrupt it receives. This is the guarantee that no subtask thread outlives the scope. The flock then pops its container from the scope stack; if the container is not on top (for instance, because a nested scope was not closed), `popForcefully` closes the intervening scopes and `StructureViolationException` is thrown. Additionally, if the owner forked subtasks but never joined, `close()` throws `IllegalStateException("Owner did not join after forking")`.

### Observability

The JSON thread dump produced by `jcmd <pid> Thread.dump_to_file -format=json <file>` is generated by [ThreadDumper.java](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/jdk/internal/vm/ThreadDumper.java). It walks the containers from `ThreadContainers.root()` and writes, for each one, the `container` name, its `parent`, the `owner` thread identifier, the array of `threads` with their stack traces, and the `threadCount`; children follow their parent. The scope name set with `withName` is what appears in the `container` field (followed by the identity hash of the container). I could not find any dedicated JFR event for `StructuredTaskScope` in the JDK source tree; the thread dump and `HotSpotDiagnosticMXBean` are the observability channels described by the JEP.

## Performance Analysis

Neither JEP 525 nor JEP 533 publishes benchmarks, so below I only reason about the costs visible in the implementation.

- **One thread per subtask**: Each `fork` creates a new thread from the configured factory. With the default virtual thread factory this is cheap, which is the intended usage; with a platform thread factory the cost is that of creating an operating-system thread per subtask, and the API offers no pooling.
- **Bookkeeping per fork**: A `SubtaskImpl` allocation, insertion into a `ConcurrentHashMap` key set, an atomic increment of the flock's thread counter, and the scoped value snapshot check. The source comments the counter with "need to re-examine contention once API is stable", so it is a known point of contention for very wide fan-outs.
- **Synchronization on completion**: Joiners use `VarHandle` compare-and-set operations rather than locks, and `onComplete` executes on the subtask thread, so the owner is woken only once.
- **Timeouts**: Scheduled on the common `ForkJoinPool`, which avoids a dedicated timer thread but means a saturated common pool could, in theory, delay the timeout callback.

The overhead of the API is typically small compared to the I/O that the subtasks perform, but it is not designed for fine-grained CPU-bound parallelism; the JEP itself points to `ForkJoinPool` as the API designed for compute-intensive tasks.

## Practical Examples

All examples below compile against the JDK 27 API with `--enable-preview`. They assume `import java.util.concurrent.*;` and `import java.util.concurrent.StructuredTaskScope.*;`.

### Example 1: Fan-out with the default policy

```java
record Response(String user, int order) {}

Response handle() throws ExecutionException, InterruptedException {
    try (var scope = StructuredTaskScope.open()) {
        Subtask<String> user = scope.fork(() -> findUser());
        Subtask<Integer> order = scope.fork(() -> fetchOrder());

        scope.join();   // throws ExecutionException if either subtask failed

        return new Response(user.get(), order.get());
    }
}
```

The default `open()` uses `awaitAllSuccessfulOrThrow()`, so `join()` returns `null` and the results are read from the `Subtask` objects, which is the natural choice when the subtasks return different types.

### Example 2: Hedged requests with anySuccessfulOrThrow

```java
String fetchFromAnyReplica(List<URI> replicas, HttpClient client)
        throws ExecutionException, InterruptedException {
    try (var scope = StructuredTaskScope.open(Joiner.<String>anySuccessfulOrThrow())) {
        for (URI replica : replicas) {
            scope.fork(() -> client.send(
                    HttpRequest.newBuilder(replica).build(),
                    HttpResponse.BodyHandlers.ofString()).body());
        }
        return scope.join();   // first successful body; others are interrupted
    }
}
```

The first replica that answers wins, the remaining requests are interrupted, and `join()` throws `ExecutionException` only if every replica failed.

### Example 3: A custom best-effort Joiner

```java
final class BestEffortJoiner<T> implements Joiner<T, List<T>, RuntimeException> {
    private final Queue<T> results = new ConcurrentLinkedQueue<>();

    @Override
    public boolean onComplete(Subtask<T> subtask) {
        if (subtask.state() == Subtask.State.SUCCESS) {
            results.add(subtask.get());
        }
        return false;   // a failure never cancels the siblings
    }

    @Override
    public List<T> result() { return List.copyOf(results); }

    @Override
    public List<T> timeout() { return List.copyOf(results); }   // partial results
}

List<Quote> collectQuotes(List<Callable<Quote>> providers) throws InterruptedException {
    try (var scope = StructuredTaskScope.open(new BestEffortJoiner<Quote>(),
                                              cf -> cf.withTimeout(Duration.ofMillis(500)))) {
        providers.forEach(scope::fork);
        return scope.join();
    }
}
```

`onComplete` may be called concurrently from several subtask threads, hence the concurrent queue. Because `R_X` is `RuntimeException`, `join()` declares no checked exception apart from `InterruptedException`, and when the timeout expires the joiner returns whatever has been collected so far instead of throwing.

### Example 4: Configuration, named threads and exception handling

```java
final class PricingException extends Exception {
    PricingException(Throwable cause) { super(cause); }
}

List<Quote> priceAll(List<Callable<Quote>> providers) throws PricingException, InterruptedException {
    ThreadFactory factory = Thread.ofVirtual().name("pricing-", 0).factory();
    try (var scope = StructuredTaskScope.open(
            Joiner.<Quote, PricingException>allSuccessfulOrThrow(PricingException::new),
            cf -> cf.withName("pricing-scope")
                    .withThreadFactory(factory)
                    .withTimeout(Duration.ofSeconds(2)))) {
        providers.forEach(scope::fork);
        return scope.join();
    } catch (PricingException e) {
        if (e.getCause() instanceof CancelledByTimeoutException) {
            // deadline exceeded: all unfinished providers were interrupted
        }
        throw e;
    }
}
```

The `Function<Throwable, R_X>` overload turns the first failure into a `PricingException`; a timeout is reported through the same channel, with `StructuredTaskScope.CancelledByTimeoutException` as the cause. The scope name and the thread name prefix are what you will see in the JSON thread dump.

## Migration Considerations

### JDK versions and flags

`StructuredTaskScope` is a preview API in both releases, so it must be enabled explicitly: `javac --release 26 --enable-preview Main.java` and `java --enable-preview Main` on JDK 26, or `--release 27` on JDK 27 (the source launcher and `jshell` take the same `--enable-preview` flag). The API is in `java.util.concurrent`, which is exported by `java.base`, so no `--add-modules` option is required. As with every preview feature (JEP 12), class files compiled with `--enable-preview` are tied to that exact feature release and must be recompiled for the next one.

### What changed between the preview iterations

The following list is based on the "History" sections of the JEPs.

**JEP 505 (JDK 25) to JEP 525 (JDK 26)**, described as minor changes:

- `Joiner::allSuccessfulOrThrow()` returns `List<T>` of results instead of `Stream<Subtask<T>>`.
- A new `Joiner::onTimeout()` method allows a joiner to react when the timeout expires.

**JEP 525 (JDK 26) to JEP 533 (JDK 27)**, which is a source-incompatible change for most code written against JDK 26:

- `StructuredTaskScope` and `Joiner` gain a third type parameter, `R_X extends Throwable`, and `join()` now declares `throws R_X, InterruptedException`.
- The nested `StructuredTaskScope.FailedException` and `StructuredTaskScope.TimeoutException` are gone. The built-in joiners throw `ExecutionException` instead, and a timeout surfaces as an `ExecutionException` whose cause is the new `CancelledByTimeoutException`.
- New overloads `allSuccessfulOrThrow(Function)`, `anySuccessfulOrThrow(Function)` and `awaitAllSuccessfulOrThrow(Function)` let the caller choose the exception type.
- `Joiner.awaitAll()` has been removed; `allUntil(subtask -> false)` or a custom joiner covers that use case.
- `Joiner::onTimeout()` (a `void` callback) is replaced by `R timeout() throws R_X`, which must produce the result or throw.
- A new `open(UnaryOperator<Configuration>)` overload applies configuration with the default policy.

A practical consequence is that `catch (StructuredTaskScope.FailedException e)` blocks written for JDK 26 become `catch (ExecutionException e)` on JDK 27, and custom joiners must implement `timeout()`.

### Pitfalls

- **Owner confinement**: `fork`, `join` and `close` throw `WrongThreadException` when called from a thread other than the owner; forking after `join()` has started throws `IllegalStateException`.
- **Always join**: Exiting the block without calling `join()` after forking results in `IllegalStateException` from `close()`, after the subtasks have been cancelled and awaited.
- **Interruptible subtasks**: Cancellation is interrupt-based. Subtasks blocked in non-interruptible calls hold the owner in `close()` indefinitely.
- **Nesting**: Scopes must be closed in reverse order of opening; otherwise `StructureViolationException` is thrown. Rebinding a `ScopedValue` between opening the scope and forking throws the same exception.
- **Joiner reuse**: Never share a `Joiner` across scopes or reuse one after `close()`.

At the time of writing, the OpenJDK master branch already contains the commit implementing JEP 543, which finalizes the API in JDK 28. Comparing that commit with the JEP 533 one shows no change to the public interface of `StructuredTaskScope` beyond the removal of the preview annotations, so code written against JDK 27 should carry over.

## Conclusions

- **Adopt the pattern for request fan-out**: Any method that today submits two or more related tasks to an `ExecutorService` and joins them with `Future::get` is a candidate; the structured version is shorter and removes a class of leak and cancellation bugs by construction.
- **Choose the joiner before writing the subtasks**: The joiner determines the result type, the failure semantics and the exception type of `join()`. For me, the `R_X` type parameter introduced in JDK 27 is the most useful change of the two iterations, because it makes the exception contract of the scope visible in the signature.
- **Make subtasks interruptible**: Structured cancellation is only as good as the responsiveness of the subtasks to interrupts; audit blocking calls accordingly.
- **Target JDK 27, not JDK 26**: The sixth preview API is source-incompatible with the seventh; new code should be written against the JDK 27 shape, which the finalization commit in the OpenJDK repository leaves unchanged.

Since the feature is still in preview in both releases, I would use it in internal services rather than in published libraries, and to plan a recompilation for the finalized version.

## References

- [JEP 525: Structured Concurrency (Sixth Preview)](https://openjdk.org/jeps/525)
- [JEP 533: Structured Concurrency (Seventh Preview)](https://openjdk.org/jeps/533)
- [OpenJDK Source: StructuredTaskScopeImpl.java](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/util/concurrent/StructuredTaskScopeImpl.java)

---

**Tags**: Java, JDK 26, JDK 27, Structured Concurrency, StructuredTaskScope, Virtual Threads, Project Loom, Concurrency, Scoped Values, Preview Features, Thread Dumps, Java Concurrency

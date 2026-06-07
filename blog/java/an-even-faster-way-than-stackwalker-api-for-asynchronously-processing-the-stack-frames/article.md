# An even faster way than StackWalker API for asynchronously processing the stack frames

## Content

- [Context](#context)
- [Motivation](#motivation)
- [StackWalker vs. Thread::getStackTrace](#stackwalker-vs-threadgetstacktrace)
- [Is there any way to be faster than StackWalker API?](#is-there-any-way-to-be-faster-than-stackwalker-api)
- [Conclusions](#conclusions)

## **Context**

StackWalker API has been introduced in JDK 9 as part of [JEP 259](http://openjdk.java.net/jeps/259). It targets a flexible mechanism to traverse and materialize the required stack frames allowing efficient lazy access to additional stack frames when required.

Before this API (i.e. until JDK 9), there were a few other options to traverse the thread’s stack, as follows:

- **Throwable::getStackTrace** or **Thread::getStackTrace** which returns an array of StackTraceElement[] objects
- **SecurityManager::getClassContext** which allows a SecurityManager subclass to access the class context as well

However, they have the disadvantage of eagerly capturing the entire stack (i.e. all stack frames) since the API does not allow to filter nor to return only a subset of the frames in case the caller might be interested in only a few.

**StackWalker** API solves these issues by providing:

- lazy frames construction
- limits stack depth
- filters frames

## **Motivation**

In this context, the current article aims to test the performance between **Thread::getStackTrace** vs. **StackWalker** API. Besides that, it goes further by revealing a performance trick which outperforms the **StackWalker** API, suitable for cases when Throwable frames can be asynchronously processed.

## **StackWalker vs. Thread::getStackTrace**

Let’s first try to write a small benchmark which measures the performance of getting the current thread stack frame out of a recursive call when it reaches a specific stack depth. Roughly, it looks like this:

![](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/an-even-faster-way-than-stackwalker-api-for-asynchronously-processing-the-stack-frames/StackWalker-1024x648.png)

At this stage we are interested only in the top / current stack frame and not all the others, since we would like to spot the efficiency between the lazy mechanism of building the frames one by one (on demand, using StackWalker API) and the cost of eagerly fetching all of them using Thread::getStackTrace API, even if just one is a matter of interest.

```java
@BenchmarkMode(Mode.AverageTime)
@OutputTimeUnit(TimeUnit.NANOSECONDS)
@Warmup(iterations = 5, timeUnit = TimeUnit.NANOSECONDS)
@Measurement(iterations = 5, timeUnit = TimeUnit.NANOSECONDS)
@Fork(value = 3, warmups = 1)
@State(Scope.Benchmark)
public class StackWalkerJmh {

  @Param({ "1", "10", "100", "1000" })
  int stackDepth;

  public static void main(String[] args) throws RunnerException {
    Options opt = new OptionsBuilder()
      .include(StackWalkerJmh.class.getName())
      .build();
    new Runner(opt).run();
  }

  // StackWalker API

  @Benchmark
  public StackWalker.StackFrame stackWalker() {
    // return top StackFrame
    return recStackWalker(stackDepth);
  }

  private StackWalker.StackFrame recStackWalker(int depth) {
    if (depth == 0) {
      return getCurrentStackFrame_StackWalker();
    }
    return recStackWalker(depth - 1);
  }

  private StackWalker.StackFrame getCurrentStackFrame_StackWalker() {
    return StackWalker.getInstance()
      .walk(stream -> stream.findFirst())
      .orElseThrow(NoSuchElementException::new);
  }

  // Thread::getStackTrace

  @Benchmark
  public StackTraceElement getStackTrace() {
    // return top StackTraceElement
    return recGetStackTrace(stackDepth);
  }

  private StackTraceElement recGetStackTrace(int depth) {
    if (depth == 0) {
      return getCurrentStackFrame_GetStackTrace();
    }
    return recGetStackTrace(depth - 1);
  }

  private StackTraceElement getCurrentStackFrame_GetStackTrace() {
    StackTraceElement[] stackTrace = Thread.currentThread().getStackTrace();
      return Arrays.stream(stackTrace)
        .findFirst()
        .orElseThrow(NoSuchElementException::new);
    }
  }
}
```

I have tested above benchmark with JDK9.

```
Benchmark     (stackDepth) Mode Cnt Score Error Units

stackWalker              1 avgt 15 2,024.159 ± 116.055 ns/op
stackWalker             10 avgt 15 2,021.072 ± 35.285  ns/op
stackWalker            100 avgt 15 2,187.201 ± 47.090  ns/op
stackWalker           1000 avgt 15 4,528.044 ± 424.802 ns/op

getStackTrace            1 avgt 15 15,929.591 ± 2783.794   ns/op
getStackTrace           10 avgt 15 20,823.695 ± 380.626    ns/op
getStackTrace          100 avgt 15 73,061.360 ± 7668.810   ns/op
getStackTrace         1000 avgt 15 552,057.694 ± 31763.305 ns/op
```

*Tests triggered on my machine (CPU: Intel i7-6700HQ Skylake; MEMORY: 16GB DDR4 2133 MHz; OS: Ubuntu 16.04.2)*

##### Conclusions after this test scenario:

- **StackWalker** offers almost constant access time to current top frame for different stack depth sizes (e.g. 1, 10, 100, 1000)
  - NB: However, this cost might increase while walking through more and more frames
- **Thread::getStackTrace** cost seems proportional to the stack depth and is around one order of magnitude or even slower in comparison to StackWalker API, since getStackTrace has to always fill in the entire stack trace and converts it to a Java representation, even if only a few frames are inspected

## Is there any way to be faster than StackWalker API?

Maybe … let’s try the following approach: let’s asynchronously process (i.e. in another thread) Throwable frames generated by the **Throwable::new** and compare this with the synchronous **StackWalker** API.

In case of **StackWalker** API, the frames cannot be asynchronously processed! When StackWalker API collects the stack frames from a running thread, it first pauses the thread, collects the stack and then resumes the thread. The stream of frames cannot be returned and walked later on within another thread, it needs to be synchronous to invoking thread in order to lazily get information about the stack traces, otherwise, the stack would be in an inconsistent state.

Below is a graphical representation between the approach of generating a Throwable on Thread #1, dispatching it to Thread #2 for asynchronously processing the frames (i.e. minimizing the cost on Thread #1, hence improving the response time) versus **StackWalker** API which synchronously traverses backward the frames. ![](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/an-even-faster-way-than-stackwalker-api-for-asynchronously-processing-the-stack-frames/StackWalker2.png)

This time we are not anymore interested in only the top/current stack frame, but in iterating through more frames (using StackWalker API) to better spot the difference between these two approaches.

```java
@BenchmarkMode(Mode.AverageTime)
@OutputTimeUnit(TimeUnit.NANOSECONDS)
@Warmup(iterations = 5, timeUnit = TimeUnit.NANOSECONDS)
@Measurement(iterations = 5, timeUnit = TimeUnit.NANOSECONDS)
@Fork(value = 3, warmups = 1)
@State(Scope.Benchmark)
public class StackWalkerJmh {

  @Param({ "1", "10", "100", "1000" })
  int stackDepth;

  public static void main(String[] args) throws RunnerException {
    Options opt = new OptionsBuilder()
      .include(StackWalkerJmh.class.getName())
      .build();
    new Runner(opt).run();
  }

  // Throwable
  @Benchmark
  public Throwable justThrowable() {
    // return just Throwable for later processing
    return recThrowable(stackDepth);
  }

  private Throwable recThrowable(int depth) {
    if (depth == 0) {
      return new Throwable();
    }
    return recThrowable(depth - 1);
  }

  // Thread::getStackTrace

  @Benchmark
  public StackWalker.StackFrame stackWalker() {
    // return backwards Nth StackFrame
    return recStackWalker(stackDepth);
  }

  private StackWalker.StackFrame recStackWalker(int depth) {
    if (depth == 0) {
      return getBackNthStackFrame_StackWalker(stackDepth);
    }
    return recStackWalker(depth - 1);
  }

  private StackWalker.StackFrame getBackNthStackFrame_StackWalker(int numberOfSkippedFrames) {
    return StackWalker.getInstance()
      .walk(stream -> stream.skip(numberOfSkippedFrames - 1).findFirst())
      .orElseThrow(NoSuchElementException::new);
    }
  }
```

I have tested above benchmark with JDK9.

```
Benchmark      (stackDepth) Mode Cnt Score Error Units

justThrowException       1 avgt 15 1,389.484 ± 43.495    ns/op
justThrowException      10 avgt 15 1,734.414 ± 40.764    ns/op
justThrowException     100 avgt 15 6,156.689 ± 70.498    ns/op
justThrowException    1000 avgt 15 50,640.416 ± 2460.680 ns/op

stackWalker              1 avgt 15 1,722.361 ± 45.172     ns/op
stackWalker             10 avgt 15 5,478.675 ± 65.769     ns/op
stackWalker            100 avgt 15 33,282.748 ± 444.218   ns/op
stackWalker           1000 avgt 15 30,7625.182 ± 8019.638 ns/op
```

*Tests triggered on my machine (CPU: Intel i7-6700HQ Skylake; MEMORY: 16GB DDR4 2133 MHz; OS: Ubuntu 16.04.2)*

##### Conclusions after this test scenario:

- asynchronously processing Throwable frames (i.e. in another thread) is way faster than even using **StackWalker** API!
- in this approach, the load on Thread #1 is mitigated (i.e. it only pays the cost of creating the Throwable instance and filling in the stack trace, without generating the stack trace elements which is even more costly), hence giving a room for other things within the normal control flow of the application

As you might notice, this mechanism intentionally avoids the cost of generating the stack trace elements, leveraging it to another thread (e.g. Thread#2::getStackTrace() ), hence improving the response time for Thread #1. This trick is suitable for cases where the semantics of the business logic could be decoupled from frames processing. What it really matters is just to create the Throwable frames and to dispatch them for an asynchronous and complementary processing (e.g. logging, monitoring).

## Conclusions

- when there is a strong need to synchronously process stack frames within the caller thread (i.e. business logic depends on it, hence it cannot be decoupled), **StackWalker** API offers better performance in comparison to **Throwable::getStackTrace** or **Thread::getStackTrace** APIs
- if the stack frames can be asynchronously processed and it does not influence the normal control flow of the application, **StackWalker API** might not be the best fit! In such case, it looks more optimal, from a performance standpoint, to just create the Throwable frames and to process them on a different thread.

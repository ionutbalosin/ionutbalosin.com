# Getting the stack trace versus throwing an Exception. What is common and what is different

## Content

- [Motivation](#motivation)
- [A closer look inside Thread::getStackTrace API](#a-closer-look-inside-threadgetstacktrace-api)
- [What happens when throwing an Exception](#what-happens-when-throwing-an-exception)
- [Similarities](#similarities)
- [Differences](#differences)
- [Microbenchmark](#microbenchmark)
- [Conclusion](#conclusion)

## **Motivation**

At the first glance these two things (e.g. getting the stack traces and throwing an exception) might seem very unrelated, however, they are quite similar up to a certain extent in the way they behave under the hood. Current article aims to reveal such similarities and differences.

## A closer look inside **Thread::getStackTrace API**

If we dig inside JDK sources for **Thread::getStackTrace** method, we find below implementation:

```
public StackTraceElement[] getStackTrace() {
  if (this != Thread.currentThread()) {
    // first it checks for getStackTrace permission
    // then collects the stack traces
    // ...
  } else {
    // for current Thread
    return (new Exception()).getStackTrace();
  }
}
```

As the code reveals, under the hood **Thread::getStackTrace** creates an instance of Exception class and calls **getStackTrace()** method on that instance.

Now let’s move further and inspect what really happens when the Exception instance is created.

## What happens when throwing an Exception

When throwing an Exception (or any other Throwable derived class), the Exception class constructor dispatches the call to Throwable default constructor which fills in the stack trace, as per below JDK sources:

```
public Exception() {
  // default constructor dispatches the call to Throwable constructor
  super();
}

public Throwable() {
  // default constructor fills in the execution stack trace
  fillInStackTrace();
}
```

Now, having understood what happens under the hood, we can roughly describe similarities and differences between these two.

## **Similarities**

As we have already noticed, in both cases:

- a new Exception instance is created
- the current state of the stack frames for the actual thread is recorded in some internal representation (i.e. **fillInStackTrace()** method call)

## **Differences**

In addition to above similarities, **Thread::getStackTrace** translates the stack frames into a Java representation, returning a StackTraceElement[] array to the caller (i.e. **getStackTrace()** method call)

## Microbenchmark

I have created a short benchmark to test the performance between these two, even if they are not quite equivalent since one complements the other due to an extra operation.

```java
@BenchmarkMode(Mode.AverageTime)
@OutputTimeUnit(TimeUnit.NANOSECONDS)
@Warmup(iterations = 5, timeUnit = TimeUnit.NANOSECONDS)
@Measurement(iterations = 5, timeUnit = TimeUnit.NANOSECONDS)
@Fork(value = 3, warmups = 1)
@State(Scope.Benchmark)
public class GetStackTraceVsThrowExceptionJmh {

  public static void main(String[] args) throws RunnerException {
    Options opt = new OptionsBuilder()
      .include(GetStackTraceVsThrowExceptionJmh.class.getName())
      .build();
    new Runner(opt).run();
  }

  @Benchmark
  public Exception throwException() {
    return new Exception();
  }

  @Benchmark
  public StackTraceElement[] getStackTrace() {
    return Thread.currentThread().getStackTrace();
  }
}
```

I have tested above benchmark with JDK 10.0.1.

```
Benchmark          Mode Cnt Score Error Units

throwException     avgt 15 937.815 ± 46.736 ns/op
getStackTrace      avgt 15 10,512.959 ± 212.659 ns/op
```

*Tests triggered on my machine (CPU: Intel i7-6700HQ Skylake; MEMORY: 16GB DDR4 2133 MHz; OS: Ubuntu 16.04.2)*

## Conclusion

- **getStackTrace()** seems around 10x times slower than throwing an exception. This basically means that not filling the stack trace itself takes the majority amount of time, but converting it to a Java representation.

**NB:** What really happens when a stack trace is converted to a Java representation, is that Virtual Machine fills in the StackTraceElement[] array representation relying on a native method call, which is costly.

If throwing an exception is costly (i.e. creating the Exception instance and filling in the stack trace), collecting the exception stack trace is even heavier!

For normal applications, if these two operations can be split and asynchronously triggered (i.e. throwing the exception first and then, separately, collecting the stack trace within another thread) there might be an overall performance improvement for the normal execution flow!

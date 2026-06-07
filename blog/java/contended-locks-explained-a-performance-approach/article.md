# Contended locks explained – a performance approach

## Content

- [Context](#context)
- [Motivation](#motivation)
- [How it works under the hood. A bit of theory](#how-it-works-under-the-hood-a-bit-of-theory)
- [Microbenchmark](#microbenchmark)
- [Conclusions](#conclusions)

## Context

Improving the performance of contended Java object monitors was added in JDK 9 as part of the [JEP 143](http://openjdk.java.net/jeps/143). However, as JEP 143 states, it might not be an overall performance gain on every benchmark or every test, but rather it explores few areas related to contended Java monitors, as per below:

- Fast Java monitor enter/exit operations
- Fast Java monitor `notify`/`notifyAll` operations
- Speed up `PlatformEvent::unpark()`
- Field reordering and cache line alignment

## Motivation

Current article aims to provide further explanations about how contended locks work, under the hood, and to measure the performance using different contention degrees (i.e. different number of threads) with and without having this feature enabled.

## How it works under the hood. A bit of theory

**Uncontended locks** refer to the situation where there is a just a single thread T1 accessing a synchronized code section (e.g. method, a block of code). They are also called deflated or lightweight locks and it is implementable by a [Compare-And-Swap](https://en.wikipedia.org/wiki/Compare-and-swap) (CAS) operation which atomically stores a pointer within the Java object header to lock record (i.e. thread that owns that object)

As opposite, in case of **contended locks**, there is at least one more thread T2 that wants to enter the same synchronized code section which is already locked by previous thread T1.

Contended locks are associated with a heavy weight locking scheme, also known as inflated locks, in order to handle multiple threads trying to acquire the same monitor. Contended locks do not use anymore CAS operations, as in case of uncontended locks, however, they follow the slow path. This mechanism uses a ‘**WaitSet**‘ queue which contains the set of threads waiting for the same contended lock. When a new thread has to go into the waiting state (i.e. Object.wait()), it is enqueued in the ‘**WaitSet**‘ and dequeued later on, as a result of an Object.notify() or Object.notifyAll(), being able to get the object monitor.

![](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/contended-locks-explained-a-performance-approach/MonitorLocks-1.png)

All the above cover the fundamentals from Java 8 in regards to contended locks (usually done in the slow path). Now, let’s see where the improvements from Java 9 fit into the picture, in comparison previous version.

![](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/contended-locks-explained-a-performance-approach/MonitorLocks-2.png)

Prior Java 9, in case of contended locks, when a thread attempts to get into the object monitor (e.g. ObjectMonitor::enter) it follows the slow path (e.g. ObjectMonitor::slow\_enter). Starting Java 9, there is not anymore the slow path, instead, the thread takes the quick path (e.g. ObjectMonitor::quick\_enter). Basically, if the lock is already inflated and there are few threads going to access the monitor, there is no need to keep the threads in the **‘WaitSet’** queue, but rather transferring them directly to the monitor queue. Normally, in the slow path, the threads are enqueued in the **‘WaitSet’** which takes extra CPU cycles, hence impacting the performance. But since the threads are waiting for the monitor and the lock is already inflated, it does not make sense to go via **‘WaitSet’** anymore**!**

## Microbenchmark

The benchmark creates a number of threads which shares the same instance of a LockedClass. Within the synchronized method I have added a “wired” heavy computation (i.e. using the volatile) just for the sake of this test (you can easily replace it with something else; e.g. computing digits of PI formula if you want a more realistic example).

```java
@BenchmarkMode(Mode.AverageTime)
@OutputTimeUnit(TimeUnit.MICROSECONDS)
@Warmup(iterations = 5, timeUnit = TimeUnit.MICROSECONDS)
@Measurement(iterations = 5, timeUnit = TimeUnit.MICROSECONDS)
@Fork(value = 3, warmups = 1, jvmArgsAppend = { "-XX:-UseBiasedLocking", "-XX:+UseHeavyMonitors"})
public class ContendedLockJmh {

  private static final int NUMBER_OF_THREADS = 1; // 2, 4, 6, 8, 16, 32, 64, 128, 256, 512, 1024

  @State(Scope.Group)
  public static class Contended {
    final LockedClass lockedClass = new LockedClass();
  }

  public static void main(String[] args) throws RunnerException {
    Options opt = new OptionsBuilder()
      .include(ContendedLockJmh.class.getName())
      .verbosity(VerboseMode.SILENT)
      .build();
    new Runner(opt).run();
  }

  @Benchmark
  @Group("contendedSynchronizedMonitor")
  @GroupThreads(NUMBER_OF_THREADS)
  public long contended(Contended state) {
    return state.lockedClass.methodWithSynchronisation(state.lockedClass.loop_count);
  }
}
```

```java
public class LockedClass {

  public int loop_count = 50;

  private long t = System.nanoTime();
  private volatile long consumeCPU = 0;

  public synchronized long methodWithSynchronisation(int count) {
    for (long i = count; i > 0; i--) {
      t += ((t * 0x5DEECE66DL) + 0xBL + i) & (0xFFFFFFFFFFFFL);
      consumeCPU += t;
    }

    return t;
  }
}
```

I have tested above benchmark with JDK9 plus few variants (from test case to test case):

- changing the number of threads (e.g. 1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024)
- using default JVM settings (e.g. but enabling biased locking from the very beginning: **-XX:BiasedLockingStartupDelay=0**) – corresponds to test lines with an empty Type
- explicitly enabling heavy monitors but disabling biased locking (e.g. **-XX:-UseBiasedLocking -XX:+UseHeavyMonitors**) – corresponds to test lines with **w/ HM** Type

```
Threads   Benchmark        Mode Cnt Score Error Units

1         contended        avgt 15 0.374 ± 0.005 us/op
    w/ HM contended        avgt 15 0.405 ± 0.017 us/op
2         contended        avgt 15 1.719 ± 0.815 us/op
    w/ HM contended        avgt 15 2.159 ± 1.318 us/op
4         contended        avgt 15 3.912 ± 1.362 us/op
    w/ HM contended        avgt 15 4.203 ± 2.603 us/op
8         contended        avgt 15 10.794 ± 5.513 us/op
    w/ HM contended        avgt 15 18.277 ± 25.684 us/op
16        contended        avgt 15 1,133.623 ± 4,389.130 us/op
    w/ HM contended        avgt 15 4,284.792 ± 8,732.043 us/op
32        contended        avgt 15 5,362.932 ± 6,045.964 us/op
    w/ HM contended        avgt 15 9,996.652 ± 9,005.011 us/op

64        contended        avgt 15 35,048.471 ± 50,793.008 us/op
    w/ HM contended        avgt 15 31,627.919 ± 31,488.143 us/op
128       contended        avgt 15 52,024.745 ± 39,303.902 us/op
    w/ HM contended        avgt 15 50,096.647 ± 95,171.028 us/op
256       contended        avgt 15 99,485.189 ± 51,333.013 us/op
    w/ HM contended        avgt 15 74,472.854 ± 37,900.718 us/op
512       contended        avgt 15 218,215.346 ± 149,315.838 us/op
    w/ HM contended        avgt 15 184,838.906 ± 55,941.599 us/op
1024      contended        avgt 15 505,467.472 ± 542,766.418 us/op
    w/ HM contended        avgt 15 189,070.848 ± 161,995.343 us/op
```

*Tests triggered on my machine (CPU: Intel i7-6700HQ Skylake; MEMORY: 16GB DDR4 2133 MHz; OS: Ubuntu 16.04.2)*

## Conclusions

- contended locks offer better performance when the number of contended threads is significantly higher. For example, in my test case it started with 64 threads, however, a bigger difference is spotted for 1024 threads (e.g. around 3x times better with heavy monitors enabled)
- for relatively small contention, JVM default parameters (i.e. without heavy monitors and with biased locking enabled) seems more appropriate, no need to explicitly enable heavy monitors

##### Further references

- [Java 9: Beyond Contention – Monica Beckwith](https://www.youtube.com/watch?v=TRGRnCAF4iQ)
- [Synchronization and Object Locking](https://wiki.openjdk.java.net/display/HotSpot/Synchronization)

UPDATE: As per comment from [Alexandru Nedel](https://ro.linkedin.com/in/anedel), I have updated “**PI Calculus**” with “**computing digits of** PI”!

---

**Tags**: Java, Concurrency, Locks, Synchronized, Lock Contention, JVM, HotSpot, Performance, JMH, Microbenchmark, Lock Optimization, Synchronization, Java Concurrency

# onSpinWait() method from Thread class

## Content

- [Introduction](#introduction)
- [Usage](#usage)
- [Other Alternatives](#other-alternatives)
- [Benchmark](#benchmark)
- [Might not be available for all architectures!](#might-not-be-available-for-all-architectures)

## Introduction

The purpose of this article is to describe new method **onSpinWait()** added to Thread class in [JDK 9](https://docs.oracle.com/javase/9/docs/api/java/lang/Thread.html#onSpinWait--), including its usage, the pros and cons and also covering few other alternatives.

**onSpinWait()** was part of [JEP 285](http://openjdk.java.net/jeps/285) to allow Java code to hint CPU there is a busy-waiting loop that may burn few CPU-cycles waiting for something to happen. CPU can assign more resources to other threads, without actually invoking the OS scheduler to dequeue another thread (which may be expensive).

Thread calling onSpinWait() does not give up a time slice, it just delays the next instruction’s execution for a finite period of time. By delaying the execution of the next instruction the processor is not under demand, it emits fewer instructions in the pipeline, hence parts of it are no longer being used which in turn reduces the power consumed by the processor! The number of cycles delayed may vary from one processor family to another.

## Usage

**onSpinWait()** best fits when:

- a thread is waiting for an external condition or events to occur, which might happen very frequently (i.e. at a high rate)
- and the events finish (or last) very quickly, hence the thread should not wait for a long period of time

##### Pseudocode Pattern:

```
// busy waiting until condition is satisfied
// NB: condition happen very frequently
while (condition_not_satisfied) {
  Thread.onSpinWait();
}

do_real_work();
```

Taking into account the events happen very frequently, it is worth it to keep the CPU slice, since the cost of being rescheduled overweight the benefit. Usually, when a thread is rescheduled there is an increased number of context switches at a high latency cost. **onSpinWait()** tries to mitigate such cost but also reducing the power consumption.

Once classical example relates to Producer-Consumer pattern, where the Producer produces items at a high rate (very frequently) and signals the Consumer to consume them.

```
// PRODUCER
for (long i = 0; i < total_items; i++) {
  while (!ready_to_produce()) {
    Thread.onSpinWait();
  }
  produce_item(); // produces item and signals the Consumer
}

signal_finish(); // is_running = false
```

```
// CONSUMER
while (is_running) {
  while (!ready_to_consume()) {
    Thread.onSpinWait();
  }
  consume_item(); // consumes item and signals the Producer
}
```

Full code listing based on Producer-Consumer patter can be found on Gil Tene’s [repository](https://github.com/giltene/GilExamples/tree/master/SpinWaitTest).

## Other Alternatives

Sometimes, depending on the context problem, the same behavior could be simulated using other APIs alternatives, as below. However,  all of them have some disadvantages and might prove less efficient:

- **yield()**
  - it allows the OS scheduler to choose any other Thread that is ready to run (based on thread priorities) or still keep on running current Thread without switching it in and out
- **sleep()**
  - current Thread is forcefully switched out (i.e. context switching) and put in the timed waiting state, regardless of thread priority or processor residency. Once the sleep interval is over, the Thread is scheduled back to the execution.
- **wait()** – **notify()**
  - OS scheduler moves current Thread to the wait queue. When the notify happens, OS scheduler move the Thread to the run queue to be scheduled when possible

Just for information, a context switch might cost something around 5,000 cycles, so getting switched out and switched back in means that CPU has wasted around 10,000 cycles of overhead!

## Benchmark

I wrote a small benchmark to test the performance between onSpinWait() vs. yield(). vs sleep().

```java
@BenchmarkMode(Mode.AverageTime)
@OutputTimeUnit(TimeUnit.MICROSECONDS)
@Warmup(iterations = 5, timeUnit = TimeUnit.MICROSECONDS)
@Measurement(iterations = 5, timeUnit = TimeUnit.MICROSECONDS)
@Fork(value = 5, warmups = 1)
@State(Scope.Benchmark)
public class OnSpinWaitJmh {

  public static void main(String[] args) throws RunnerException {
    Options opt = new OptionsBuilder()
      .include(OnSpinWaitJmh.class.getName())
      .verbosity(VerboseMode.SILENT)
      .build();
    new Runner(opt).run();
  }

  @Param({"1024"})
  public Integer iterations;

  @Benchmark()
  public long onSpinWait() {
    int i = 0, sum = 0;
    while (i++ < iterations) {
      Thread.onSpinWait();
      sum += 10;
    }
    return sum;
  }

  @Benchmark()
  public long yield() {
    int i = 0, sum = 0;
    while (i++ < iterations) {
      Thread.yield();
      sum += 10;
    }
    return sum;
  }

  @Benchmark()
  public long sleep() throws InterruptedException {
    int i = 0, sum = 0;
    while (i++ < iterations) {
      Thread.sleep(1);
      sum += 10;
    }
    return sum;
  }
}
```

I have tested above benchmark with JDK9.

```
Benchmark  (iterations) Mode Cnt Score Error Units

onSpinWait        1024 avgt 25 47.189 ± 0.411 us/op
onSpinWait:·cpi   1024 avgt 0.016 CPI

yield             1024 avgt 25 143.475 ± 4.729 us/op
yield:·cpi        1024 avgt 0.552 CPI

sleep             1024 avgt 25 1,182,968.288 ± 20278.101 us/op
sleep:·cpi        1024 avgt 2.388 CPI
```

It is also important to capture the number of context switches per each test, which are signs of the overhead:

```
context-switches  score

onSpinWait        207
yield             220
sleep           5,640
```

*Tests triggered on my machine (CPU: Intel i7-6700HQ Skylake; MEMORY: 16GB DDR4 2133 MHz; OS: Ubuntu 16.04.2)*

Few conclusions:

- **onSpinWait** performs better in terms of both average time and number of context switches
- **yield** is almost 10x times slower in comparison to **onSpinWait** in regards to average time. Also, there is more number of context switches, hence running Thread is at the mercy at the OS scheduler which decides either to keep it running or to de-schedule it in favor of others
- **sleep** is the worse. An important metric is the number of context switches which is significantly higher in comparison to other two, due to the fact OS scheduler always decides to de-schedule running thread.

## Might not be available for all architectures!

**onSpinWait()** relies on **PAUSE** x86 assembly instruction. However, for other architectures, it might not work as expected! For example, at the time of writing this article there is [JDK-8159532](https://bugs.openjdk.java.net/browse/JDK-8159532) task raised in order to find an appropriate intrinsic for SPARC architectures, hence try to use it carefully on daily basis!

##### Further References:

- [Notify… oh, wait! I have a signal.](http://jpbempel.blogspot.com/2015/07/notify-oh-wait-i-have-signal.html)
- [Benefitting Power and Performance Sleep Loops](https://software.intel.com/en-us/articles/benefitting-power-and-performance-sleep-loops)

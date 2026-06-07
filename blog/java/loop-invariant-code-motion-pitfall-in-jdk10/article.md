# Loop invariant code motion pitfall in JDK10

Current article illustrates a corner case in regards to [loop invariant code motion](https://en.wikipedia.org/wiki/Loop-invariant_code_motion) optimization in JDK10, which at first glance seems to regress in comparison to JDK9. Such optimization tries to move outside the body of a loop statements or expressions which do not depend on the loop itself, without affecting the overall semantics of the program.

I have created a small benchmark which contains a loop of 200,000 iterations that computes, at each iteration, the length of a circle (e.g. **2πR**) modulo iteration counter and sums all intermediate results. The **R** is the radius of the arc (i.e. a constant in our case) and the **π** is computed based on explicit math computation formula (not using the [Math.PI](https://docs.oracle.com/javase/10/docs/api/java/lang/Math.html#PI) constant).

Apart base scenario, I also added similar benchmark test cases which contain superfluous loop invariant Pi computation formula only to stress the Just in Time Compiler and to check how it can optimize them. Please find the entire source code below.

```java
@BenchmarkMode(Mode.AverageTime)
@OutputTimeUnit(TimeUnit.MILLISECONDS)
@Warmup(iterations = 5, timeUnit = TimeUnit.MILLISECONDS)
@Measurement(iterations = 5, timeUnit = TimeUnit.MILLISECONDS)
@Fork(value = 3, warmups = 1)
@State(Scope.Benchmark)
public class LoopInvariantCodeJmh {

  @Param({ "200000" })
  public int iterations;

  @Param({ "42" })
  public int radius;

  public static void main(String[] args) throws RunnerException {
    Options opt =
    new OptionsBuilder()
      .include(LoopInvariantCodeJmh.class.getSimpleName())
      .build();
    new Runner(opt).run();
  }

  @Benchmark
  // Benchmark method containing 10 loop invariant computePi() method calls per iteration
  public double circleLengthModulo_10x() {
    double sum = 0;
    for (int i = 0; i < iterations; i++) {
      // 10 loop invariant method calls -> stresses the Compiler
      computePi(); // 1st
      computePi(); // 2nd
      computePi(); // 3rd
      computePi(); // 4th
      computePi(); // 5th
      computePi(); // 6th
      computePi(); // 7h
      computePi(); // 8th
      computePi(); // 9th
      computePi(); // 10th
      // compute circle length modulo i -> this really matters !
      sum += (2 * radius * computePi()) % i;
    }
    return sum;
  }

  @Benchmark
  // Benchmark method containing 5 loop invariant computePi() method calls per iteration
  public double circleLengthModulo_5x() {
    double sum = 0;
    for (int i = 0; i < iterations; i++) {
      // 5 loop invariant method calls -> stresses the Compiler
      computePi(); // 1st
      computePi(); // 2nd
      computePi(); // 3rd
      computePi(); // 4th
      computePi(); // 5th
      // compute circle length module i -> this really matters !
     sum += (2 * radius * computePi()) % i;
    }
    return sum;
  }

  @Benchmark
  public double circleLengthModulo() {
    double sum = 0;
    for (int i = 0; i < iterations; i++) {
      // compute circle length module i -> this really matters !
      sum += (2 * radius * computePi()) % i;
    }
    return sum;
  }

  private double computePi() {
    double Pi = 4;
    boolean sign = false;

    // Pi / 4 = 1 - (1/3) + (1/5) - (1/7) + (1/9) - (1/11) + ...
    // Math.Pi = 3.14159265358979323846

    for (int i = 3; i < 1000; i += 2) {
      if (sign) {
        Pi += 4.0 / i;
      } else {
        Pi -= 4.0 / i;
      }
    sign = !sign;
    }

    return Pi;
  }
}
```

I have tested above benchmark with JDK9, JDK10 and JDK11. Even if at the moment of writing the article JDK11 is not released yet, I have downloaded a build from [JDK 11 Early-Access Builds](http://jdk.java.net/11/) web page.

```
Benchmark                     Mode Cnt Score Error Units

JDK9 circleLengthModulo       avgt 15 472.877 ± 7.700 ms/op
JDK9 circleLengthModulo_5x    avgt 15 255.441 ± 6.711 ms/op
JDK9 circleLengthModulo_10x   avgt 15 254.129 ± 4.318 ms/op

JDK10 circleLengthModulo      avgt 15 454.195 ± 7.850 ms/op
JDK10 circleLengthModulo_5x   avgt 15 2,036.281 ± 57.482 ms/op
JDK10 circleLengthModulo_10x  avgt 15 3,818.085 ± 91.651 ms/op

JDK11 circleLengthModulo      avgt 15 465.766 ± 6.461 ms/op
JDK11 circleLengthModulo_5x   avgt 15 259.395 ± 11.803 ms/op
JDK11 circleLengthModulo_10x  avgt 15 261.039 ± 5.192 ms/op
```

Tests triggered on my machine (CPU: Intel i7-6700HQ Skylake; MEMORY: 16GB DDR4 2133 MHz; OS: Ubuntu 16.04.2)

Few conclusions:

1. **circleLengthModulo()** benchmark method seems to behave almost the same without any noticeable difference in performance in case of JDK9, JDK10 and JDK11
2. **circleLengthModulo\_5x()** and **circleLengthModulo\_10x()** benchmark methods have almost the same response time per iteration in case of JDK9 and JDK11, however JDK10 adds a huge penalty as follows:
   - **circleLengthModulo\_5x()** which contains 5 x computePi() loop invariant methods seems ~8 times slower in JDK10 than JDK9 or JDK11
   - **circleLengthModulo\_10x()** which contains 10 x computePi() loop invariant methods seems ~14 times slower in JDK10 than JDK9 or JDK11

Since it might be interesting why it behaves so slow in JDK10 in comparison to JDK9 and JDK11, I tried to write simplistic pseudocode version derived from assembly code generated in case of **circleLengthModulo\_10x()** method (the same for **circleLengthModulo\_5x()**).

###### JDK9 – rough pseudocode version

```
// JDK 9
public circleLengthModulo_10x() {
  sum = 0;

  2Radius = 2 * radius; // constant subexpression hoisted out of main loop  
  while (outer_counter < 200_000) {

    inline computePi() {

      // loop unroled by a factor of 32
      while (inner_counter < 994) {
        unrolls 32 iterations step from Pi series using vectorized operations
        inner_counter += 32
      }

      // handle the remaining in a post loop
      while (inner_counter < 1000) {
        unrolls 2 iterations step from Pi series using vectorized operations
        inner_counter += 2
      }
    }

    outer_counter += 1
    sum += (2Radius * Pi) % outer_counter
    }
  return sum;
}
```

In essence what it does is to inline the method computePi() in the caller only once, computes the **π** value using vectorized instructions and unrolling the main Pi loop by a factor of 32 and the post Pi loop by a factor of 2, etc.

I am not targeting to describe in detail all these under the hood Just In Time Compiler optimizations, however if you are interested in the topic you can check my talk [Runtime vs. compile time (JIT vs. AOT) optimizations in Java and C++](https://www.youtube.com/watch?v=O87PaWkXlZ0) .

###### JDK10 – rough pseudocode version

```
// JDK 10
public circleLengthModulo_10x() {
  sum = 0;

  2Radius = 2 * radius; // constant subexpression hoisted out of main loop
  while (outer_counter < 200_000) {

    inline computePi() {...} // useless inlining !
    inline computePi() {...} // useless inlining !
    inline computePi() {...} // useless inlining !
    inline computePi() {...} // useless inlining !
    inline computePi() {...} // useless inlining !
    inline computePi() {...} // useless inlining !
    inline computePi() {...} // useless inlining !
    inline computePi() {...} // useless inlining !
    inline computePi() {...} // useless inlining !
    inline computePi() {...} // useless inlining !
    inline computePi() {...}
    outer_counter += 1
    sum += (2Radius * Pi) % outer_counter
  }
  return sum;
}
```

To get the full assembly listing you can download it from below:

- [circleLengthModulo\_10x-JDK9](https://github.com/ionutbalosin/ionutbalosin.com/blob/main/blog/java/loop-invariant-code-motion-pitfall-in-jdk10/circleLengthModulo_10x-JDK9.txt)
- [circleLengthModulo\_10x-JDK10](https://github.com/ionutbalosin/ionutbalosin.com/blob/main/blog/java/loop-invariant-code-motion-pitfall-in-jdk10/circleLengthModulo_10x-JDK10.txt)

As we can easily spot, in JDK10 the more “interesting” fact is that method computePi() is inlined multiple times instead of being removed, since it is superfluous and do not impact the semantics of the program (i.e. its return value is not used in case of first 10 calls). This might explain the performance penalty in such case. For JDK9 and JDK11 computePi() method is inlined exactly once within caller method (i.e. removing useless computePi() methods), which leads to almost the same response time for all included JDK versions, as per provided experiment.

##### Further references:

- [Runtime vs. compile time (JIT vs. AOT) optimizations in Java and C++](https://www.youtube.com/watch?v=O87PaWkXlZ0)

UPDATE: As per comment from *Jean-Philippe Bempel*, this optimization is more linked to **Dead Code Elimination** rather than **Loop Invariant Code Motion**!

---

**Tags**: Java, JDK 10, JVM, JIT Compiler, HotSpot, Loop Optimization, Loop Invariant Code Motion, Performance, Compiler Optimizations, JMH, Microbenchmark

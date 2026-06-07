# Parallel streams behave sequentially up to a certain extent

## Content

- [Introduction](#introduction)
- [Benchmark](#benchmark)
- [Under the Hood](#under-the-hood)
- [The NQ Model](#the-nq-model)
- [Further Reading](#further-reading)

## Introduction

In this post, I would like to spotlight a bit of the internal behavior of parallel streams in Java, a feature added in JDK 8. I will start from the source code and then try to explain what really happens in the context of our test example.

## Benchmark

Basically, the code below declares two array lists, one of size 8192 and the other of 8193, then creates parallel streams out of them, and, afterward, tries to sort the arrays.

```java
@BenchmarkMode(Mode.AverageTime)
@OutputTimeUnit(TimeUnit.NANOSECONDS)
@Warmup(iterations = 5, timeUnit = TimeUnit.NANOSECONDS)
@Measurement(iterations = 5, timeUnit = TimeUnit.NANOSECONDS)
@Fork(value = 3, warmups = 1)
@State(Scope.Benchmark)
public class SortStreamJmh {

  public static void main(String[] args) throws RunnerException {
    Options opt = new OptionsBuilder()
      .include(SortStreamJmh.class.getName())
      .verbosity(VerboseMode.SILENT)
      .build();

    new Runner(opt).run();
  }

  @Param({ "8192", "8193" })
  int arraySize;

  List<String> list = new ArrayList<>();

  @Setup
  public void setupList(){
    Random random = new Random(26);
    for (int i = 0; i < arraySize; i ++) {
      String r = generateRandomWord(random, 2);
      list.add(r);
    }
  }

  @Benchmark
  public Object[] sort() {
    Object[] result = list.parallelStream().sorted().toArray();

    return result;
  }

  private static String generateRandomWord(Random random, int wordLength) {
    StringBuilder sb = new StringBuilder(wordLength);
    for(int i = 0; i < wordLength; i++) {
      char tmp = (char)('a' + random.nextInt('z' - 'a')); // Generate a letter between a and z
      sb.append(tmp); // Add it to the String
    }
  return sb.toString();
  }

}
```

Test output:

```
Benchmark       (arraySize) Mode Cnt Score Error Units

SortStreamJmh.sort     8192 avgt 15 1711.595 ± 51060.627 us/op
SortStreamJmh.sort     8193 avgt 15 944.169 ± 28012.014 us/op
```

*Tests triggered using JDK 10 (latest JDK release at the moment) on my machine (CPU: Intel i7-6700HQ Skylake; MEMORY: 16GB DDR4 2133 MHz; OS: Ubuntu 16.04.2)*

## Under the Hood

As we might notice, the bigger array (i.e. 8193) takes less time to sort the Strings (~2x faster) in comparison to the smaller one (i.e. 8192). However, even if the arrays’ lengths are almost equal (i.e. their sizes differ by only one element: 8192 vs. 8193), the performance is noticeable! How can we explain this?

Let’s jump into the JDK sources inside the **java.util.Arrays.java** class:

```
public static <T extends Comparable<? super T>> void parallelSort(T[] a) {
  int n = a.length;
  if n <= 1 << 13 
    // sequencial sort
  else
    // parallel sort
}
```

The JDK source code reveals an interesting fact:

- If the array length is below a certain granularity (e.g. **MIN\_ARRAY\_SORT\_GRAN = 1 << 13** which corresponds to **8192**), the array is not partitioned anymore and is sequentially sorted using **Arrays.sort()**, even if at the code level the programmer explicitly requires a parallel stream!
- Otherwise, the array is partitioned and a **ForkJoin** pool is used to execute parallel tasks

Getting back to our example, we can summarize:

- The 8192 array length is sequentially sorted.
- The 8193 array length is split into parallel sub-tasks handled by the ForkJoin pool.

Which explains why, despite a slightly larger length, the 8193 array is faster.

## The NQ Model

Back to a bit of theory, there are few recommendations from **Brian Goetz** on his great article [Parallel stream performance](https://www.ibm.com/developerworks/library/j-java-streams-5-brian-goetz/index.html) about the rationale of splitting a source, including when it makes sense to go parallel and when to stick with the sequential approach. One of the guidelines includes the **NQ model**, which states:

> **NQ Model**: larger the product N×Q is, more likely to get a parallel speedup!
>
> - **N** — number of data elements / **Q** — amount of work performed per element

**Note:** For problems with a trivially small Q (e.g. sorting, addition), generally N should be greater than 10,000 to get a speedup and to make sense to parallelize!

It might be a reasonable explanation for our test case as well, where JDK sources rely on an explicit threshold **1<<13** to avoid parallelizing Streams, where the size is below that certain specified value (e.g. 1 << 13 = 8193)!

## Further Reading

- [From concurrent to parallel – Brian Goetz](https://www.youtube.com/watch?v=NsDE7E8sIdQ)

---

**Tags**: Java, JDK 8, Streams API, Parallel Streams, Performance, Concurrency, Fork/Join, JMH, Microbenchmark, Java Streams, Functional Programming

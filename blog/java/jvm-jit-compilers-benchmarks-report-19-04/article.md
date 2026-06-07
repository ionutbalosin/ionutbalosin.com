# JVM JIT Compilers Benchmarks Report 19.04 (OpenJDK 12)

## Content

- [Context and Motivation](#context-and-motivation)
- [SetUp](#setup)
- [Benchmarks](#benchmarks)
- [Final Conclusions](#final-conclusions)

## Context and Motivation

The current article describes a series of Java Virtual Machine (JVM) Just In Time (JIT) Compilers benchmarks and their results, relying on different optimization patterns. For the current issue I included only two compilers:

1. **Oracle HotSpot C1/C2 JIT**
2. **Oracle HotSpot Graal JIT**

In the future, I might extend it to [Eclipse OpenJ9](https://www.eclipse.org/openj9/),  [Azul Zing](https://www.azul.com/products/zing/virtual-machine/), and [Graal EE](https://www.graalvm.org/). For such extended analysis, I would definitely need more time to spend on the tests, since JMH might not work out of the box with OpenJ9 mainly because this JVM obviously understand a different set of -XX:<options> (than HotSpot) and JMH heavily relies on them for correct results. That’s why at the moment I prefer to keep it simple and to exclude any other (commercial) JVM.

From my point of view, this comparison makes sense, even if C1/C2 JIT is not a state of the art Compiler (in comparison to Graal JIT), however, the majority of our code in production still runs using C1/C2 JIT.

Out of the scope for this report is to macro-benchmark an end to end application. It focuses only on micro-level JIT Compiler optimizations and their runtime performance (in most cases by measuring the average response time).

## SetUp

- All benchmarks are written in Java (not any other JVM based language) and use [JMH](https://openjdk.java.net/projects/code-tools/jmh/) v1.21
- The benchmarks source code is not (yet) public, however, I have detailed the optimization patterns they rely on.
- Each benchmark uses 5x10s warm-up iterations,  5x10s measurement iterations, 3 JVM forks, and in most of the cases, it is single threaded.
- There are no explicit JVM arguments used during tests, only JVM default ones.
- All tests are launched on a dedicated machine having below configuration:
  - CPU: Intel i7-8550U Kaby Lake R
  - MEMORY: 16GB DDR4 2400 MHz
  - OS: Ubuntu 18.10 / 4.18.0-17-generic
  - Java HotSpot(TM) version 12\_linux-x64 (build 12+33)
- To eliminate the effects of dynamic frequency scaling, I disabled the *intel\_pstate* driver and I set the CPU governor to *performance*.
- All benchmark test data structures fit within L1-L3 cache: usually, they are bigger than L1d (32KB) but smaller than L3 (8192KB). Nevertheless, benchmark results are anyway influenced by data sizes (which has also an impact on the CPU caches, branch predictors, etc).
- All benchmark results are merged in a dedicated [HTML report](https://github.com/ionutbalosin/ionutbalosin.com/blob/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/report/jmh_visualizer/index.html) on my GitHub account. For better charts quality I would recommend you to open the HTML report since the current post contains only print screens out of it.

## Benchmarks

### IfConditionalBranchBenchmark

Tests the optimization of an if conditional branch within a loop based on a predictable or unpredictable branch pattern.

```
for (int value : array) {
  if (value < thresholdLimit) {
    sum += value;
  }
}
```

Where **thresholdLimit** is either:

- always greater then arrays values – predictable pattern
- or partially greater than some arrays values – unpredictable pattern

[![](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/19_04_IfConditionalBranchBenchmark.png)](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/19_04_IfConditionalBranchBenchmark.png)

<<click on the picture to enlarge or open the full [HTML report](https://github.com/ionutbalosin/ionutbalosin.com/blob/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/report/jmh_visualizer/index.html) from GitHub >>

#### Conclusions

- in case of **branchless\_baseline** and **predictable\_branch** both compilers perform almost the same (slightly better in favor of C1/C2 JIT).
- in case of **unpredictable\_branch** C1/C2 JIT reaches around 6.3x performance speedup.

#### Winner

- HotSpot C1/C2 JIT

### NullChecksBenchmark

Test how the Compiler deals with implicit versus explicit null pointer exception.

```java
method() {
  try {
    // mode is {explicit, implicit}
    <mode>_null_check(object);
  } catch(NullPointerException e) {
    // swallow exception
  }
}

explicit_null_check(object) {
  if (object == null) {
    throw new NullPointerException("Oops!");
  }
  return object.field;
}

implicit_null_check(object) {
  return object.field; // might throw NPE
}
```

[![](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/19_04_NullChecksBenchmark.png)](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/19_04_NullChecksBenchmark.png)

<<click on the picture to enlarge or open the full [HTML report](https://github.com/ionutbalosin/ionutbalosin.com/blob/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/report/jmh_visualizer/index.html) from GitHub >>

#### Conclusions

- both compilers perform almost the same, no significant difference in response time.

### ScalarReplacementBenchmark

Compiler analyses the scope of a new object and decides whether it might be allocated or not on the heap. The method is called **Escape Analysis** (EA), which identifies if the newly created object is escaping or not into the heap. To not be confused, EA is not an optimization but rather an analysis phase for the optimizer. There are few escape states:

- **NoEscape** – the object cannot be visible outside the current method and thread.
- **ArgEscape** – the object is passed as an argument to a method but cannot otherwise be visible outside the method or by other threads.
- **GlobalEscape** – the object can escape the method or the thread. It means that an object with GlobalEscape state is visible outside method/thread.

For **NoEscape** objects, the Compiler can remap accesses to the object fields to accesses to synthetic local operands: which leads to so-called **Scalar Replacement** optimization. If stack allocation was really done, it would allocate the entire object storage on the stack, including the header and the fields, and reference it in the generated code. However, since the operands are handled by register allocator, some may claim stack slots (get “spilled”) and it might look like the object field block is allocated on stack. Please check this [article](https://shipilev.net/jvm/anatomy-quarks/18-scalar-replacement/) for further details.

```
no_escape_object() {
  SimpleObject object = new SimpleObject();

  return object.field1 + object.field2;
}

no_escape_object_containing_array() {
  ObjectWithArray object = new ObjectWithArray();

  return object.field1 + object.field2 + object.array.length;
}

partial_escape_object_containing_array() {
  ObjectWithArray object = new ObjectWithArray();

  if (predicate) // always FALSE
    result = object;
  else
    result = otherGlobalObject;

  return result;
}
```

Where:

- **predicate** is always evaluated to FALSE, at runtime.
- array size is 128.

```
arg_escape_object_containing_array() {
  ObjectWithArray object1 = new ObjectWithArray();
  ObjectWithArray object2 = new ObjectWithArray();

  if (object1.equals(object2)) // inlining candidate
    match = true;
  else
    match = false;

  return match;
}
```

Where:

- **object1** is **NoEscape**
- **object2** is:
  - **NoEscape** if inlining of equals() succeeds.
  - **ArgEscape** if inlining fails or is disabled.

[![](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/19_04_ScalarReplacementBenchmark.png)](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/19_04_ScalarReplacementBenchmark.png)

<<click on the picture to enlarge or open the full [HTML report](https://github.com/ionutbalosin/ionutbalosin.com/blob/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/report/jmh_visualizer/index.html) from GitHub >>

#### Conclusions

- in all cases Graal JIT is able to get rid of heap allocations offering a constant response time, around 3 ns/op. In comparison, C1/C2 JIT achieves that only for the **no\_escape\_object** case.
- C1/C2 JIT by default does not consider escaping arrays if their size (i.e. the number of elements) is greater than 64, but this could be tuned via **-XX:EliminateAllocationArraySizeLimit** JVM argument. In my benchmark the array size is 128, hence EA was omitted. Besides that, C1/C2 JIT struggles to get rid of the heap allocations if the object scope, after inlining, becomes local (i.e. NoEscape), or if there is a condition which does not make obvious at compile time if the object escapes or not (i.e. partial escape analysis).

If you want to read more about [Partial Escape Analysis and Scalar Replacement](http://www.ssw.uni-linz.ac.at/Research/Papers/Stadler14/Stadler2014-CGO-PEA.pdf) click on the link provided.

#### Winner

- HotSpot Graal JIT

### DoubleMathBenchmark

Tests a bunch of mathematical operations using doubles.

```
double[] A, B, C, R;

R[i] = Math.sqrt(A[i]);

R[i] = Math.exp(A[i]);

R[i] = Math.pow(A[i], B[i]);

R[i] = Math.log(A[i]);

R[i] = Math.log10(A[i]);

R[i] = Math.abs(A[i]);

R[i] = Math.min(A[i], B[i]);

R[i] = Math.max(A[i], B[i]);

R[i] = Math.fma(A[i], B[i], C[i]);

R[i] = Math.round(A[i]);
```

Current benchmark also exploits the [vectorization effect](https://en.wikipedia.org/wiki/Automatic_vectorization), however, there are other dedicated test cases in the current report.

[![](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/19_04_DoubleMathBenchmark.png)](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/19_04_DoubleMathBenchmark.png)

<<click on the picture to enlarge or open the full [HTML report](https://github.com/ionutbalosin/ionutbalosin.com/blob/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/report/jmh_visualizer/index.html) from GitHub >>

#### Conclusions

- in cases of **fma**, **log**,  **log10,** and **sqrt**, C1/C2 JIT reaches around 2x performance speedup.
- besides that, the difference might be also induced by loop optimizations (e.g. unrolling, vectorization) since the benchmark triggers the math operations within a loop and then divides the average response time by the number of operations per invocation.

### VectorizationPatternsSingleIntArrayBenchmark

Tests different vectorization patterns using an array of ints. All loops have stride 1 and the loop counter is of type int or long.

```
int[] A;

// sum_of_all_array_elements
sum += A[i];

// sum_of_all_array_elements_by_adding_a_const
sum += A[i] + CONST;

// sum_of_all_even_array_elements
if ( (A[i] & 0x1) == 0 ) {
sum += A[i];
}

// sum_of_all_array_elements_matching_a_predicate
if (P[i]) {
sum += A[i];
}

// sum_of_all_array_elements_by_shifting_and_masking
sum += (A[i] >> SHIFT) & MASK;

// multiply_each_array_element_by_const
A[i] = A[i] * CONST;

// add_const_to_each_array_element
A[i] = A[i] + CONST;

// shl_each_array_element_by_const
A[i] = A[i] << CONST;

// mod_each_array_element_by_const
A[i] = A[i] % CONST;
// saves_induction_variable_to_each_array_element
A[i] = i;

// increment_arrays_elements_backward_iterator (i=n-1...0)
A[i] = i;
```

[![](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/19_04_VectorizationPatternsSingleIntArrayBenchmark.png)](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/19_04_VectorizationPatternsSingleIntArrayBenchmark.png)

<<click on the picture to enlarge or open the full [HTML report](https://github.com/ionutbalosin/ionutbalosin.com/blob/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/report/jmh_visualizer/index.html) from GitHub >>

#### Conclusions

- the **sum\_of\_all\_array\_elements\_long\_stride** case is similar for both compilers. Maybe is an already known fact, but in case of loops with a long counter (even if the stride is 1) the body of the loop could not be unrolled and the loop itself contains a safepoint poll, which slows down the performance.
- for all the other cases C1/C2 JIT offers better performance.

#### Winner

- HotSpot C1/C2 JIT

### VectorizationPatternsMultipleFloatArraysBenchmark

Tests different vectorization patterns using multiple arrays of floats. All loops have stride 1 (or 2) and the loop counter is of type int or long.

```
float[] A, B, R;
short[] S;

// sum_all_product_pairs_of_2_arrays_elements
sum += A[i] * B[i];

// add_2_arrays_elements
R[i] = A[i] + B[i];

// extract_2_arrays_elements
R[i] = A[i] - B[i];

// mod_2_arrays_elements
R[i] = A[i] % B[i];

// multiply_2_arrays_elements
R[i] = A[i] * B[i];

// multiply_2_arrays_elements_of_mixed_types (short and float)
R[i] = A[i] * S[i];

// divide_2_arrays_elements
R[i] = A[i] / B[i];

// if_with_masking_conditional_flow
if (A[i] >= 0.f)
  R[i] = CONST * A[i];
else
  R[i] = A[i];

// multiply_2_arrays_elements_stride_x2
R[2 * i] = A[2 * i] * B[2 * i];

// multiply_2_arrays_elements_stride_2
R[i + 2] = A[i + 2] * B[i + 2];

// add_2_arrays_elements_inc_index_access
A[i] = A[i + 1] + B[i];

// add_2_arrays_elements_modulo_index_access
R[i] = A[i % 2] + B[i];
```

[![](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/19_04_VectorizationPatternsMultipleFloatArraysBenchmark.png)](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/19_04_VectorizationPatternsMultipleFloatArraysBenchmark.png)

<<click on the picture to enlarge or open the full [HTML report](https://github.com/ionutbalosin/ionutbalosin.com/blob/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/report/jmh_visualizer/index.html) from GitHub >>

#### Conclusions

- for the **mod\_2\_arrays\_elements** and **sum\_all\_product\_pairs\_of\_2\_arrays\_elements** cases, Graal JIT performs better reaching around 2x-3x performance speedup.
- the **multiply\_2\_arrays\_elements\_long\_stride** case is similar for both compilers (due to the rationale already explained – loops with long counter).
- for all the other cases C1/C2 JIT offers better performance.

#### Winner

- HotSpot C1/C2 JIT

### VectorizationPatternsMultipleIntArraysBenchmark

Tests different vectorization patterns using multiple arrays of ints. All loops have stride 1 (or 2) and the loop counter is of type int or long.

Benchmark use cases are similar to the ones from **VectorizationPatternsMultipleFloatArraysBenchmark**, hence no need to duplicate them anymore.

[![](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/19_04_VectorizationPatternsMultipleIntArraysBenchmark.png)](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/19_04_VectorizationPatternsMultipleIntArraysBenchmark.png)

<<click on the picture to enlarge or open the full [HTML report](https://github.com/ionutbalosin/ionutbalosin.com/blob/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/report/jmh_visualizer/index.html) from GitHub >>

#### Conclusions

- except for the **multiply\_2\_arrays\_elements\_long\_stride**case (due to the rationale already explained – loops with long counter), C1/C2 JIT performs better.

#### Winner

- HotSpot C1/C2 JIT

### VectorizationScatterGatherPatternBenchmark

[Gather-scatter](https://en.wikipedia.org/wiki/Gather-scatter_(vector_addressing)) is a type of memory addressing that often arises when addressing vectors in sparse linear algebra operations.

Vector processors (and some SIMD units in CPUs) have hardware support for gather-scatter operations, providing instructions such as Load Vector Indexed for **gather** and Store Vector Indexed for **scatter**.

```
int[] A, B, C, R;

// scatter_gather
R[i] = C[i] + A[B[i]];
```

[![](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/19_04_VectorizationScatterGatherPatternBenchmark.png)](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/19_04_VectorizationScatterGatherPatternBenchmark.png)

<<click on the picture to enlarge or open the full [HTML report](https://github.com/ionutbalosin/ionutbalosin.com/blob/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/report/jmh_visualizer/index.html) from GitHub >>

#### Conclusions

- C1/C2 JIT reaches around 1.4x performance speedup.

#### Winner

- HotSpot C1/C2 JIT

### CodeCacheBusterBenchmark

Tests the compilation (i.e. the code cache) of a big method which calls in sequence a bunch of other small methods (~5000 small methods).

Every small method either returns the received argument incremented by a random value or dispatches it to another small method which returns another random value. The big method counts around 40,002 bytes in total, where every small method has either 8 or 12 bytes.

As a side note, HotSpot has a **HugeMethodLimit** threshold which is set to 8,000 bytes, which means methods larger than this threshold are not implicitly compiled, unless JVM argument **-XX:-DontCompileHugeMethods** is enabled.

```
method() { // size = 40002 bytes
int sum = 0;
sum += t0(sum);
sum += t1(sum);

// ...

sum += t4999(sum);
return sum;
}

int t0(int i) { // size = 8 bytes
  return i + t1(i);
}

int t1(int i) { // size = 12 bytes
  return i + random.nextInt(10);
}

// ...

int t4999(int i) { // size = 12 bytes
  return i + random.nextInt(10);
}
```

[![](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/19_04_CodeCacheBusterBenchmark.png)](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/19_04_CodeCacheBusterBenchmark.png)

<<click on the picture to enlarge or open the full [HTML report](https://github.com/ionutbalosin/ionutbalosin.com/blob/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/report/jmh_visualizer/index.html) from GitHub >>

#### Conclusions

- both compilers perform almost the same (slightly better in favor of Graal JIT)

### MethodArgsBusterBenchmark

Test how Compiler could potentially optimize a method which takes a huge number of arguments (64 double arguments).  
Usually, the [register allocation](https://en.wikipedia.org/wiki/Register_allocation) (i.e. the array of register mask bits) should be large enough to cover all the machine registers and all parameters that need to be passed on the stack (stack registers) up to some “interesting” limit. Methods that need more parameters will not be compiled. For example, on Intel, the limit is around 90+ parameters.

```
method(double d00, double d01, ... double d63) {
  return Math.round(d00) +
    Math.round(d01) +
    ... +
    Math.round(d63);
}
```

[![](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/19_04_MethodArgsBusterBenchmark.png)](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/19_04_MethodArgsBusterBenchmark.png)

<<click on the picture to enlarge or open the full [HTML report](https://github.com/ionutbalosin/ionutbalosin.com/blob/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/report/jmh_visualizer/index.html) from GitHub >>

#### Conclusions

- Graal JIT reaches around 80x performance speedup.

#### Winner

- HotSpot Graal JIT

### DeadCodeEliminationBenchmark

Test how well the Compiler could remove code which does not affect the program results within a loop, optimization which relates to [dead code elimination](https://en.wikipedia.org/wiki/Dead_code_elimination).

```
method() {
  for (int i = 0; i < iterations; i++) {
    // useless calls
    value1 = call_to_method(param) // 1st
    value2 = call_to_method(value1); // 2nd
    value3 = call_to_method(value2); // 3rd
    // value1, value2 and value3 vanish here,
    // they not used anymore within loop cycle
    // ... do some real operations ...
    }
    // return result
}
```

Where **call\_to\_method**() is:

- either a call to a native method (e.g. Math.tan, Math.atan)
- or a user-defined iterative function (e.g. [Leibniz formula](https://en.wikipedia.org/wiki/Leibniz_formula_for_%CF%80) for PI computation using an infinite series).

[![](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/19_04_DeadCodeEliminationBenchmark.png)](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/19_04_DeadCodeEliminationBenchmark.png)

<<click on the picture to enlarge or open the full [HTML report](https://github.com/ionutbalosin/ionutbalosin.com/blob/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/report/jmh_visualizer/index.html) from GitHub >>

#### Conclusions

- in all the cases both compilers perform almost the same (slightly better in favor of C1/C2 JIT).

### LoopInvariantCodeMotionBenchmark

Test how Compiler deals with loop invariant code motion, in essence how it is able to move the invariant code before and after a loop. **Hoisting** and **sinking** are terms that Compiler refers to moving operations outside loops:

- **hoisting** a load means to move the load so that it occurs before the loop
- **sinking** a store means to move a store to occur after a loop

Current benchmark computes the sum of recurrent **tan(nx)** based on the formula:

```
tan(ix) = [Math.tan((i - 1) * x) + Math.tan(x)] / [1 - Math.tan((i - 1) * x) * Math.tan(x)]
```

Where:

- i = 1 … n
- x = represents the angle and is constant

```
method() {
  for (int i = 1; i < iterations; i++) {
    v1 = Math.tan((i - 1) * x) + Math.tan(x);
    v2 = 1 - Math.tan((i - 1) * x) * Math.tan(x);
    sum += v1 / v2;
    result = Math.tan(Math.atan(sum));
  }
  return result;
}
```

Current benchmark also exploits the [common subexpression elimination](https://en.wikipedia.org/wiki/Common_subexpression_elimination) since **Math.tan((i – 1) \* x)** is computed twice per loop cycle.

[![](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/19_04_LoopInvariantCodeMotionBenchmark.png)](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/19_04_LoopInvariantCodeMotionBenchmark.png)

<<click on the picture to enlarge or open the full [HTML report](https://github.com/ionutbalosin/ionutbalosin.com/blob/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/report/jmh_visualizer/index.html) from GitHub >>

#### Conclusions

- for the explicit **manual\_hoisting\_and\_sinking** case, both compilers perform almost the same.
- for the **loop\_with\_invariant\_code** case, C1/C2 JIT performs better reaching around 1.5x performance speedup. Unfortunately, none of the compilers are even closer to the previous response time, the baseline.

#### Winner

- HotSpot C1/C2 JIT

### LoopReductionBenchmark

Loop reduction (or loop reduce) benchmark tests if a loop could be reduced by the number of additions within that loop. This optimization is based on the induction variable to strength the additions.

```
method(accumulator) {
  for (int i = 0; i < iterations; ++i) {
    accumulator++;
  }
  return accumulator;
}

// is equivalent to:

method(iterations, accumulator) {
  return accumulator + iterations;
}
```

[![](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/19_04_LoopReductionBenchmark.png)](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/19_04_LoopReductionBenchmark.png)

<<click on the picture to enlarge or open the full [HTML report](https://github.com/ionutbalosin/ionutbalosin.com/blob/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/report/jmh_visualizer/index.html) from GitHub >>

#### Conclusions

- for the automatic **loop\_reduction** case, C1/C2 JIT reaches around 8,000x performance speedup which proves the compiler triggers this kind of optimization.
- for the **baseline** case, it is a bit wired the difference in performance since in both cases the method just returns an addition of the arguments received. If I had more time, I would have taken a look over the assembly generated … (quoting Blaise Pascal)

#### Winner

- HotSpot C1/C2 JIT

### LoopFusionBenchmark

[Loop fusion](https://en.wikipedia.org/wiki/Loop_fission_and_fusion) merges adjacent loops into one loop to reduce loop overhead and improve run-time performance. Benefits of loop fusion:

- reduce loop overhead
- improve locality by combining loops that reference the same array
- increase the granularity of work done in a loop

```
method() {
  for (i = 0; i < size; i++)
    C[i] = A[i] * 2 + B[i];
  for (i = 0; i < size; i++)
    D[i] = A[i] * 2;
}

// is equivalent to:

method() {
  for (i = 0; i < size; i++) {
    C[i] = A[i] * 2 + B[i];
    D[i] = A[i] * 2;
  }
}
```

Current benchmark also exploits the [vectorization effect](https://en.wikipedia.org/wiki/Automatic_vectorization), however, there are other dedicated test cases in the current report.

[![](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/19_04_LoopFusionBenchmark.png)](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/19_04_LoopFusionBenchmark.png)

<<click on the picture to enlarge or open the full [HTML report](https://github.com/ionutbalosin/ionutbalosin.com/blob/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/report/jmh_visualizer/index.html) from GitHub >>

#### Conclusions

- in case of **baseline** both compilers perform almost the same (slightly better in favor of C1/C2 JIT).
- in case of **loop\_fusion** case C1/C2 JIT performs better, reaching around 3.8x performance speedup.

#### Winner

- HotSpot C1/C2 JIT

### ScalarEvolutionAndLoopOptimizationBenchmark

Check if the Compiler can recognize the existence of the induction variables and to replace it with simpler computations. This optimization is a special case of strength reduction where all loop iterations are strengthened to a mathematical formula.

```
method() {
  sum = 0;
  for (i = 0; i < size; i++) {
    sum += i;
  }
  return sum;
}

// is equivalent to:

method() {
  return [size * (size - 1)] / 2;
}
```

[![](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/19_04_ScalarEvolutionAndLoopOptimizationBenchmark.png)](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/19_04_ScalarEvolutionAndLoopOptimizationBenchmark.png)

<<click on the picture to enlarge or open the full [HTML report](https://github.com/ionutbalosin/ionutbalosin.com/blob/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/report/jmh_visualizer/index.html) from GitHub >>

#### Conclusions

- both compilers perform almost the same (slightly better in favor of Graal JIT)

### StraightenCodeBenchmark

Tests how well the Compiler straightens code.

```
method(T i) {
  T j;

  if (i < X) {
    // j becomes X, so it should be straightened to j == X case below.
    j = X;
  } else {
    // j becomes Y, so it should be straightened to j == Y case below.
    j = Y;
  }
  if (j == Y) {
    i += Z;
  }
  if (j == X) {
    i += Z;
  }
  return i;
}
```

Where **X**, **Y,**and **Z** are constants.

Benchmark use cases:

- **straighten\_1\_int**: tests how well serial constant integer comparisons are straightened.
- **straighten\_1\_long**: tests how well serial constant long comparisons are straightened.
- **straighten\_2\_int**: tests how well constant integer definitions are straightened.
- **straighten\_2\_long**: tests how well constant long definitions are straightened.
- **straighten\_3\_int**: tests how well variable integer comparisons are straightened.
- **straighten\_3\_long**: tests how well variable long comparisons are straightened.

[![](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/19_04_StraightenCodeBenchmark.png)](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/19_04_StraightenCodeBenchmark.png)

<<click on the picture to enlarge or open the full [HTML report](https://github.com/ionutbalosin/ionutbalosin.com/blob/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/report/jmh_visualizer/index.html) from GitHub >>

#### Conclusions

- in cases of **straighten\_1\_int** and **straighten\_1\_long** Graal JIT offers better performance, around 1.4x performance speedup.
- in case of **straighten\_2\_int** both compilers perform the same.
- in cases of **straighten\_2\_long** and **straighten\_3\_int** C1/C2 JIT performs slightly better, however, the difference is significantly higher in case of **straighten\_3\_long**, around 2.6x performance speedup.

### StrengthReductionBenchmark

A [strength reduction](https://en.wikipedia.org/wiki/Strength_reduction) is a compiler optimization where expensive operations are replaced with equivalent but less expensive operations.

This benchmark tests how well the Compiler strengthens some arithmetic operations, as for example multiple additions, a multiplication in comparison to a bitwise shift operation.

```
addition() {
  return predicate ? val + val + ... + val : val;
}

multiplication() {
  return predicate ? val * 64 : val;
}

shift() {
  return predicate ? val << 6 : val;
}
```

Where **predicate** is always evaluated to true, at runtime.

[![](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/19_04_StrengthReductionBenchmark.png)](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/19_04_StrengthReductionBenchmark.png)

<<click on the picture to enlarge or open the full [HTML report](https://github.com/ionutbalosin/ionutbalosin.com/blob/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/report/jmh_visualizer/index.html) from GitHub >>

#### Conclusions

- in all the cases both compilers perform exactly the same. However, we can see the additions are not strengthened.

### TailRecursionBenchmark

A tail-recursive function is a function where the last operation before the function returns is an invocation to the function itself.

Tail-recursive optimization avoids allocating a new stack frame by re-writing the method into a completely iterative fashion.

```
// Fibonacci example
tail_recursive(int n, int a, int b) {
  if (n == 0)
    return a;
  else if (n == 1)
    return b;
  else return tail_recursive(n - 1, b, a + b);
}
```

[![](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/19_04_TailRecursionBenchmark.png)](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/19_04_TailRecursionBenchmark.png)

<<click on the picture to enlarge or open the full [HTML report](https://github.com/ionutbalosin/ionutbalosin.com/blob/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/report/jmh_visualizer/index.html) from GitHub >>

#### Conclusions

- in case of **fibonacci\_tail\_recursive** Graal JIT reaches around 3.6x performance speedup and it is similar to the baseline.
- for the **fibonacci\_****baseline** case, it is a bit wired the difference in performance since in both cases the method contains an iterative loop, I suspect it might be induced by loop optimizations (e.g. unrolling). If I had more time, I would have taken a look over the assembly generated …

#### Winner

- HotSpot Graal JIT (excluding the baseline)

### LockCoarseningBenchmark

Test how Compiler can effectively merge several adjacent synchronized blocks that use the same lock object, thus reducing the locking overhead.

```
method() {
  synchronized (this) {
    // statements 1
  }
  synchronized (this) {
    // statements 2
  }
  // ..
}

// is equivalent to:

method() {
  synchronized (this) {
    // statements 1
    // statements 2
    // ..
  }
}
```

[![](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/19_04_LockCoarseningBenchmark.png)](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/19_04_LockCoarseningBenchmark.png)

<<click on the picture to enlarge or open the full [HTML report](https://github.com/ionutbalosin/ionutbalosin.com/blob/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/report/jmh_visualizer/index.html) from GitHub >>

#### Conclusions

- in all the cases both compilers perform almost the same (slightly better in favor of C1/C2 JIT).

### LockElisionBenchmark

Test how Compiler can elide several adjacent locking blocks, thus reducing the locking overhead. Synchronization on non-shared objects is futile, and thus runtime does not have to do anything there. Therefore, if escape analysis figures out the objects are non-escaping, Compiler is free to eliminate synchronization.

```
method() {
  Object lock = new Object();
  synchronized (lock) {
    // statements 1
  }
  synchronized (lock) {
    // statements 2
  }
  // ..
}

// is equivalent to:

method() {
  // statements 1
  // statements 2
  // ..
}
```

[![](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/19_04_LockElisionBenchmark.png)](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/19_04_LockElisionBenchmark.png)

<<click on the picture to enlarge or open the full [HTML report](https://github.com/ionutbalosin/ionutbalosin.com/blob/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/report/jmh_visualizer/index.html) from GitHub >>

#### Conclusions

- in all the cases both compilers perform almost the same (slightly better in favor of C1/C2 JIT).

### RecursiveLockBenchmark

Test how Compiler can effectively merge several recursive synchronized blocks that use the same lock object, thus reducing the locking overhead.

```
method() {
  synchronized (this) {
    // statements 1
    synchronized (this) {
      // statements 2
      synchronized (this) {
        // ...
      }
    }
  }
}

// is equivalent to:

method() {
  synchronized (this) {
  // statements 1
  // statements 2
  // ..
  }
}
```

[![](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/19_04_RecursiveLockBenchmark.png)](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/19_04_RecursiveLockBenchmark.png)

<<click on the picture to enlarge or open the full [HTML report](https://github.com/ionutbalosin/ionutbalosin.com/blob/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/report/jmh_visualizer/index.html) from GitHub >>

#### Conclusions

- Graal JIT reaches around 26x performance speedup.

#### Winner

- HotSpot Graal JIT

### StoreAfterStoreBenchmark

Tests how well the Compiler can remove redundant stores. It’s crucial for the tests to be valid that inlining and allocation are performed.

Benchmark use cases:

- **redundant\_zero\_volatile\_stores**: test the removal of redundant zero volatile stores following an object allocation.
- **redundant\_non\_zero\_volatile\_stores**: test the removal of stores followed by other non-zero stores to the same memory location.

[![](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/19_04_StoreAfterStoreBenchmark.png)](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/19_04_StoreAfterStoreBenchmark.png)

<<click on the picture to enlarge or open the full [HTML report](https://github.com/ionutbalosin/ionutbalosin.com/blob/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/report/jmh_visualizer/index.html) from GitHub >>

#### Conclusions

- Graal JIT reaches around 2x performance speedup.

#### Winner

- HotSpot Graal JIT

### PostAllocationStoresBenchmark

Tests how well the JVM can remove stores after allocation of objects.

Benchmark use cases:

- **redundant\_null\_or\_zero\_store**: tests allocation with explicit stores of null/zero for all fields.
- **non\_null\_or\_zero\_store**: tests allocation with explicit stores of non-null/non-zero for all fields.
- **redundant\_null\_or\_zero\_volatile\_store**: tests allocation with explicit stores of null/zero for all fields, where all fields are volatile.
- **no\_store**: tests allocation without any explicit stores for any fields.

[![](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/19_04_PostAllocationStoresBenchmark.png)](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/19_04_PostAllocationStoresBenchmark.png)

<<click on the picture to enlarge or open the full [HTML report](https://github.com/ionutbalosin/ionutbalosin.com/blob/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/report/jmh_visualizer/index.html) from GitHub >>

#### Conclusions

- in case of **no\_store**, **non\_null\_or\_zero\_store**, and **redundant\_null\_or\_zero\_store** both compilers perform the same.
- in case of **redundant\_null\_or\_zero\_volatile\_store** Graal JIT reaches around 2.3x performance speedup

#### Winner

- HotSpot Graal JIT

### MegamorphicAbsClassCallBenchmark

Tests how well the Compiler could optimize the **monomorphic**, **bimorphic** and **megamorphic** abstract class call-sites.

- a **monomorphic** call-site is one which optimistically points to the only concrete method that has ever been used at that particular call-site.
- a **bimorphic** call-site is one which points to only two concrete methods which can be invoked at a particular call-site.
- a **megamorphic** call-site is one which points to three or possibly more methods which can be invoked at a particular call-site.

For further details please check my [previous article](https://ionutbalosin.com/2019/03/kotlin-explicit-inlining-at-megamorphic-call-sites-pays-off-in-performance/), section **A Bit Of Theory**.

[![](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/19_04_MegamorphicAbsClassCallBenchmark.png)](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/19_04_MegamorphicAbsClassCallBenchmark.png)

<<click on the picture to enlarge or open the full [HTML report](https://github.com/ionutbalosin/ionutbalosin.com/blob/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/report/jmh_visualizer/index.html) from GitHub >>

#### Conclusions

- in almost all cases (except **monomorphic** and **bimorphic**) Graal JIT is able to get rid of virtual calls offering a constant response time, around 3-5 ns/op.
- starting with the third possible runtime implementation C1/C2 JIT does not perform any further optimization.

#### Winner

- HotSpot Graal JIT

### MegamorphicInterfaceCallBenchmark

Tests how well the Compiler could optimize the monomorphic, bimorphic and megamorphic interface call-sites.

Benchmark use cases are similar to the ones from **MegamorphicAbsClassCallBenchmark**, hence no need to duplicate them anymore.

[![](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/19_04_MegamorphicInterfaceCallBenchmark.png)](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/19_04_MegamorphicInterfaceCallBenchmark.png)

<<click on the picture to enlarge or open the full [HTML report](https://github.com/ionutbalosin/ionutbalosin.com/blob/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/report/jmh_visualizer/index.html) from GitHub >>

#### Conclusions

- in almost all cases (except **monomorphic** and **bimorphic**) Graal JIT is able to get rid of virtual calls offering a constant response time, around 3-5 ns/op.
- starting with the third possible runtime target implementation C1/C2 JIT does not perform any further optimization.
- in comparison to the previous benchmark (e.g. **MegamorphicAbsClassCallBenchmark**), we can notice the interface calls are slightly slower than abstract method calls.

#### Winner

- HotSpot Graal JIT

### ChainingLambdaBenchmark

Tests lambdas chaining optimizations (capture + invocation) for different depth levels.

```
// generic pattern
() -> () -> () -> ... -> () -> capturedValue

// depth_1
() -> capturedValue

// depth_2
() -> () -> capturedValue

// depth_3
() -> () -> () -> capturedValue

// ...
```

[![](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/19_04_ChainingLambdaBenchmark.png)](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/19_04_ChainingLambdaBenchmark.png)

<<click on the picture to enlarge or open the full [HTML report](https://github.com/ionutbalosin/ionutbalosin.com/blob/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/report/jmh_visualizer/index.html) from GitHub >>

#### Conclusions

- both compilers perform almost the same, no significant difference in response time (slightly better in favor of C1/C2 JIT).

### ChainingAnonymousClassBenchmark

Tests chaining anonymous class optimizations (capture + invocation) for different depth levels.

Benchmark use cases are similar to the ones from **ChainingLambdaBenchmark**, however, instead of lambdas, there are anonymous classes.

Results are also very similar to the **ChainingLambdaBenchmark** case. Please visit the full [HTML report](https://github.com/ionutbalosin/ionutbalosin.com/blob/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/report/jmh_visualizer/index.html) from GitHub to check them.

#### Conclusions

- both compilers perform almost the same, no significant difference in response time (slightly better in favor of C1/C2 JIT).

### ChainingMethodRefBoundedBenchmark

Tests bounded method reference chaining optimizations (capture + invocation) for different depth levels.

Benchmark use cases are similar to the ones from **ChainingLambdaBenchmark**, however, instead of lambdas, there are bounded method references.

Results are also very similar to the **ChainingLambdaBenchmark** case. Please visit the full [HTML report](https://github.com/ionutbalosin/ionutbalosin.com/blob/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/report/jmh_visualizer/index.html) from GitHub to check them.

#### Conclusions

- both compilers perform almost the same, no significant difference in response time (slightly better in favor of C1/C2 JIT).

### ChainingMethodRefUnboundedBenchmark

Tests unbounded method reference chaining optimizations (capture + invocation) for different depth levels.

Benchmark use cases are similar to the ones from **ChainingLambdaBenchmark**, however, instead of lambdas, there are unbounded method references.

Results are also very similar to the **ChainingLambdaBenchmark** case. Please visit the full [HTML report](https://github.com/ionutbalosin/ionutbalosin.com/blob/main/blog/java/jvm-jit-compilers-benchmarks-report-19-04/report/jmh_visualizer/index.html) from GitHub to check them.

#### Conclusions

- both compilers perform almost the same, no significant difference in response time (slightly better in favor of C1/C2 JIT).

## Final Conclusions

To establish the final “winner”, I sum up each intermediate benchmark result, but only for the evident cases, and the total looks like:

- 8 points for HotSpot C1/C2 JIT (3 out of 8 belong to vectorization)
- 8 points for HotSpot Graal JIT

Please do not take this report too religiously, my main driver behind this study was curiosity (i.e. the pleasure of finding new things out) and the passion for compilers. Besides that, the report is far away to cover all possible use cases (it is, anyway, a huge effort to achieve it) and it might need additional effort in case of some benchmarks to deep-dive and understand the real cause behind the figures (which was not in the initial scope). However, in my opinion, it gives a broader understanding and proves that neither compiler is perfect. There are pros and cons on each side, each has its own strengths and weaknesses.

I hope you really enjoy reading it, despite the length. If you might find this useful or interesting, I would be very glad to get your feedback (in terms of missing use cases, unclear explanations, etc.) or, if you want to contribute with different benchmark patterns please do not hesitate to [get in touch](https://ionutbalosin.com/contact/).

---

**Tags**: Java, JDK 12, JVM, JIT Compiler, GraalVM, C1, C2, OpenJDK, Performance, JMH, Compiler Benchmarks, JIT Optimizations

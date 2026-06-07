# Optional API vs Explicit Null Check Race

## Content

- [Introduction](#introduction)
- [Setup](#setup)
- [Benchmark](#benchmark)
- [ifComparison Under the Hood](#ifcomparison-under-the-hood)
- [optionalChain Under the Hood](#optionalchain-under-the-hood)
- [Conclusion](#conclusion)

## Introduction

In the current article I propose to analyze what happens and how it behaves, from a performance standpoint, in case of using the Optional API feature added in JDK 8 versus the classical approach relying on explicit null checks.

## Setup

In regards to this, I decided to conduct an experiment based on 3 linked classes (e.g. Outer -> Nested -> Inner) as follows:

```java
public class Outer {

  public Outer(Integer value) {
    this.nested = new Nested(value);
  }

  public Nested nested;
  }

  public class Nested {

    public Nested(Integer value) {
      this.inner = new Inner(value);
    }

    public Inner inner;
    }

    public class Inner {

      public Inner(Integer foo) {
        this.value = foo;
      }

      public Integer value;
    }
  }
}
```

To sum up, there is an explicit declared Outer instance which implicitly creates instances for Nested and Inner classes, links them (due to chain of constructors) and adds as a composite the **intValue** field to Inner.

## Benchmark

The benchmark test measures the response time in case of getting the **intValue** field by iterating from Outer instance towards Inner via Nested, using Optional API approach versus the classical null checks, as per below:

```java
@BenchmarkMode(Mode.AverageTime)
@OutputTimeUnit(TimeUnit.NANOSECONDS)
@Warmup(iterations = 5, timeUnit = TimeUnit.NANOSECONDS)
@Measurement(iterations = 5, timeUnit = TimeUnit.NANOSECONDS)
@Fork(value = 5, warmups = 1)
@State(Scope.Benchmark)
public class OptionalJmh {

  @Param({"77"})
  public static Integer intValue;

  static Outer outer = new Outer(intValue); // initializes and links Outer - Nested - Inner

  @Setup
  public void setup(){
    outer = new Outer(intValue);
  }

  public static void main(String[] args) throws RunnerException {

    Options opt =
      new OptionsBuilder()
        .include(OptionalJmh.class.getSimpleName())
        .build();
    new Runner(opt).run();
  }

  @Benchmark
  public static int optionalChain() {
    return Optional.of(outer)
      .flatMap(o -> Optional.ofNullable(o.nested))
      .flatMap(n -> Optional.ofNullable(n.inner))
      .flatMap(i -> Optional.ofNullable(i.value))
      .get();
  }

  @Benchmark
  public static int ifComparison() {
    return (outer != null && outer.nested != null && outer.nested.inner != null) ? outer.nested.inner.value : null;
  }
}
```

Test output:

```
Benchmark                 (intValue) Mode Cnt Score Error Units

OptionalJmh.ifComparison          77 avgt 25 2.939 ± 0.076 ns/op
OptionalJmh.optionalChain         77 avgt 25 3.327 ± 0.507 ns/op
```

*Tests triggered using JDK 10 (latest JDK release at the moment) on my machine (CPU: Intel i7-6700HQ Skylake; MEMORY: 16GB DDR4 2133 MHz; OS: Ubuntu 16.04.2)*

## ifComparison Under the Hood

As we might notice, there is a slightly better response time in case of **ifComparison** than **optionalChain**. But what really happens? To understand it better, of course we are getting back to your assembly friend :).

Let’s zoom first inside **ifComparison** generated code:

```
// OptionalJmh.ifComparison()I

movabs r10,0x6d7104290 // {oop(a &apos;java/lang/Class&apos;{0x00000006d7104290} = &apos;OptionalJmh&apos;)}
mov r10d,DWORD PTR [r10+0x74]

//*getstatic outer
mov r11d,DWORD PTR [r12+r10*8+0xc]

//*getfield nested
// implicit exception: dispatches to 0x00007f4bd6fc2dea
mov ebp,DWORD PTR [r12+r11*8+0xc]

//*getfield inner
// implicit exception: dispatches to 0x00007f4bd6fc2dfa
mov r10d,DWORD PTR [r12+rbp*8+0xc]

//*getfield value
// implicit exception: dispatches to 0x00007f4bd6fc2e0a
mov eax,DWORD PTR [r12+r10*8+0xc]

//*getfield value
// implicit exception: dispatches to 0x00007f4bd6fc2ddb
```

As per above code, we can easily spot there is no explicit null check, even if the original Java source code contains a bunch of explicit comparisons. What really happens is that Just In Time Compiler sees that all values are not null (i.e. **outer != null**; **nested != null**; **inner != null**) and decides to optimistically optimize them by completely removing the explicit null check (which make sense since everything is not null and the check condition always follow the same branch). But in case this assumption is not valid anymore (i.e. imagine there might be another thread that set one reference to null: **outer.nested = null**), the optimization is invalidated, an uncommon trap is hit and the execution switches back to the Interpreter, which slows down the performance. (i.e. see the assembly code *“implicit exception: dispatches to <address>”* which actually relies on SEGFAULT triggered when accessing something null, natively provided by hardware). It might be re-compiled afterwards, depending on the execution path at runtime. For more details about this kind of optimization please check the video [Java performance techniques. The cost of HotSpot runtime optimizations](https://www.youtube.com/watch?v=QJYmERaS7vo) (sections “Uncommon traps” and “Null sanity checks”).

## optionalChain Under the Hood

The analogous **optionalChain** generated code is:

```
mov r10d,DWORD PTR [r10+0x74] //*getstatic outer
test r10d,r10d
je 0x00007ff9d7625571 //*ifnonnull
shl r10,0x3 //*checkcast

mov ebp,DWORD PTR [r10+0xc] //*getfield nested
test ebp,ebp
je 0x00007ff9d7625582 //*ifnonnull
lea r10,[r12+rbp*8] //*checkcast

mov ebp,DWORD PTR [r10+0xc] //*getfield inner
test ebp,ebp
je 0x00007ff9d762558e //*ifnonnull
lea r10,[r12+rbp*8] //*checkcast

mov ebp,DWORD PTR [r10+0xc] //*getfield value
mov eax,DWORD PTR [r12+rbp*8+0xc] //*getfield value
```

In comparison to the previous **ifComparison** version, in this case the Optional API code does an explicit null check and a cast for each indirection call (e.g. Outer -> Nested -> Inner) which might be a reasonable explanation for the difference in performance between these two.

## Conclusion

I might admit probably it is not quite significant, since it is less than 1 ns/op as spotted by this test case. However, I would encourage you to favor clean code over performance optimization tricks which might add complexity. If the case, then you can keep this in mind and if the application bottleneck comes out of this, which I doubt, then you can rely on these refined optimizations.

---

**Tags**: Java, JDK 8, Optional API, Null Check, Performance, JIT Compiler, JMH, Microbenchmark, Functional Programming, Java Performance

# Chaining lambda optimizations in HotSpot VM and GraalVM

## Content

- [Motivation](#motivation)
- [The problem](#the-problem)
- [Microbenchmark](#microbenchmark)
- [Under the Hood](#under-the-hood)
- [Conclusions](#conclusions)

## Motivation

Current post tackles the problem of chaining (or linking) multiple lambda calls which seem to be differently optimized by the HotSpot Just In Time Compiler C2 (i.e. JIT C2) and GraalVM JIT Compiler. In this regard, I would propose to start detailing the problem, to run and check the benchmark results, to find out what is really happening and to provide some valuable advice for you.

## The problem

Let’s suppose there are few chained lambda calls which, in the end, return a value, as for example:

### **λ → λ → λ → λ → … → λ**

– OR –

### **() -> () -> () -> () -> … -> () -> return**

This might not be far away for a real use case scenario, imagine for example we have to dispatch the request from one caller to another (e.g. chain of responsibility pattern) or maybe to compute a mathematical formula by calling in sequence few functions, each applying a different computation on the incoming request, etc.

## Microbenchmark

I have created a synthetic benchmark around this problem using different levels of call depth, in order to stress the JIT Compiler and to check how it performs the runtime optimizations.

```java
@BenchmarkMode(Mode.AverageTime)
@OutputTimeUnit(TimeUnit.NANOSECONDS)
@Warmup(iterations = 5, time = 1, timeUnit = TimeUnit.SECONDS)
@Measurement(iterations = 5, time = 1, timeUnit = TimeUnit.SECONDS)
@Fork(value = 3, warmups = 1, jvmArgsAppend = {})
@State(Scope.Benchmark)
public class ChainingLambdaBenchmark {

  @Param({"77"})
  public static Integer value;

  public static void main(String[] args) throws RunnerException {

    Options opt =
      new OptionsBuilder()
        .include(ChainingLambdaBenchmark.class.getSimpleName())
        .build();
    new Runner(opt).run();
  }

  @Benchmark
  public int baseline() {
    return value;
  }

  @Benchmark
  public int depth1() {
    Level9 l9;
    Level10 l10;

    l10 = () -> value;
    l9 = () -> l10;

    return l9.next().get();
  }

  @Benchmark
  public int depth2() {
    Level8 l8;
    Level9 l9;
    Level10 l10;

    l10 = () -> value;
    l9 = () -> l10;
    l8 = () -> l9;

    return l8.next().next().get();
  }

  @Benchmark
  public int depth3() {
    Level7 l7;
    Level8 l8;
    Level9 l9;
    Level10 l10;

    l10 = () -> value;
    l9 = () -> l10;
    l8 = () -> l9;
    l7 = () -> l8;

    return l7.next().next().next().get();
  }

  @Benchmark
  public int depth5() {
    Level5 l5;
    Level6 l6;
    Level7 l7;
    Level8 l8;
    Level9 l9;
    Level10 l10;

    l10 = () -> value;
    l9 = () -> l10;
    l8 = () -> l9;
    l7 = () -> l8;
    l6 = () -> l7;
    l5 = () -> l6;

    return l5.next().next().next().next().next().get();
  }

  @Benchmark
  public int depth10() {
    Level0 l0;
    Level1 l1;
    Level2 l2;
    Level3 l3;
    Level4 l4;
    Level5 l5;
    Level6 l6;
    Level7 l7;
    Level8 l8;
    Level9 l9;
    Level10 l10;

    l10 = () -> value;
    l9 = () -> l10;
    l8 = () -> l9;
    l7 = () -> l8;
    l6 = () -> l7;
    l5 = () -> l6;
    l4 = () -> l5;
    l3 = () -> l4;
    l2 = () -> l3;
    l1 = () -> l2;
    l0 = () -> l1;

    return l0.next().next().next().next().next().next().next().next().next().next().get();
  }
}
```

*Please find below additional benchmark classes for each Level.*

```java
@FunctionalInterface
public interface Level0 {
  Level1 next();
}

@FunctionalInterface
public interface Level1 {
  Level2 next();
}

@FunctionalInterface
public interface Level2 {
  Level3 next();
}

@FunctionalInterface
public interface Level3 {
  Level4 next();
}

@FunctionalInterface
public interface Level4 {
  Level5 next();
}

@FunctionalInterface
public interface Level5 {
  Level6 next();
}

@FunctionalInterface
public interface Level6 {
  Level7 next();
}

@FunctionalInterface
public interface Level7 {
  Level8 next();
}

@FunctionalInterface
public interface Level8 {
  Level9 next();
}

@FunctionalInterface
public interface Level9 {
  Level10 next();
}

@FunctionalInterface
public interface Level10 {
  Integer get();
}
```

I ran the benchmark twice, first time with Oracle HotSpot VM and second using GraalVM, as per below details:

- **Case I** – Oracle HotSpot VM with JIT C2 (e.g. jdk-11.0.2\_linux-x64)
- **Case II** – GraalVM with Graal JIT (e.g. graalvm-ee-1.0.0-rc12-linux-amd64)

*Tests were triggered using the following configuration: CPU: Intel i7-8550U Kaby Lake R; MEMORY: 16GB DDR4 2400 MHz; OS: Ubuntu 18.10*

**Case I results – HotSpot VM w/ JIT C2**

```
Benchmark                        Mode Cnt Score Error Units

baseline                         avgt 15 2.259 ± 0.062 ns/op
baseline:·gc.alloc.rate          avgt 15 ≈ 10⁻⁴ MB/sec
baseline:·gc.alloc.rate.norm     avgt 15 ≈ 10⁻⁶ B/op
baseline:·gc.count               avgt 15 ≈ 0 counts

depth1                           avgt 15 2.168 ± 0.082 ns/op
depth1:·gc.alloc.rate            avgt 15 ≈ 10⁻⁴ MB/sec
depth1:·gc.alloc.rate.norm       avgt 15 ≈ 10⁻⁶ B/op
depth1:·gc.count                 avgt 15 ≈ 0 counts

depth2                           avgt 15 4.327 ± 0.134 ns/op
depth2:·gc.alloc.rate            avgt 15 2350.611 ± 72.089 MB/sec
depth2:·gc.alloc.rate.norm       avgt 15 16.000 ± 0.001 B/op
depth2:·gc.count                 avgt 15 171.000 counts

depth3                           avgt 15 6.760 ± 0.185 ns/op
depth3:·gc.alloc.rate            avgt 15 3008.303 ± 81.393 MB/sec
depth3:·gc.alloc.rate.norm       avgt 15 32.000 ± 0.001 B/op
depth3:·gc.count                 avgt 15 204.000 counts

depth5                           avgt 15 12.029 ± 0.978 ns/op
depth5:·gc.alloc.rate            avgt 15 3396.754 ± 261.677 MB/sec
depth5:·gc.alloc.rate.norm       avgt 15 64.000 ± 0.001 B/op
depth5:·gc.count                 avgt 15 176.000 counts

depth10                          avgt 15 26.190 ± 0.947 ns/op
depth10:·gc.alloc.rate           avgt 15 3495.780 ± 121.156 MB/sec
depth10:·gc.alloc.rate.norm      avgt 15 144.000 ± 0.001 B/op
depth10:·gc.count                avgt 15 220.000 counts
```

Base on the above results we might conclude:

- the cost of the call chain seems to be related to the depth (i.e. bigger the depth is, higher the response time).
- response time in case of baseline and depth1 looks very fast (e.g. 2.2 ns/op), however, starting with depth2 it becomes slower and slower
- the allocation rate is also free in case of baseline and depth1 but it becomes heavier and heavier for the rest of the calls (e.g. depth2, depth3, depth5, and depth10)

**Case II results – GraalVM EE w/ Graal JIT**

```
Benchmark                        Mode Cnt Score Error Units

baseline                         avgt 15 2.582 ± 0.149 ns/op
baseline:·gc.alloc.rate          avgt 15 1.366 ± 4.500 MB/sec
baseline:·gc.alloc.rate.norm     avgt 15 0.006 ± 0.019 B/op
baseline:·gc.count               avgt 15 1.000 counts

depth1                           avgt 15 2.550 ± 0.111 ns/op
depth1:·gc.alloc.rate            avgt 15 5.124 ± 20.939 MB/sec
depth1:·gc.alloc.rate.norm       avgt 15 0.020 ± 0.081 B/op
depth1:·gc.count                 avgt 15 ≈ 0 counts

depth2                           avgt 15 2.431 ± 0.078 ns/op
depth2:·gc.alloc.rate            avgt 15 0.029 ± 0.065 MB/sec
depth2:·gc.alloc.rate.norm       avgt 15 ≈ 10⁻⁴ B/op
depth2:·gc.count                 avgt 15 ≈ 0 counts

depth3                           avgt 15 2.590 ± 0.148 ns/op
depth3:·gc.alloc.rate            avgt 15 0.177 ± 0.733 MB/sec
depth3:·gc.alloc.rate.norm       avgt 15 0.001 ± 0.003 B/op
depth3:·gc.count                 avgt 15 ≈ 0 counts

depth5                           avgt 15 2.497 ± 0.171 ns/op
depth5:·gc.alloc.rate            avgt 15 0.069 ± 0.222 MB/sec
depth5:·gc.alloc.rate.norm       avgt 15 ≈ 10⁻⁴ B/op
depth5:·gc.count                 avgt 15 ≈ 0 counts

depth10                          avgt 15 2.487 ± 0.130 ns/op
depth10:·gc.alloc.rate           avgt 15 3.011 ± 11.355 MB/sec
depth10:·gc.alloc.rate.norm      avgt 15 0.012 ± 0.045 B/op
depth10:·gc.count                avgt 15 ≈ 0 counts
```

In contrast to the HotSpot JIT C2, Graal JIT offers almost the same response time (e.g. around 2.5 ns/op) and a keeps a very low allocation rate (e.g. Garbage Collector counter is 0), independent of the call depth. This might be the outcome of some nice optimizations happening under the hood, emphasizing some differences between HotSpot JIT C2 and Graal JIT.

Are you curious to find out more? Me too, hence let’s zoom in to see what happens, by revealing the bytecode and assembly generated.

## **Under the Hood**

In my opinion, depth1 and depth2 are the most interesting cases to look at, since the performance seems degrading starting depth2 in HotSpot VM. By understanding these cases we can have a clue about what is really happening in other situations (e.g. depth3, depth5, and depth10).

The things look easier in case of Graal JIT since the response time and allocation rate is constant and similar, hence analyzing just one scenario, for example, depth2, might be enough.

### HotSpot JIT C2 Analysis

**Depth1 – bytecode**

```
...
invokedynamic   #14, 0// InvokeDynamic #1:get:(LChainingLambdaBenchmark;)LLevel10;
invokedynamic   #15, 0// InvokeDynamic #2:next:(LLevel10;)LLevel9;
...
invokeinterface #16, 1// InterfaceMethod Level9.next:()LLevel10;
invokeinterface #17, 1// InterfaceMethod Level10.get:()Ljava/lang/Integer;
invokevirtual   #13   // Method java/lang/Integer.intValue:()I
...
```

The bytecode contains two INVOKEDYNAMIC calls for creating lambda object instances, then the lambda chain calls (e.g. next() calls) are performed by sequential INVOKEINTERFACE invocations (since the methods belong to interfaces) and the final result is returned by INVOKEVIRTUAL which dispatches to Integer.intValue().

**Depth1 – assembly**

```
...
movabs r10,0x71b8ae1b8 ; {oop(a &apos;java/lang/Class&apos;{0x000000071b8ae1b8} = &apos;ChainingLambdaBenchmark&apos;)}
mov r11d,DWORD PTR [r10+0x70]
;*getstatic value {reexecute=0 rethrow=0 return_oop=0}
; - ChainingLambdaBenchmark::lambda$depth2$2@0
; - ChainingLambdaBenchmark$Lambda$44/0x0000000800112440::get@0
mov eax,DWORD PTR [r12+r11*8+0xc]
;*getfield value {reexecute=0 rethrow=0 return_oop=0}
; - java.lang.Integer::intValue@1
...
```

HotSpot JIT C2 was able to remove the intermediate lambda call (superfluous in this synthetic benchmark) and to return the final value directly. Implicitly, the JIT C2 Compiler was also able to get rid of intermediate object lambda allocation. This optimization is similar to the baseline case.

**Depth2 – bytecode**

```
...
invokedynamic   #18, 0// InvokeDynamic #3:get:(LChainingLambdaBenchmark;)LLevel10;
invokedynamic   #19, 0// InvokeDynamic #4:next:(LLevel10;)LLevel9;
invokedynamic   #20, 0// InvokeDynamic #5:next:(LLevel9;)LLevel8;
...
invokeinterface #21, 1// InterfaceMethod Level8.next:()LLevel9;
invokeinterface #16, 1// InterfaceMethod Level9.next:()LLevel10;
invokeinterface #17, 1// InterfaceMethod Level10.get:()Ljava/lang/Integer;
invokevirtual   #13   // Method java/lang/Integer.intValue:()I
...
```

Quite similar to depth1, there are three INVOKEDYNAMIC invocations for creating lambda object instances, then the call chain performs few INVOKEINTERFACE calls and the final result (i.e. Integer.intValue()) is returned by the INVOKEVIRTUAL.

**Depth2 – assembly**

```
...
// Lambda$1::new ;() -> value
mov DWORD PTR [rax+0x8],0x60840 ;{metadata('ChainingLambdaBenchmark$Lambda$1')}
mov r11,rbp
shr r11,0x3
mov DWORD PTR [rax+0xc],r11d ;*new {reexecute=0 rethrow=0 return_oop=0}
; - ChainingLambdaBenchmark$Lambda$1/0x0000000800060840::get$Lambda@0
mov rbp,rax ;*areturn {reexecute=0 rethrow=0 return_oop=0}
; - ChainingLambdaBenchmark$Lambda$1/0x0000000800060840::get$Lambda@8
// Lambda$2::new ;() -> Level10
mov DWORD PTR [rax+0x8],0x60c40 ;{metadata('ChainingLambdaBenchmark$Lambda$2')}
mov r10,rbp
shr r10,0x3
mov DWORD PTR [rax+0xc],r10d ;*new {reexecute=0 rethrow=0 return_oop=0}
; - ChainingLambdaBenchmark$Lambda$2/0x0000000800060c40::get$Lambda@0
mov rbp,rax ;*areturn {reexecute=0 rethrow=0 return_oop=0}
; - ChainingLambdaBenchmark$Lambda$2/0x0000000800060c40::get$Lambda@8

mov r11,rax
shr r11,0x9
movabs r8,0x7f7ad22a0000

// OBS: Heap allocation for Lambda$3 (i.e. () -> Level9) was eliminated due to inlining at this BCI
mov BYTE PTR [r8+r11*1],0x0 ;*invokespecial <init> {reexecute=0 rethrow=0 return_oop=0}
; - ChainingLambdaBenchmark$Lambda$3/0x0000000800061840::get$Lambda@5
//
//
// Level9::next
mov ebp,DWORD PTR [rbp+0xc] ;*getfield arg$1 {reexecute=0 rethrow=0 return_oop=0}
; - ChainingLambdaBenchmark$Lambda$2/0x0000000800060c40::next@1
mov r10d,DWORD PTR [r12+rbp*8+0x8]

// Level10::get
lea r10,[r12+rbp*8] ;*invokeinterface get {reexecute=0 rethrow=0 return_oop=0}
mov r11d,DWORD PTR [r10+0xc] ;*getfield arg$1 {reexecute=0 rethrow=0 return_oop=0}
; - ChainingLambdaBenchmark$Lambda$1/0x0000000800060840::get@1

// get field value
mov r10d,DWORD PTR [r12+r11*8+0xc] ;*getfield value {reexecute=0 rethrow=0 return_oop=0}
; - ChainingLambdaBenchmark$Lambda$1/0x0000000800060840::get@4
; implicit exception: dispatches to 0x00007f7ac4cae52a
// return Integer::intValue()
mov eax,DWORD PTR [r12+r10*8+0xc] ;*getfield value {reexecute=0 rethrow=0 return_oop=0}
; - java.lang.Integer::intValue@1
;implicit exception: dispatches to 0x00007f7ac4cae536
...
```

At first glance it might look a bit complicated, however, it is not so difficult to understand. It starts by allocating two lambda object instances corresponding to Lambda$1 (i.e. () -> value) and Lambda$2 (i.e. () -> Level10). Then, JIT C2 Compiler optimizes the first lambda call from this chain (i.e. Lambda$3, corresponding to () -> Level9) by inlining and eliminating the heap allocation. Then, the Compiler performs the calls in a sequential fashion, as they are declared in the Java source code:  Level9::next -> Level10::get -> Integer::intValue.

All these lambda object allocations and virtual calls explain why the performance is degraded and why the Garbage Collector has more work to do in collecting the garbage, in comparison to the previous, depth1, test case.

Similar optimization pattern happens for depth3, depth5, and depth10 which proves the performance penalty spotted as well by the benchmark.

### Graal JIT Analysis

**Depth2 – bytecode**

The bytecode is similar to the one above already described (see depth2 from HotSpot JIT C2), hence no reason to duplicate it.

**Depth2 – assembly**

```
mov eax,DWORD PTR [rsi+0xc] ;*aload_0 {reexecute=1 rethrow=0 return_oop=0}
; - ChainingLambdaBenchmark::depth2@0
mov eax,DWORD PTR [rax*8+0xc] ; implicit exception: deoptimizes
; OopMap{rsi=Oop off=51}
```

The assembly looks extremely nice, isn’t!? Graal JIT optimizes the call by removing all chained lambdas together with associated heap allocations, it just returns the value belonging to the current object instance.

The other calls (e.g. depth1, depth3, depth5, and depth10) are optimized in a similar manner by Graal JIT.

## **Conclusions**

**HotSpot JIT C2**

- JIT C2 Compiler is able to optimize(i.e. inline) chaining lambda calls up to a certain extent, afterward it deals with lambda object allocations and additional method calls. In our benchmark, depth1 offers similar performance to the baseline, however for depth2, depth3, depth5, and depth10 cases JIT C2 could not fully optimize the chained lambdas.
- As a matter of precaution, please be careful when writing code which follows the same pattern, it might affect the overall performance of your application.
- I would rather advise you to even limit the chained lambda depth, if possible!

**Graal JIT**

- Using Graal JIT there is not much to worry about, since the Compiler optimizes the code in a more efficient way (i.e. inlining chained lambdas), offering a better response time.

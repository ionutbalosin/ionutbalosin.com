# Kotlin explicit inlining at megamorphic call-sites pays off in performance

## Content

- [Motivation](#motivation)
- [A Bit of Theory](#a-bit-of-theory)
- [Microbenchmark](#microbenchmark)
- [Under the Hood](#under-the-hood)
- [Conclusions](#conclusions)
- [Further Reading](#further-reading)

## Motivation

In the current post, I would like to investigate how megamorphic call-sites are optimized in Kotlin as a result of explicit inlining (using the explicit **inline** modifier) and what is the performance gain out of it. The idea crossed my mind while I was reading the official [kotlinlang.org](https://kotlinlang.org/docs/reference/inline-functions.html) website which mentions *“inlining may cause the generated code to grow; however, if we do it in a reasonable way (i.e. avoiding inlining large functions), it will pay off in performance, especially at ‘megamorphic*‘*call-sites inside loops”,* so I decided to create a benchmark and to test it.

## A Bit of Theory

Just before digging into the real problem, I would like to shortly explain a few terms used by the article.

A **call-site** is actually the location (line of code) where the function is called (i.e. invoked by the caller).

```kotlin
fun execute(cmath: CMath): Int {
  return cmath.compute(Int) // call-site
}
```

Now, imagine we have a polymorphic hierarchy of classes, as per below:

![](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/kotlin-explicit-inlining-at-megamorphic-call-sites-pays-off-in-performance/PolimorphicClassHierarchy.png)

where every child extends the base **CMath** class and overrides the method **compute**(Int).

Method **CMath:**: **compute(Int)** might be called at runtime using different child implementations and in order to get the right implementation there is a method lookup in a table, called a vtable. However, the vtable lookup adds delay and compilers try to optimize the call-site by removing the lookup, whenever possible. One common tactic is to use inlining (i.e. for method body or [cache inlining](https://en.wikipedia.org/wiki/Inline_caching)), however, in other few (probably marginal) cases, the inlining heuristics might not be enough for a compiler to produce the most optimal code. Kotlin has introduced the explicit **inline** modifier which might be handy in such exceptional situations.

A **monomorphic call-site** is one which optimistically points to the only concrete method that has ever been used at that particular call-site. Based on our class hierarchy and the provided code sample, it happens if at runtime only one **CMath**method implementation (e.g. Alg1::compute() ) is passed at the call-site.

```
var alg1: CMath = Alg1()
execute(alg1)
```

A **bimorphic call-site** is one which points to only two concrete methods which can be invoked at a particular call-site, as per below:

```
var alg1: CMath = Alg1()
var alg2: CMath = Alg2()
execute(alg1)
execute(alg2)
```

A **megamorphic call-site** is one which points to three or possibly more methods which can be invoked at a particular call-site. In our example, this happens when the call-site experiences all three or four possible implementations for **CMath**:

```
var alg1: CMath = Alg1()
var alg2: CMath = Alg2()
var alg3: CMath = Alg3()
var alg4: CMath = Alg4()
execute(alg1)
execute(alg2)
execute(alg3)
execute(alg4)
```

## Microbenchmark

In order to test the Kotlin explicit inlining in context of polymorphic call-sites (e.g. monomorphic, bimorphic and megamorphic), I wrote a small benchmark. You can get the full [source code](https://github.com/ionutbalosin/kotlin-vs-java-benchmarks/blob/master/src/main/kotlin/org/ib/benchmark/MegamorphicCallKtBenchmark.kt) GitHub.

```java
@BenchmarkMode(Mode.AverageTime)
@OutputTimeUnit(TimeUnit.NANOSECONDS)
@Warmup(iterations = 5, time = 1, timeUnit = TimeUnit.SECONDS)
@Measurement(iterations = 5, time = 1, timeUnit = TimeUnit.SECONDS)
@Fork(value = 3, jvmArgsAppend = ["-XX:-TieredCompilation"])
@State(Scope.Benchmark)
class MegamorphicCallKtBenchmark {

  @Param("3")
  var param: Int = 0

  @Benchmark
  @Group("Monomorphic")
  fun monomorphicCall(state: MonomorphicState): Int {
    return execute(alg1, param)
  }

  @Benchmark
  @Group("Bimorphic")
  fun bimorphicCall(state: BimorphicState): Int {
    return execute(alg1, param) + execute(alg2, param)
  }

  @Benchmark 
  @Group("Megamorphic3")
  fun megamorphic3Call(state: Megamorphic3State): Int {
    return execute(alg1, param) + execute(alg2, param) + execute(alg3, param)
  }

  @Benchmark
  @Group("Megamorphic4")
  fun megamorphic4Call(state: Megamorphic4State): Int {
    return execute(alg1, param) + execute(alg2, param) + execute(alg3, param) + execute(alg4, param)
  }

  // Explicit inlining in the method signature
  internal inline fun execute(cmath: CMath, i: Int): Int {
    return cmath.compute(i)
  }
}
```

I launched the benchmark twice:

- first-time by choosing an **explicit inlining** policy for the execute() method
- second time **without explicit** **inlining**, just leveraging on default Just In Time Compiler behavior (for optimizations)

and I got the below results:

**Case I – explicit inlining**

```
Benchmark     Mode Cnt Score Error Units
Monomorphic   avgt 15 3.925 ± 0.151 ns/op
Bimorphic     avgt 15 4.276 ± 0.187 ns/op
Megamorphic3  avgt 15 4.958 ± 0.209 ns/op
Megamorphic4  avgt 15 5.229 ± 0.235 ns/op
```

**Case II – without explicit inlining**

```
Benchmark     Mode Cnt Score Error Units
Monomorphic   avgt 15 3.957 ± 0.100 ns/op
Bimorphic     avgt 15 4.545 ± 0.178 ns/op
Megamorphic3  avgt 15 6.189 ± 0.190 ns/op
Megamorphic4  avgt 15 10.781 ± 0.393 ns/op
```

*Tests were triggered using the following configuration: CPU: Intel i7-8550U Kaby Lake R; MEMORY: 16GB DDR4 2400 MHz; OS: Ubuntu 18.10; GraalVM (e.g. graalvm-ee-1.0.0-rc13-linux-amd64)*

As already highlighted, the noticeable difference between the two runs is in case of **megamorphic3** and **megamorphic4**. At first glance, it looks like the explicit Kotlin inlining helps  Graal Just In Time (JIT) Compiler to enable better optimizations in comparison to the default scenario when the developer did not use inlining in the method signature.

Let’s move to the next step and try to investigate what really happens under the hood.

## Under the Hood

Since the performance starts degrading with the **megamorphic3**test case, I propose to investigate only this one. The next case **megamorphic4** might be similar to this, hence understanding one might be enough to have a clue for the other.

And of course, our best friend is again the assembly code generated. It reveals what really happens at runtime (in terms of optimizations) which might lead us towards a better understanding.

**Case I – megamorphic3 with explicit inlining (generated assembly)**

```
mov r11,QWORD PTR [rsp+0x18]
mov rdi,QWORD PTR [rsp+0x20]

mov r9d,DWORD PTR [r11+0xc] ;*aload
cmp DWORD PTR [r9*8+0x8],0xf80661aa
; implicit exception: deoptimizes
; {metadata(&apos;Alg1&apos;)}
jne 0x00007f2cf40f2c11 ;*invokevirtual compute
//
mov r9d,DWORD PTR [r11+0x10] ;*aload
cmp DWORD PTR [r9*8+0x8],0xf80661e9
; implicit exception: deoptimizes
; {metadata(&apos;Alg2&apos;)}
jne 0x00007f2cf40f2c11 ;*invokevirtual compute
//
mov r9d,DWORD PTR [r11+0x14] ;*aload
cmp DWORD PTR [r9*8+0x8],0xf8066228
; implicit exception: deoptimizes
; {metadata(&apos;Alg3&apos;)}
jne 0x00007f2cf40f2c11 ;*invokevirtual compute
//
// --------------------------------------------------------------------//
//
mov r9d,DWORD PTR [r10+0x6c] ;*getstatic param
mov ecx,r9d
shl ecx,0x4
add ecx,r9d ;*imul
; - Alg1::compute@3
imul ebx,r9d,0x13 ;*imul
; - Alg2::compute@3
add ecx,ebx ;*iadd

imul r9d,r9d,0x17 ;*imul
; - Alg3::compute@3
add ecx,r9d ;*iadd
```

Since we explicitly requested to inline the **execute**() method, Kotlin compiler took the body of the method and plopped it into the call-site, in place of the method call, ahead of time, during compilation process while generating the bytecode. So basically what happened is the following:

```kotlin
// Before: initial code
fun megamorphic3Call(): Int {
  return execute(alg1, param) +
    execute(alg2, param) +
    execute(alg3, param)
  }

// After: Kotlin compiler inlines the code at call-site
fun megamorphic3Call(): Int {
  return alg1.compute(param) +
    alg2.compute(param) +
    alg3.compute(param)
}
```

Basically, Kotlin compiler turned out the megamorphic call-site into a monomorphic one, as an effect of explicit inlining, even before Graal JIT Compiler to kick in any optimization at runtime.

Based on the generated assembly code, the upper part of it contains some pre-checks including implicit deoptimizations which might be triggered in case of CMath instance is not of a known type (e.g. neither Alg1, Alg2, nor Alg3). Usually, it should not happen unless some other CMath children class is dynamically loaded at runtime or due to reflection which alters the initial polymorphic hierarchy (known by the ClassLoader).

In the lower part of the assembly, things look nice and clean. This actually reveals the full computation chain as a result of explicit inlining, where everything is deoptimized, bypassing the virtual calls overhead.

To summarize, Lines 24-35 from assembly listing are actually computing:

```kotlin
fun megamorphic3Call(): Int {
  // Graal JIT optimizations
  return (param * 17) + // Alg1::compute
    (param * 19) + // Alg2::compute
    (param * 23) // Alg3::compute
}
```

which is the final result.

**Case II – megamorphic3 without explicit inlining (generated assembly)**

```
mov r10,QWORD PTR [rsp+0x18] ;*aload
mov ecx,DWORD PTR [r11+0x6c] ;*getstatic param
mov ebx,DWORD PTR [r8+0xc]
shl rbx,0x3 ;*getfield alg1
mov rsi,r10 ;*invokevirtual execute
call 0x00007fb6d80480a0 ;*invokevirtual execute
//
mov ecx,DWORD PTR [r11+0x6c] ;*getstatic param
mov r10,QWORD PTR [rsp+0x28]
mov esi,DWORD PTR [r10+0x10]
mov edx,esi
shl rdx,0x3 ;*getfield alg2
mov rsi,QWORD PTR [rsp+0x18] ;*invokevirtual execute
mov DWORD PTR [rsp+0xc],eax
call 0x00007fb6d80480a0 ;*invokevirtual execute
//
mov ecx,DWORD PTR [r11+0x6c] ;*getstatic param
mov r10,QWORD PTR [rsp+0x28]
mov esi,DWORD PTR [r10+0x14]
mov edx,esi
shl rdx,0x3 ;*getfield alg3
//
add eax,DWORD PTR [rsp+0xc] ;*iadd
//
mov rsi,QWORD PTR [rsp+0x18] ;*invokevirtual execute
mov DWORD PTR [rsp+0xc],eax
call 0x00007fb6d80480a0 ;*invokevirtual execute
//
add eax,DWORD PTR [rsp+0xc] ;*iadd
```

Without explicit inlining, there are three virtual calls towards **execute**() method which makes it slower, in comparison to the previous case when the developer decided to inline. Probably in such case Graal JIT Compiler should trigger, at runtime, a more aggressive inlining in order to end up with similar optimizations, without being a need for explicit inlining.

## **Conclusions**

- Inlining expanded the scope of other optimizations. In our case, by explicit inlining of the callee, containing the megamorphic call-site, it ended up in downgrading it to a monomorphic call-site which helped Graal JIT Compiler to further inline it and to get rid of the virtual calls.
- Explicit inlining was proved as an efficient approach since it improved the performance. For programs which consist of small such methods, inlining might result in a significant speedup. This might be a hint (or trick) you should keep in mind and eventually apply it.
- However, be very careful, inlining is a double sword! I would really advise you to not abuse using it. The current scenario is probably one of the very few cases when you should consider to explicitly use inlining. In almost all the other situations it might be better to let the JIT Compiler decide for better optimizations.

## **Further Reading**

- [How Much Inlining Can We Do?](http://psy-lob-saw.blogspot.com/2018/07/how-inlined-code-confusing-profiles.html) by Nitsan Wakart
- [Virtual Calls](https://wiki.openjdk.java.net/display/HotSpot/VirtualCalls) by John Rose
- [The Black Magic of (Java) Method Dispatch](https://shipilev.net/blog/2015/black-magic-method-dispatch/) by Aleksey Shipilёv

---

**Tags**: Kotlin, JVM, Inlining, Megamorphic Call Sites, Performance, JIT Compiler, HotSpot, JMH, Microbenchmark, Compiler Optimizations, Java Interop

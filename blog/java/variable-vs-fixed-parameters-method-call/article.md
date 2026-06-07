# Variable vs Fixed Parameters Method Call

In this article I would like to reveal the differences and what happens under the hood between a variable parameters method and the same version but with fixed number of parameters, from a performance standpoint.

In regards to that I wrote a small program which tests the response time of calling a method with 2, 4, 6, 8, 10 fixed parameters versus the analogous varargs version. Please find the code below:

```java
@BenchmarkMode(Mode.AverageTime)
@OutputTimeUnit(TimeUnit.NANOSECONDS)
@Warmup(iterations = 5, timeUnit = TimeUnit.NANOSECONDS)
@Measurement(iterations = 5, timeUnit = TimeUnit.NANOSECONDS)
@Fork(value = 3, warmups = 1)
@State(Scope.Benchmark)
public class MethodParametersJmh {

  @Param({ "3" })
  int param1;
  @Param({ "5" })
  int param2;
  @Param({ "7" })
  int param3;
  @Param({ "9" })
  int param4;
  @Param({ "11" })
  int param5;
  @Param({ "13" })
  int param6;
  @Param({ "15" })
  int param7;
  @Param({ "17" })
  int param8;
  @Param({ "19" })
  int param9;
  @Param({ "21" })
  int param10;

  public static void main(String[] args) throws RunnerException {

    Options opt = new OptionsBuilder()
      .include(MethodParametersJmh.class.getName())
      .verbosity(VerboseMode.SILENT)
      .build();

    new Runner(opt).run();
  }

  @Benchmark
  public int explicit_2_params() {
    return explicit_2_params(param1, param2);
  }

  @Benchmark
  public int explicit_4_params() {
     return explicit_4_params(param1, param2, param3, param4);
  }

  @Benchmark
  public int explicit_6_params() {
    return explicit_6_params(param1, param2, param3, param4, param5, param6);
  }

  @Benchmark
  public int explicit_8_params() {
    return explicit_8_params(param1, param2, param3, param4, param5, param6, param7, param8);
  }

  @Benchmark
  public int explicit_10_params() {
    return explicit_10_params(param1, param2, param3, param4, param5, param6, param7, param8, param9, param10);
  }

  @Benchmark
  public int var_args_2_params() {
    return var_args(param1, param2);
  }

  @Benchmark
  public int var_args_4_params() {
    return var_args(param1, param2, param3, param4);
  }

  @Benchmark
  public int var_args_6_params() {
    return var_args(param1, param2, param3, param4, param5, param6);
  }

  @Benchmark
  public int var_args_8_params() {
    return var_args(param1, param2, param3, param4, param5, param6, param7, param8);
  }

  @Benchmark
  public int var_args_10_params() {
    return var_args(param1, param2, param3, param4, param5, param6, param7, param8, param9, param10);
  }

  private int explicit_2_params(int p1, int p2) {
    return p1 + p2;
  }

  private int explicit_4_params(int p1, int p2, int p3, int p4) {
    return p1 + p2 + p3 + p4;
  }

  private int explicit_6_params(int p1, int p2, int p3, int p4, int p5, int p6) {
    return p1 + p2 + p3 + p4 + p5 + p6;
  }

  private int explicit_8_params(int p1, int p2, int p3, int p4, int p5, int p6, int p7, int p8) {
    return p1 + p2 + p3 + p4 + p5 + p6 + p7 + p8;
  }

  private int explicit_10_params(int p1, int p2, int p3, int p4, int p5, int p6, int p7, int p8, int p9, int p10) {
    return p1 + p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9 + p10;
  }

  private int var_args(int... args) {
    int sum = 0;
    for (int i = 0; i &amp;amp;lt; args.length; i++)
    sum += args[i];
    return sum;
  }

}
```

Test output:

```
Benchmark                              Mode Cnt Score Error Units

MethodParametersJmh.explicit_2_params  avgt 15 2.304 ± 0.097 ns/op
MethodParametersJmh.explicit_4_params  avgt 15 2.575 ± 0.022 ns/op
MethodParametersJmh.explicit_6_params  avgt 15 3.015 ± 0.206 ns/op
MethodParametersJmh.explicit_8_params  avgt 15 3.342 ± 0.062 ns/op
MethodParametersJmh.explicit_10_params avgt 15 3.748 ± 0.110 ns/op

MethodParametersJmh.var_args_2_params  avgt 15 4.367 ± 0.364 ns/op
MethodParametersJmh.var_args_4_params  avgt 15 4.958 ± 0.067 ns/op
MethodParametersJmh.var_args_6_params  avgt 15 7.068 ± 0.812 ns/op
MethodParametersJmh.var_args_8_params  avgt 15 7.950 ± 1.151 ns/op
MethodParametersJmh.var_args_10_params avgt 15 8.676 ± 0.606 ns/op
```

*Tests triggered using JDK 10 (latest JDK release at the moment) on my machine (CPU: Intel i7-6700HQ Skylake; MEMORY: 16GB DDR4 2133 MHz; OS: Ubuntu 16.04.2)*

As we might easily notice, the explicit params version is faster and stick around 2 or 3 ns/op as opposite to varargs version which is always slower. Now, let’s see why exactly, what is the difference between these two.

Let’s zoom inside **var\_args\_4\_params** version which hopefully might clarify it:

```
mov DWORD PTR [rdx+0x8],0xf800016d // {metadata({type array int})}
mov DWORD PTR [rdx+0xc],0x4
// COLLECT STACK PARAMETERS
mov r10d,DWORD PTR [rbp+0x10] //*getfield param2
mov r8d,DWORD PTR [rbp+0x14] //*getfield param3
mov r11d,DWORD PTR [rbp+0x18] //*getfield param4
mov ecx,DWORD PTR [rbp+0xc] //*getfield param1
// ADD PARAMETERS TO ARRAY
mov DWORD PTR [rdx+0x10],ecx //*iastore
mov DWORD PTR [rdx+0x14],r10d //*iastore
mov DWORD PTR [rdx+0x18],r8d //*iastore
mov DWORD PTR [rdx+0x1c],r11d //*newarray
//
mov rsi,rbp
call 0x00007f68e963e8c0 //*invokespecial var_args
// {optimized virtual_call}
```

As spotted by assembly code above, before calling the variable parameters method:

- a new array is allocated
- all stack parameters (i.e. the varargs) are collected and assigned to the new array
- then the effective method is called by passing the newly allocated array as input

To summarize, a variable parameters method has an extra cost associated to a new array allocation and additional stack parameter manipulation which does not happen in case of calling a method with fixed number of parameters, which might explain the difference in response time between these two versions.

As a performance optimization advice, you can rely on this trick by declaring methods with explicit parameters for intensively or widely used APIs. A very good example is the Collection Factory Methods added in JDK 9 (e.g. see [List.of()](https://docs.oracle.com/javase/9/docs/api/java/util/List.html) or [Set.of()](https://docs.oracle.com/javase/9/docs/api/java/util/Set.html) or [Map.of()](https://docs.oracle.com/javase/9/docs/api/java/util/Map.html) ) which have dedicated implementations for a number of less or equal than 10 parameters and starting with the 11-th parameter there is a varargs method.

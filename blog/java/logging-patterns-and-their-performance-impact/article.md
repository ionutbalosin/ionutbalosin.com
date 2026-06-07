# Logging patterns and their performance impact

## Content

- [Motivation](#motivation)
- [Benchmark](#benchmark)
- [Conclusions](#conclusions)
- [Further Readings](#further-readings)

## Motivation

In the current post, I would like to explore different logging patterns and to identify which one is more efficient in terms of performance. Since logging is spread across almost every application, it is important to be aware of what is the most optimal pattern to rely on when writing logging messages. In this context, I would use a setup that is probably very common to most the business applications: logging text messages using SLF4J, as a facade, and LOG4J as a primary logging framework. In the case of any other logging framework, the majority of the things discussed here should still be relevant.

When it comes to performance there are a lot of additional techniques to take into consideration, which could potentially increase the logging throughput: for example switching from text messages to binary logging, using asynchronous appenders, using ramfs or tempfs, using a low latency logging framework, etc. Nevertheless, just for simplicity, I am going to ignore all of these for now and focus only on different logging alternatives at the Java source code level.

## Benchmark

Two important remarks in regards to the current benchmark:

1. the log level is set to INFO and DEBUG (see the **logLevel** variable), which means the messages intended to be logged by the benchmark on debug() will be, first ignored (in case of INFO log level), and then captured (in case of DEBUG log level)
2. inside the setup method of the benchmark, I explicitly removed all logger appenders and I have created a custom WritterAppender that uses the Blackhole to sink the messages, hence nothing is physically written (avoiding the IO latency).

```java
@BenchmarkMode(Mode.AverageTime)
@OutputTimeUnit(TimeUnit.NANOSECONDS)
@Warmup(iterations = 5, time = 3, timeUnit = TimeUnit.SECONDS)
@Measurement(iterations = 5, time = 3, timeUnit = TimeUnit.SECONDS)
@Fork(value = 3)
@State(Scope.Benchmark)
public class SLF4JLogRecordBenchmark {

  private static final Logger LOGGER = LoggerFactory.getLogger(SLF4JLogRecordBenchmark.class);

  @Param({"INFO", "DEBUG"})
  private static String theLevel;
  @Param({"P1"})
  private static String aString;
  @Param({"42"})
  private static int anInt;
  @Param({"00.42f"})
  private static float aFloat;
  @Param({"true"})
  private static boolean aBoolean;
  @Param({"!"})
  private static char aChar;
  private Level logLevel;

  @Setup
  public void setUp(final Blackhole blackhole) {
    ByteArrayOutputStream bos = new ByteArrayOutputStream() {
      @Override
      public void write(int b) {
        blackhole.consume(b);
      }

      @Override
      public void write(byte[] b, int off, int len) {
        blackhole.consume(b);
      }

      @Override
      public void write(byte[] b) {
        blackhole.consume(b);
      }
    };

    Logger logger = Logger.getLogger(LOGGER.getName());
    logger.removeAllAppenders();
    logger.setAdditivity(false);

    Appender appender = new WriterAppender(new PatternLayout(), bos);
    logger.addAppender(appender);

    logLevel = "INFO".equals(theLevel) ? Level.INFO : Level.DEBUG;
    logger.setLevel(logLevel);
  }

  @Benchmark
  public void string_format() {
    LOGGER.debug(format("Result [%s], [%s], [%s], [%s], [%s]", aString, ++anInt, aBoolean, aFloat++, aChar));
  }

  @Benchmark
  public void lambda_heap() {
    LOGGER.atDebug().log(() -> ("Result [" + aString + "], [" + (++anInt) + "], [" + aBoolean + "], [" + aFloat++) + "], [" + aChar + "]"));
  }

  @Benchmark
  public void lambda_local() {
    String localString = aString;
    int localInt = ++anInt;
    boolean localBoolean = aBoolean;
    float localFloat = aFloat++;
    char localChar = aChar;
    LOGGER.atDebug().log(() -> ("Result [" + localString + "], [" + localInt + "], [" + localBoolean + "], [" + localFloat + "], [" + localChar + "]"));
  }

  @Benchmark
  public void unguarded_parametrized() {
    LOGGER.debug("Result [{}], [{}], [{}], [{}], [{}]", aString, ++anInt, aBoolean, aFloat++, aChar);
  }

  @Benchmark
  public void guarded_parametrized() {
    if (LOGGER.isDebugEnabled()) {
      LOGGER.debug("Result [{}], [{}], [{}], [{}], [{}]", aString, ++anInt, aBoolean, aFloat++, aChar);
    }
  }

  @Benchmark
  public void unguarded_unparametrized() {
    LOGGER.debug("Result [" + aString + "], [" + (++anInt) + "], [" + aBoolean + "], [" + (aFloat++) + "], [" + aChar + "]");
  }

  @Benchmark
  public void guarded_unparametrized() {
    if (LOGGER.isDebugEnabled()) {
      LOGGER.debug("Result [" + aString + "], [" + (++anInt) + "], [" + aBoolean + "], [" + (aFloat++) + "], [" + aChar + "]");
    }
  }
}
```

### **Results**

**Case I** – log level is set to **INFO**. The highlighted results are better.

```
Benchmark                                      Mode Cnt Score Error Units

string_format                                  avgt 15 1709.122 ± 113.994 ns/op
string_format:·gc.alloc.rate.norm              avgt 15 1582.304 ± 3.308 B/op
string_format:·gc.count                        avgt 15 ≈ 0 counts

lambda_heap                                    avgt 15 2.292 ± 0.115 ns/op
lambda_heap:·gc.alloc.rate.norm                avgt 15 ≈ 10⁻⁶ B/op
lambda_heap:·gc.count                          avgt 15 ≈ 0 counts

lambda_local                                   avgt 15 3.011 ± 0.156 ns/op
lambda_local:·gc.alloc.rate.norm               avgt 15 ≈ 10⁻⁶ B/op
lambda_local:·gc.count                         avgt 15 ≈ 0 counts

unguarded_parametrized                         avgt 15 8.527 ± 0.377 ns/op
unguarded_parametrized:·gc.alloc.rate.norm     avgt 15 32.000 ± 0.001 B/op
unguarded_parametrized:·gc.count               avgt 15 260.000 counts

guarded_parametrized                           avgt 15 2.317 ± 0.184 ns/op
guarded_parametrized:·gc.alloc.rate.norm       avgt 15 ≈ 0 counts

unguarded_unparametrized                       avgt 15 99.336 ± 5.973 ns/op
unguarded_unparametrized:·gc.alloc.rate.norm   avgt 15 104.000 ± 0.001 B/op
unguarded_unparametrized:·gc.count             avgt 15 153.000 counts

guarded_unparametrized                         avgt 15 2.343 ± 0.121 ns/op
guarded_unparametrized:·gc.alloc.rate.norm     avgt 15 ≈ 10⁻⁶ B/op
guarded_unparametrized:·gc.count               avgt 15 ≈ 0 counts
```

*Configuration: CPU: Intel i7-8550U Kaby Lake R; MEMORY: 32GB DDR4 2400 MHz; OS: Ubuntu 19.04; OpenJDK 64-Bit Server VM version (build 13+33)*

**Case I** **– analysis**

In this scenario, nothing is logged, but there are quite important differences between each approach:

- **string\_format** – creates the final String, passes it to the debug() method, however, due to the fact the log level is INFO the String is not logged. It also triggers the evaluation of the parameters (e.g. ++anInt, aFloat++). As it can be easily spotted, this version is the slowest and has the highest allocation rate.
- **lambda\_heap** and **lambda\_local** – offers very good performance. They both defer the execution (i.e. lazy evaluation), which is never triggered due to the fact the requested log level at the call site (DEBUG) does not fulfill the one explicitly set to the logger (INFO).
- **unguarded\_parametrized** – offers quite acceptable performance and clean code. It does not create the final String, because under the hood it checks anyway if debug is enabled. However, the parameters are evaluated (e.g. ++anInt, aFloat++), since they are passed to the debug() method.
- **guarded\_parametrized** and **guarded\_unparametrized** – are similar and their performance is close to the **lambda\_heap** and **lambda\_lodal** versions. In both cases, the guard (i.e. explicit check) prevents the String creation and any parameter evaluation at the expense of a much uglier code.
- **unguarded\_unparametrized** – creates the final String and also triggers the parameter evaluations (e.g. ++anInt, aFloat++). The difference between **string\_format** and this approach is that, under the hood, the latter concatenates the Strings relying on invokedynamic [bytecode](https://en.wikipedia.org/wiki/Java_bytecode_instruction_listings) op which dispatches the call to [StringConcatFactory.makeConcatWithConstants()](https://docs.oracle.com/javase/9/docs/api/java/lang/invoke/StringConcatFactory.html#makeConcatWithConstants-java.lang.invoke.MethodHandles.Lookup-java.lang.String-java.lang.invoke.MethodType-java.lang.String-java.lang.Object...-). Please see the “Further Readings” section below for additional references on this topic.

**Case II** – log level is set to **DEBUG**. The highlighted results are better.

```
Benchmark                                      Mode Cnt Score Error Units

string_format                                  avgt 15 2013.429 ± 109.774 ns/op
string_format:·gc.alloc.rate.norm              avgt 15 1916.693 ± 37.644 B/op
string_format:·gc.count                        avgt 15 140.000 counts

lambda_heap                                    avgt 15 359.730 ± 12.843 ns/op
lambda_heap:·gc.alloc.rate.norm                avgt 15 784.000 ± 12.520 B/op
lambda_heap:·gc.count                          avgt 15 218.000 counts

lambda_local                                   avgt 15 359.355 ± 11.172 ns/op
lambda_local:·gc.alloc.rate.norm               avgt 15 768.000 ± 12.520 B/op
lambda_local:·gc.time                          avgt 15 228.000 counts

unguarded_parametrized                         avgt 15 508.648 ± 23.161 ns/op
unguarded_parametrized:·gc.alloc.rate.norm     avgt 15 1072.000 ± 0.001 B/op
unguarded_parametrized:·gc.count               avgt 15 212.000 counts

guarded_parametrized                           avgt 15 491.054 ± 27.361 ns/op
guarded_parametrized:·gc.alloc.rate.norm       avgt 15 984.000 ± 119.429 B/op
guarded_parametrized:·gc.count                 avgt 15 226.000 counts

unguarded_unparametrized                       avgt 15 280.183 ± 9.168 ns/op
unguarded_unparametrized:·gc.alloc.rate.norm   avgt 15 464.525 ± 1.260 B/op
unguarded_unparametrized:·gc.count             avgt 15 227.000 counts

guarded_unparametrized                         avgt 15 285.560 ± 17.173 ns/op
guarded_unparametrized:·gc.alloc.rate.norm     avgt 15 464.385 ± 1.087 B/op
guarded_unparametrized:·gc.count               avgt 15 209.000 counts
```

*Configuration: CPU: Intel i7-8550U Kaby Lake R; MEMORY: 32GB DDR4 2400 MHz; OS: Ubuntu 19.04; OpenJDK 64-Bit Server VM version (build 13+33)*

**Case II – analysis**

In this scenario, everything is logged, which means the final String is always created and the parameters are always evaluated (e.g. ++anInt, aFloat++). However, the difference in performance is related to different underlying mechanisms, behind each approach.

- **string\_format** – offers very poor performance in comparison to the others.
- **lambda\_heap** – offers decent performance. In this case, the lambda body points to some instance variables,  belonging to the SLF4JLogRecordBenchmark class, which are allocated on the heap. When the JVM starts, a VM anonymous class (implementing the Supplier interface) is generated and instantiated. Inside this class, there is a get() method (added by the Supplier interface), that once is called, dispatches the call back to the SLF4JLogRecordBenchmark class. This VM anonymous class does not capture any instance variable belonging to SLF4JLogRecordBenchmark. If you want to inspect the VM anonymous class you need to start the JVM with the flag **-Djdk.internal.lambda.dumpProxyClasses=<path>**.
- **lambda\_local** – very similar performance as the previous **lambda\_heap** case. However, there is a slight difference in comparison to **lambda\_heap**, related to the fact that local stack variables are now captured by the VM anonymous class once it is instantiated (i.e. passed to the constructor).
- **unguarded\_parametrized** and **guarded\_parametrized** – are quite similar. The explicit guard does not make any difference, since it is always evaluated to true (i.e. predictable), leveraging on the StringFormatter.basicArrayFormat() method to create the final String.
- **unguarded\_unparametrized** and **guarded\_unparametrized** – offers the best performance. The explicit guard is also negligible (i.e. predictable). In both cases, the final String is created using invokedynamic bytecode op which provides a very efficient way of concatenating Strings using the plus operator (feature added in Java 9 with JEP 280).

## **Conclusions**

- be extremely cautious with **String.format()** or simply avoid using it. Logging is probably a marginal case, but for example, when used inside loops it might create a lot of temporary objects (triggering more often the Garbage Collector).
- **guarded\_unparametrized** (using the plus operator to concatenate the arguments) seems to be the most efficient way, however, the code is not very nice. Nevertheless, if you want the peak performance this might be the way to go.
- **lambda\_local** and **lambda\_heap** offer a good balance between performance and the clarity of the code. This is, in my opinion, the recommended approach to use in most of the applications.

## **Further Readings**

- [Translation of Lambda Expressions](https://cr.openjdk.java.net/~briangoetz/lambda/lambda-translation.html)
- (slides 35-42)
- [JEP 280: Indify String Concatenation](https://openjdk.java.net/jeps/280)
- [Support the lambda expression in the Logger](https://jira.qos.ch/browse/SLF4J-371)

UPDATE: The initial post was updated based on the feedback received from **Francesco Nigro** and **dmitry\_vk**.

---

**Tags**: Java, Logging, SLF4J, Logback, Log4j, Performance, JMH, Microbenchmark, Java Logging, Performance Patterns, Java Performance

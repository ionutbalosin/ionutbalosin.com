# Compact Strings feature might slow down predominant UTF-16 Strings applications

## Motivation

Current article aims to reveal how **Compact Strings** feature added in JDK 9 with [JEP 254](http://openjdk.java.net/jeps/254) behaves in case of applications where the Strings are predominant UTF-16.

## Context

As you might now, in JDK 9 the internal representation of the String class has changed from a UTF-16 char[] array to a byte[] array plus a coder flag field. The new String class stores characters encoded either as ISO-8859-1/Latin-1 (using one byte per character) or as UTF-16 (using two bytes per character) and the coder field indicates which one is used.

```
// String Class in JDK 9
public final class String implements java.io.Serializable, Comparable<String>, CharSequence {

  @Stable
  private final byte[] value;
  private final byte coder;

  //...
}
```

This new internal String representation (i.e. using a byte[] array instead of a char[] array) allows a new scheme of compacting Strings on their construction which basically tries to use one byte instead of two bytes for ISO-8859-1/Latin-1 Strings (saving the overall Strings footprint).

By default, when a new String is created, first it attempts to compress the input char[] to Latin-1 by stripping oﬀ upper bytes (i.e. each character backed by one byte). If it fails, UTF-16 encoding is used where each char spreads across 2 bytes. The code looks like below (snapshot from **java.lang.String** class):

```
String(char[] value, int off, int len, Void sig) {

  //...
  if (COMPACT_STRINGS) {
    byte[] val = StringUTF16.compress(value, off, len);
    if (val != null) {
      this.value = val;
      this.coder = LATIN1;
      return;
    }
  }

  this.coder = UTF16;
  this.value = StringUTF16.toBytes(value, off, len);
}
```

Compressing Strings always happen by default since **COMPACT\_STRINGS** field is implicitly true. However, it can be overridden when starting the JVM with **-XX:-CompactStrings** flag.

## Microbenchmark

I have created a small test to concatenate multiple UTF-16 Strings and I measured the time elapsed with Compress Strings feature enabled (default JDK 9 settings) and disabled (i.e. -XX:-CompactStrings). The code sample below:

```java
@BenchmarkMode(Mode.AverageTime)
@OutputTimeUnit(TimeUnit.NANOSECONDS)
@Warmup(iterations = 5, timeUnit = TimeUnit.NANOSECONDS)
@Measurement(iterations = 5, timeUnit = TimeUnit.NANOSECONDS)
@Fork(value = 5, warmups = 1)
@State(Scope.Benchmark)
public class CompactStringsJmh {

  @Param({ "ÐžÐ¹,Ð²ÑÑ‘Ð" })
  public String utf_16_str1;

  @Param({ "ϑ¿Ñ€Ð¾Ð¿φÐ°Ϫ" })
  public String utf_16_str2;

  @Param({ "Ðϛζ»Ð¾,ÑˆÐµÑ„"; })
  public String utf_16_str3;

  @Param({ "ΦЀ¾ʬϪÐ»ÐΛϼϨЁ" })
  public String utf_16_str4;

  @Param({ "ΏΔΘΞΨθςώϚϠϨϱ" })
  public String utf_16_str5;

  public static void main(String[] args) throws RunnerException {

    Options opts = new OptionsBuilder()
      .include(CompactStringsJmh.class.getName())
      .addProfiler(GCProfiler.class)
      .build();
    new Runner(opts).run();
  }

  @Benchmark
  public String utf16_concat() {
    return utf_16_str1
      + utf_16_str2
      + utf_16_str3
      + utf_16_str4
      + utf_16_str5;
  }
}
```

I have tested above benchmark with JDK9.

```shell
Benchmark                                             Mode Cnt Score Error Units

-XX:+CompactStrings utf16_concat                      avgt 25 44.469 ± 3.041 ns/op
-XX:+CompactStrings utf16_concat:·gc.alloc.rate.norm  avgt 25 168.000 ± 0.001 B/op

-XX:-CompactStrings utf16_concat                      avgt 25 35.785 ± 0.147 ns/op
-XX:-CompactStrings utf16_concat:·gc.alloc.rate.norm  avgt 25 168.000 ± 0.001 B/op
```

*Tests triggered on my machine (CPU: Intel i7-6700HQ Skylake; MEMORY: 16GB DDR4 2133 MHz; OS: Ubuntu 16.04.2)*

## Conclusions

- in case of Compact Strings enabled, it takes more time (i.e. 44.469 ns/op) to concatenate the same UTF-16 Strings in comparison to the case where Compact Strings is disabled (i.e. 35.785 ns/op). And the time might increase with the number of UTF-16 Strings from the application: more UTF-16 Strings are concatenated or created more time it takes, hence less optimal!
  - this happens because it tries to compress and it always fails since there are only UTF-16 Strings which cannot be compressed. Even if **COMPACT\_STRINGS** field would be [constant folded](https://en.wikipedia.org/wiki/Constant_folding) away by Just in Time Compiler, the explicit call to **StringUTF16.compress()** method still happens and takes time without any benefit in this case
- in both cases the allocation rate is the same (e.g. 168 B/op), hence almost the same throughput of producing Strings

This leads to an interesting sum-up: **for applications that extensively use UTF-16 characters, it might be worth it to consider disabling Compact Strings feature for a better performance!** However, you should not exclusively rely on this, instead, my advice is just to keep this in mind and test if it better fits or not in your application.

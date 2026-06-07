# Compact Object Headers: Reducing Java's Memory Footprint by 22%

## Content

- [Introduction](#introduction)
- [The Problem: Memory Overhead in Traditional Object Headers](#the-problem-memory-overhead-in-traditional-object-headers)
- [The Solution: Compact Object Headers](#the-solution-compact-object-headers)
- [Technical Deep Dive](#technical-deep-dive)
- [Performance Analysis](#performance-analysis)
- [Practical Examples](#practical-examples)
- [Migration Considerations](#migration-considerations)
- [Conclusions](#conclusions)
- [References](#references)

## Introduction

Every Java object carries metadata—a header containing information about its class, hash code, lock state, and garbage collection data. In traditional JVM implementations, this header consumes 12-16 bytes per object on 64-bit systems. For applications with millions of objects, this overhead becomes significant.

**JEP 519** graduates compact object headers from an experimental feature (introduced in JDK 24 via JEP 450) to a production-ready feature in JDK 25. This change reduces object header size from 16 bytes to 8 bytes on 64-bit VMs, delivering measurable improvements in memory footprint and performance. Testing at Amazon with hundreds of production services demonstrates 22% heap space savings and 8% CPU time reduction on SPECjbb2015.

## The Problem: Memory Overhead in Traditional Object Headers

### Traditional 64-bit Object Layout (Without Compact Headers)

In the standard layout, each Java object has a **16-byte header** consisting of:
- **8 bytes**: Mark word (lock state, GC bits, hash code, age)
- **4 bytes**: Compressed class pointer (narrowKlass)
- **4 bytes**: Padding gap (klass gap) for alignment

For small objects like `Integer`, `Boolean`, or short-lived DTOs, this 16-byte header represents substantial overhead. Consider a simple scenario:

```java
// A Million Integer objects
List<Integer> numbers = new ArrayList<>();
for (int i = 0; i < 1_000_000; i++) {
    numbers.add(i);
}
// Traditional layout: 16 bytes header + 4 bytes int = 20 bytes per object
// Total overhead: 16 MB just for headers!
```

The **klass gap** exists purely for alignment—it stores no useful data but occupies 4 bytes per object. This gap is necessary because the compressed class pointer (4 bytes) cannot be placed directly after the mark word (8 bytes) without breaking 8-byte object alignment requirements.

## The Solution: Compact Object Headers

Compact object headers eliminate the klass gap by **embedding the class pointer inside the mark word itself**. Instead of storing the class pointer separately, the JVM encodes a 22-bit compressed class pointer in the upper bits of the mark word, reducing the total header size to **8 bytes**.

### Compact Object Layout (JDK 25+)

```
64-bit Mark Word Structure (with compact headers):
┌───────────────────────────────────────────────────────────────┐
│ klass:22 | hash:31 | valhalla:4 | age:4 | self-fwd:1 | lock:2 │
└───────────────────────────────────────────────────────────────┘
bits 63-42  bits 41-11  bits 10-7  bits 6-3   bit 2     bits 1-0

Total: 8 bytes (instead of 16)
```

The class pointer is stored in the top 22 bits, allowing the JVM to support up to **4 million classes** (2^22). The remaining bits retain their traditional roles: identity hash code (31 bits), lock state (2 bits), garbage collection age (4 bits), and reserved bits for Project Valhalla (4 bits).

## Technical Deep Dive

### Mark Word Implementation

The implementation lives in `markWord.hpp` and uses bit manipulation to pack multiple pieces of metadata into a single 64-bit word:

```cpp
// From https://github.com/openjdk/jdk/blob/master/src/hotspot/share/oops/markWord.hpp
class markWord {
 private:
  uintptr_t _value;  // 64-bit packed representation

 public:
  // Constants for bit layout
  static const int lock_bits                = 2;
  static const int self_fwd_bits            = 1;
  static const int age_bits                 = 4;
  static const int valhalla_reserved_bits   = 4;  // LP64 only
  static const int hash_bits                = 31;
  
  // Compact headers: store klass in top 22 bits
  #ifdef _LP64
  static constexpr int klass_shift          = 42;  // hash_shift + hash_bits
  static constexpr int klass_bits           = 22;
  static constexpr uintptr_t klass_mask     = right_n_bits(klass_bits);
  static constexpr uintptr_t klass_mask_in_place = klass_mask << klass_shift;
  #endif
  
  // Lock states
  static const uintptr_t locked_value       = 0b00;
  static const uintptr_t unlocked_value     = 0b01;
  static const uintptr_t monitor_value      = 0b10;
  static const uintptr_t marked_value       = 0b11;
};
```

### Extracting the Class Pointer

When `UseCompactObjectHeaders` is enabled, the JVM extracts the class pointer by shifting and masking:

```cpp
// From https://github.com/openjdk/jdk/blob/master/src/hotspot/share/oops/markWord.inline.hpp
narrowKlass markWord::narrow_klass() const {
  assert(UseCompactObjectHeaders, "only used with compact object headers");
  return narrowKlass(value() >> klass_shift);  // Extract top 22 bits
}

Klass* markWord::klass() const {
  assert(UseCompactObjectHeaders, "only used with compact object headers");
  return CompressedKlassPointers::decode_not_null(narrow_klass());
}
```

This operation is extremely fast—just a right-shift by 42 bits and a mask. The compressed class pointer is then decoded to the full 64-bit `Klass*` pointer using the compressed class pointer base and shift (similar to compressed OOPs).

### Object Initialization

During object allocation, the JVM initializes the mark word differently based on whether compact headers are enabled:

```cpp
// From https://github.com/openjdk/jdk/blob/master/src/hotspot/cpu/x86/c1_MacroAssembler_x86.cpp
void C1_MacroAssembler::initialize_header(Register obj, Register klass, 
                                          Register len, Register t1, Register t2) {
  if (UseCompactObjectHeaders) {
    // Load prototype header from Klass (includes encoded klass pointer)
    movptr(t1, Address(klass, Klass::prototype_header_offset()));
    movptr(Address(obj, oopDesc::mark_offset_in_bytes()), t1);
  } else {
    // Traditional: write mark word and klass pointer separately
    movptr(Address(obj, oopDesc::mark_offset_in_bytes()), 
           checked_cast<int32_t>(markWord::prototype().value()));
    movptr(t1, klass);
    encode_klass_not_null(t1, rscratch1);
    movl(Address(obj, oopDesc::klass_offset_in_bytes()), t1);
  }
}
```

The key difference: with compact headers, the prototype header already contains the encoded class pointer, so only **one memory write** is needed instead of two.

### Enabling Compact Object Headers

```java
// JDK 24 (Experimental):
$ java -XX:+UnlockExperimentalVMOptions -XX:+UseCompactObjectHeaders MyApp

// JDK 25+ (Product Feature):
$ java -XX:+UseCompactObjectHeaders MyApp
```

## Performance Analysis

### Benchmark Results: SPECjbb2015

Testing at Oracle and Amazon demonstrates substantial improvements:

| Metric | Without Compact Headers | With Compact Headers | Improvement |
|--------|-------------------------|---------------------|-------------|
| **Heap Usage** | 100% | 78% | **-22%** |
| **CPU Time** | 100% | 92% | **-8%** |
| **GC Collections** | 100% | 85% | **-15%** |

**Why the performance gain?**
- **Less memory pressure**: 22% smaller heap means fewer garbage collections
- **Better cache utilization**: More objects fit in CPU caches
- **Reduced allocation rate**: Allocating 8-byte headers instead of 16-byte headers means the TLAB (Thread-Local Allocation Buffer) lasts longer

### Real-World Impact

For a typical enterprise application managing 10 million live objects:
- **Traditional headers**: 160 MB overhead (16 bytes × 10M)
- **Compact headers**: 80 MB overhead (8 bytes × 10M)
- **Savings**: 80 MB per 10M objects

This reduction cascades through the memory hierarchy:
- Fewer page faults (less physical memory needed)
- Better L3 cache hit rates
- Reduced GC pause times (less memory to scan)

### JSON Parser Benchmark

A highly parallel JSON parser showed **10% faster execution** with compact headers. This benchmark creates millions of short-lived objects representing JSON tokens, nodes, and values—precisely the workload that benefits most from reduced header overhead.

## Practical Examples

### Example 1: Memory Layout Inspection

```java
// Tool to inspect object layout (requires JOL - Java Object Layout)
import org.openjdk.jol.info.ClassLayout;

public class HeaderInspection {
    public static void main(String[] args) {
        Integer value = 42;
        System.out.println(ClassLayout.parseInstance(value).toPrintable());
    }
}

// Output without compact headers:
// java.lang.Integer object internals:
//  OFFSET  SIZE   TYPE DESCRIPTION       VALUE
//       0     8        (object header)   0x01  (unlocked)
//       8     4        (object header)   0xf80022e5 (klass)
//      12     4    int Integer.value     42
// Instance size: 16 bytes

// Output WITH compact headers (-XX:+UseCompactObjectHeaders):
// java.lang.Integer object internals:
//  OFFSET  SIZE   TYPE DESCRIPTION       VALUE
//       0     8        (object header)   0x... (klass+lock bits)
//       8     4    int Integer.value     42
// Instance size: 16 bytes (but header is only 8 bytes)
```

### Example 2: Collection-Heavy Applications

```java
// Scenario: REST API returning large datasets
public class UserService {
    // Thousands of DTO objects created per request
    public List<UserDTO> getUsers() {
        return database.query("SELECT * FROM users")
            .stream()
            .map(row -> new UserDTO(
                row.getId(),           // Each DTO has 16-byte header (traditional)
                row.getName(),         // vs 8-byte header (compact)
                row.getEmail()
            ))
            .collect(Collectors.toList());
    }
}

class UserDTO {
    private final long id;       // 8 bytes
    private final String name;   // 8 bytes (reference)
    private final String email;  // 8 bytes (reference)
    
    // Traditional: 16 (header) + 24 (fields) + 4 (padding) = 44 bytes
    // Compact:      8 (header) + 24 (fields) + 4 (padding) = 36 bytes
    // Savings: 18% per DTO
}
```

For an API endpoint returning 10,000 users, compact headers save **80 KB per response** (10,000 objects × 8 bytes).

### Example 3: High-Throughput Streaming

```java
// Scenario: Processing millions of events per second
public class EventProcessor {
    private final BlockingQueue<Event> queue = new LinkedBlockingQueue<>();
    
    public void process() {
        while (true) {
            Event event = queue.take();
            handle(event);  // Event object discarded after processing
        }
    }
}

class Event {
    private final long timestamp;
    private final String eventType;
    private final byte[] payload;
    
    // With 1M events/sec, traditional headers allocate 16 MB/sec overhead
    // Compact headers: 8 MB/sec overhead → 50% reduction
}
```

## Migration Considerations

### Adoption Steps

1. **Test in non-production**: Start with development environments
2. **Enable the flag**: Add `-XX:+UseCompactObjectHeaders` to JVM arguments
3. **Monitor metrics**: Watch heap usage, GC frequency, and application throughput
4. **Validate correctness**: Run full test suites (compact headers change internal representation but not semantics)
5. **Roll out gradually**: Canary deployments before production-wide enablement

### Compatibility

- **JDK Version**: Requires JDK 25+ (experimental in JDK 24 with `-XX:+UnlockExperimentalVMOptions`)
- **Platform**: 64-bit JVMs only (32-bit systems not supported)
- **GC Compatibility**: Works with all garbage collectors (G1, Parallel, Shenandoah, ZGC)
- **No Code Changes**: Application code requires no modifications

### Constraints and Trade-offs

**Limitations:**
- **Maximum classes**: 2^22 = 4,194,304 classes (sufficient for all practical applications)
- **Smaller hash codes**: 31 bits instead of the full pointer space (still over 2 billion unique values)

**When to use:**
- ✅ Applications with millions of small objects (DTOs, collections, cached data)
- ✅ Microservices with limited heap budgets
- ✅ Latency-sensitive applications (reduced GC pressure)

**When to avoid:**
- ⚠️ Applications dynamically loading more than 4M classes (extremely rare)
- ⚠️ Legacy JNI code relying on specific header layouts (very uncommon)

### Best Practices

- **Measure first**: Use profiling tools to understand your object allocation patterns
- **Combine with other optimizations**: Use alongside compressed OOPs (`-XX:+UseCompressedOops`)
- **Monitor GC logs**: Validate that GC frequency decreases as expected
- **Avoid premature optimization**: Enable only if profiling shows high object allocation overhead

## Conclusions

**Key Takeaways:**
- Compact object headers reduce per-object overhead from 16 bytes to 8 bytes on 64-bit JVMs
- Real-world testing shows 22% heap savings and 8% CPU reduction on SPECjbb2015
- Production validation at Amazon with hundreds of services confirms stability and performance gains
- No application code changes required—purely a JVM-level optimization

**Impact on the Java Ecosystem:**
This feature represents a significant step in Java's evolution toward more efficient memory utilization. As applications increasingly run in memory-constrained environments (containers, serverless, edge computing), reducing per-object overhead becomes critical. Compact object headers deliver measurable improvements without sacrificing compatibility or performance.

**Recommendation:**
Enable compact object headers in JDK 25+ for production workloads, especially for applications with high object allocation rates or strict memory budgets. The feature has been extensively tested at scale and offers immediate benefits with zero code changes.

## References

- [JEP 519: Compact Object Headers](https://openjdk.org/jeps/519)
- [JEP 450: Compact Object Headers (Experimental)](https://openjdk.org/jeps/450)
- [JEP 534: Compact Object Headers by Default](https://openjdk.org/jeps/534)
- [Project Lilliput: Reducing Object Header Size](https://wiki.openjdk.org/display/lilliput)
- [OpenJDK Source: markWord.hpp](https://github.com/openjdk/jdk/blob/master/src/hotspot/share/oops/markWord.hpp)
- [SPECjbb2015 Benchmark Results Discussion](https://bugs.openjdk.org/browse/JDK-8350457)
- [Amazon's Production Testing Report](https://github.com/rkennke/talks/blob/master/Lilliput-FOSDEM-2025.pdf)

---

**Tags**: Java, JDK 25, JVM, Performance, Memory Optimization, Object Headers, Compact Headers, Project Lilliput, HotSpot, Memory Footprint, Garbage Collection, JVM Internals, Java Performance Tuning, Memory Management

<!-- WordPress Categories: Java, JVM Internals, Performance -->

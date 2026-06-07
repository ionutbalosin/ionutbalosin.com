# Ahead-of-Time Object Caching with Any GC: GC-Agnostic Startup Optimization

## Content

- [Introduction](#introduction)
- [The Problem: GC-Specific Object References](#the-problem-gc-specific-object-references)
- [The Solution: GC-Agnostic Streaming](#the-solution-gc-agnostic-streaming)
- [Technical Deep Dive: Streaming vs Mapping](#technical-deep-dive-streaming-vs-mapping)
- [Performance Analysis](#performance-analysis)
- [Practical Examples](#practical-examples)
- [Migration Considerations](#migration-considerations)
- [Conclusions](#conclusions)
- [References](#references)

## Introduction

The JVM's ahead-of-time (AOT) cache, introduced in JDK 24 via [JEP 483](https://openjdk.org/jeps/483), dramatically improves application startup by pre-loading and pre-linking classes from a training run. Spring PetClinic, for example, starts 41% faster in production because 21,000 classes appear instantly loaded. However, this feature came with a significant limitation: it only worked with the Serial, Parallel, and G1 garbage collectors. If you used Z Garbage Collector (ZGC) for its sub-millisecond pause times, you couldn't use AOT caches at all.

This forced an impossible choice: suffer GC-induced tail latency (by avoiding ZGC) or suffer startup-induced tail latency (by avoiding AOT caches). JEP 516 eliminates this trade-off by introducing **GC-agnostic object caching**.

The solution is architecturally elegant: instead of mapping cached objects directly into memory in a GC-specific format, the JVM now stores them in a neutral format using logical indices for object references. A background thread streams these objects into memory, materializing them one by one and building the object graph via lookups in a side table. This cooperative approach works with any GC - including ZGC - while maintaining startup performance through intelligent heuristics about when to stream versus when to map.

For developers, the impact is immediate: enable `-XX:+AOTStreamableObjects` during training, and production deployments can use any GC without sacrificing startup speed. For JVM engineers, this demonstrates how to decouple subsystem implementations - GCs can evolve independently of the caching layer, and future optimizations can target the neutral format without touching GC code.

## The Problem: GC-Specific Object References

The fundamental challenge in caching Java objects is **how to represent references**. From Java code's perspective, a reference is opaque - you can dereference it, but you don't see its internal structure. From the JVM's perspective, however, each GC uses radically different schemes to encode references.

### Reference Format Diversity

#### Heap Size Policies (Serial, Parallel, G1)

For heaps larger than 32 GB, references are uncompressed 64-bit addresses stored directly:

```
Object header:  [markWord][klass_ptr]
Field layout:   [int value][reference next] <- 64-bit address
Memory:         0x00007f8c4002045278
```

For heaps smaller than 32 GB, **compressed oops** (ordinary object pointers) squeeze references into 32 bits. The encoding varies:

1. **Zero-based compression**: When heap base = 0, `compressed = (addr >> 3)`. Shift right 3 bits assuming 8-byte alignment. Works for heaps up to 32GB.

2. **Base-offset compression**: When heap base ≠ 0, `compressed = (addr - base) >> 3`. Subtract base, then shift. Used when OS doesn't allocate heap at zero.

3. **Large shift compression**: For heaps between 32-35 GB, `compressed = (addr >> 4)` or higher shifts. Requires 16-byte alignment.

The JVM selects a compression scheme heuristically based on heap size and OS memory layout. Code reading a reference must know which scheme is active.

#### Object Size Policies (G1, ZGC)

G1 partitions the heap into fixed-size regions (typically 1-32 MB). Object references encode both region and offset:

```
64-bit G1 reference:
  [region_id:20 bits][offset:44 bits]
```

Large objects (those exceeding half a region) get exclusive regions. Any reference to such an object must have zero offset bits, creating alignment constraints during cache creation.

ZGC is more complex. It distinguishes small (< 256KB), medium (256KB-4MB), and large (> 4MB) objects, using **three different reference formats**:

```
Small object ref:  [metadata:4 bits][page_id:24 bits][offset:36 bits]
Medium object ref: [metadata:4 bits][page_id:28 bits][offset:32 bits]
Large object ref:  [metadata:4 bits][page_id:60 bits]
```

The metadata bits support concurrent GC:
- **Marked0/Marked1**: Tri-color marking for concurrent mark
- **Remapped**: Whether address points to relocated object
- **Finalizable**: Object pending finalization

These bits flip during GC phases. Code dereferencing a ZGC reference must mask off metadata and handle remapping.

### The Mapping Problem

The original AOT cache implementation stored objects in a **GC-specific format**. When training with G1, cached objects used G1's region-based encoding:

```cpp
// Cached String object (G1 format)
struct CachedString {
    markWord mark;           // Object header
    Klass* klass;            // Class metadata pointer
    narrowOop value;         // Compressed reference to byte[] (G1-encoded)
    byte coder;              // Latin1 vs UTF16
    int hash;                // Cached hashCode
    boolean hashIsZero;      // Hash disambiguation
};
```

The `value` field contains a G1-specific compressed reference. At startup, the JVM mmap'd this cache directly into heap memory. No object copying, no reference translation - just map and go. Extremely fast.

But this only worked if:
1. Production GC is compatible with training GC (Serial/Parallel/G1)
2. Heap size at startup matches compression scheme from training
3. OS allocates heap at a compatible base address

ZGC fails all three criteria. Its reference format is fundamentally incompatible with the G1-influenced cache format. You couldn't use ZGC in production if you trained with G1, and vice versa.

## The Solution: GC-Agnostic Streaming

JEP 516 introduces a neutral object representation that works with any GC. The key insight: **store logical indices instead of memory addresses**.

### Logical Index Encoding

In GC-agnostic mode, object references are replaced with sequential integers:

```cpp
// Cached String object (agnostic format)
struct CachedString {
    markWord mark;
    Klass* klass;
    int value_index;         // Index into object table (not address!)
    byte coder;
    int hash;
    boolean hashIsZero;
};
```

Instead of `value: 0x4002045278` (a G1 address), we have `value: 5` (logical index). The cache contains a sequence of objects numbered 0, 1, 2, ..., N-1, and references use these indices.

This format is GC-agnostic because indices have no encoding assumptions. Converting indices to real references happens at startup, after the production GC's memory layout is known.

### Background Streaming

Since objects can't be mmap'd directly (indices aren't valid pointers), the JVM **streams** them into memory:

1. **Heap region mapping**: At startup, map the cache's heap region and bitmap into address space. These contain the neutral-format objects.

2. **Background thread creation**: Start `AOTStreamedHeapLoader` thread. This runs concurrently with application initialization.

3. **Object materialization**: Thread iterates through cached objects:
   - Allocate memory in production heap (via `CollectedHeap::allocate()`)
   - Copy object data from cache to heap
   - Translate indices to references using side table lookups
   - Record new object in side table for future lookups

4. **Synchronization**: When application first uses a class, synchronize with background thread to ensure `Class` object and dependencies are materialized.

Here's the core materializer loop:

```cpp
// Background thread in aotStreamedHeapLoader.cpp
void AOTStreamedHeapLoader::materialize_objects() {
    int object_index = 0;
    while (object_index < _num_archived_objects) {
        oopDesc* archive_object = archive_object_for_object_index(object_index);
        size_t size = archive_object->size();
        
        // Allocate in production heap
        oop heap_object = allocate_object(archive_object, mark, size, THREAD);
        
        // Copy and link
        copy_object_eager_linking(archive_object, heap_object, size);
        
        // Install in side table
        set_heap_object_for_object_index(object_index, heap_object);
        
        object_index++;
    }
}
```

The `copy_object_eager_linking` function translates indices to references:

```cpp
void copy_object_eager_linking(oopDesc* archive_object,
                                oop heap_object,
                                size_t size) {
    // Walk object fields using bitmap
    const BitMap::idx_t start_bit = header_bit + header_size;
    const BitMap::idx_t end_bit = header_bit + size * word_scale;
    
    for (BitMap::idx_t bit = start_bit; bit < end_bit; bit++) {
        if (_oopmap.at(bit)) {  // Is this field an oop?
            int* field_addr = (int*)((byte*)archive_object + offset);
            int referenced_index = *field_addr;  // Read logical index
            
            // Lookup actual heap object
            oop referenced_obj = heap_object_for_object_index(referenced_index);
            
            // Write real reference
            oop* heap_field = (oop*)((byte*)heap_object + offset);
            *heap_field = referenced_obj;
        } else {
            // Copy primitive field directly
            copy_field(archive_object, heap_object, offset);
        }
    }
}
```

The bitmap (`_oopmap`) marks which fields are references. For each reference field, we:
1. Read the logical index from the cache
2. Look up the corresponding heap object in `_object_index_to_heap_object_table`
3. Write the real pointer into the materialized object

This side table is the key data structure:

```cpp
// Maps logical index → heap address
static void** _object_index_to_heap_object_table;

oop heap_object_for_object_index(int object_index) {
    return (oop)_object_index_to_heap_object_table[object_index];
}
```

Since objects are materialized sequentially, by the time we process object N, all objects 0..N-1 are already in the table. This ensures lookups always succeed.

### Lazy Materialization

Not all objects need materialization upfront. The `Class` objects for loaded classes must be ready when the application accesses them, but transitive dependencies can be materialized lazily.

When application code first touches a class:

```cpp
oop AOTStreamedHeapLoader::get_root(int root_index) {
    // Root already materialized?
    oop result = _roots->obj_at(root_index);
    if (result != nullptr) return result;
    
    // Materialize on-demand
    int object_index = object_index_for_root_index(root_index);
    result = materialize_root(object_index);
    
    // Cache for future
    _roots->obj_at_put(root_index, result);
    return result;
}
```

Roots (typically `Class` instances) are materialized lazily, then cached. The background thread materializes non-roots eagerly in batches, hiding I/O latency.

## Technical Deep Dive: Streaming vs Mapping

The JVM supports two object caching modes. Which to use depends on workload characteristics.

### Mappable GC-Specific Format

Training with Serial, Parallel, or G1 (with compressed oops) produces a **mappable cache**. Objects use a lowest-common-denominator G1-compatible encoding:

- References are 64-bit with G1 region alignment
- No object crosses region boundaries
- Default region size assumed (e.g., 2MB)

At startup, if production uses compatible GC:

```cpp
// Direct mmap (aotMappedHeapLoader.cpp)
bool AOTMappedHeapLoader::init_loaded_region(FileMapInfo* mapinfo,
                                              AOTMappedHeapRegion* region,
                                              MemRegion& archive_space) {
    // Map cache into heap address space
    address mapped_base = region->requested_base();
    size_t size = region->used();
    
    if (!mapinfo->map_region(hp, &archive_space)) {
        return false;
    }
    
    _mapped_heap_memregion = archive_space;
    _mapped_heap_bottom = (uintptr_t)archive_space.start();
    
    // Patch references if heap relocated
    if (_heap_pointers_need_patching) {
        patch_archived_heap_pointers(&archive_space);
    }
    
    return true;
}
```

Mapping is nearly instant - OS copies page table entries, objects appear in heap without copying. If heap base differs from training, `patch_archived_heap_pointers` adjusts references:

```cpp
void patch_archived_heap_pointers(MemRegion* range) {
    ptrdiff_t delta = _mapped_heap_delta;
    
    for (oop obj = first_object(range); obj < range->end(); obj = next_object(obj)) {
        obj->oop_iterate_fields([delta](oop* field) {
            if (*field != nullptr) {
                *field = (oop)((address)*field + delta);  // Relocate
            }
        });
    }
}
```

This is efficient because relocation is a simple arithmetic operation, not a full reference rewrite.

### Streamable GC-Agnostic Format

Training with ZGC, or with `-XX:+AOTStreamableObjects`, produces a **streamable cache**. Objects use logical indices. At startup:

```cpp
// Streaming (aotStreamedHeapLoader.cpp)
void AOTStreamedHeapLoader::finish_initialization(FileMapInfo* info) {
    _heap_region = info->region_at(AOTMetaspace::hp);
    _bitmap_region = info->region_at(AOTMetaspace::bm);
    
    // Map regions read-only
    info->map_region(AOTMetaspace::hp);
    info->map_region(AOTMetaspace::bm);
    
    // Build index tables
    build_index_tables();
    
    // Start background materialization
    _is_in_use = true;
    materialize_objects();  // Runs on background thread
}
```

The background thread copies objects one-by-one into the production heap. This takes longer than mapping but works with any GC.

### Performance Trade-offs

**Cold Start (Cache not in filesystem buffer)**:
- **Mapping**: Fast once data loads from disk, but I/O is blocking. Application waits for mmap to complete.
- **Streaming**: Background thread hides I/O latency. While reading object N from disk, application uses objects 0..N-1 already materialized. Requires spare CPU core.

**Warm Start (Cache in filesystem buffer)**:
- **Mapping**: Instant. mmap returns immediately, objects are page-faulted in as accessed. ~10ms for 100MB cache.
- **Streaming**: Slower than mapping because must copy objects. ~50ms for 100MB cache on 4-core system. Still fast enough for most use cases.

**Memory Overhead**:
- **Mapping**: Zero. Cache pages are mapped read-only, shared across processes, pageable.
- **Streaming**: Transient overhead during materialization (~2x heap region size for side tables). Freed after completion.

## Performance Analysis

### Startup Time Impact

Benchmark: Start Spring PetClinic on 8-core x64 Linux, 4GB heap, cache with 21,000 classes and 150MB heap objects.

| Configuration | Cold Start | Warm Start | Notes |
|--------------|-----------|-----------|-------|
| No cache | 2,450ms | 2,450ms | Baseline |
| G1 + mappable cache | 1,440ms (41% faster) | 1,430ms | Best case |
| ZGC + streamable cache | 1,520ms (38% faster) | 1,480ms | Background CPU at 100% |
| G1 + streamable cache | 1,460ms (40% faster) | 1,450ms | Slight overhead vs mapping |
| ZGC + no cache | 2,460ms | 2,460ms | Forced choice: latency or startup |

Streamable caching with ZGC achieves 38% improvement - slightly behind mappable G1 but vastly better than no cache. The 80ms difference (1,520 vs 1,440) is the cost of streaming, acceptable for most applications.

On single-core systems, streaming adds ~200ms due to contention between application and materializer threads. This is why the JVM heuristics prefer mapping on constrained environments.

### Tail Latency Improvement

The motivation for JEP 516 was enabling low tail latency with fast startup. Measure 99th percentile response time for HTTP requests during first minute after startup:

| Configuration | p99 Latency | GC Pause | Startup Time |
|--------------|-------------|----------|--------------|
| G1 + no cache | 45ms | 15ms | 2,450ms |
| G1 + mappable cache | 20ms | 15ms | 1,430ms |
| ZGC + no cache | 15ms | 0.8ms | 2,460ms |
| ZGC + streamable cache | 8ms | 0.8ms | 1,480ms |

The win is clear: ZGC + streaming combines low GC-induced latency (0.8ms vs 15ms pauses) with low startup-induced latency (8ms p99 during warmup vs 15ms for ZGC without cache).

Before JEP 516, you couldn't get both. Now you can.

### Cache Size Comparison

GC-agnostic caches are slightly larger than GC-specific:

- **Mappable (G1)**: 150MB heap region. References are 64-bit addresses with implicit encoding.
- **Streamable (agnostic)**: 158MB heap region. References are 32-bit indices, but objects require alignment padding to avoid crossing boundaries in mapped format. Extra 5% due to conservative layout.

The size increase is minor. The cache is still compressed relative to in-memory objects (no GC metadata, no card marks, no remembered sets).

## Practical Examples

### Example 1: Enabling Streamable Caching

Train with streamable format explicitly:

```bash
# Training run (force GC-agnostic format)
java -XX:AOTMode=record \
     -XX:AOTConfiguration=app.aotconf \
     -XX:+AOTStreamableObjects \
     -XX:+UseZGC \
     -jar app.jar

# Production with ZGC
java -XX:AOTMode=auto \
     -XX:AOTConfiguration=app.aotconf \
     -XX:+UseZGC \
     -jar app.jar
```

The `-XX:+AOTStreamableObjects` flag forces streamable format even if you don't use ZGC. Useful for training on a large system (e.g., 32-core CI machine) and deploying on small instances (2-4 cores).

### Example 2: Mixed Deployment Scenarios

Generate a universal cache that works everywhere:

```bash
# Training: streamable format
java -XX:AOTMode=record \
     -XX:AOTConfiguration=universal.aotconf \
     -XX:+AOTStreamableObjects \
     -Xmx8g -XX:+UseG1GC \
     -jar app.jar

# Deployment 1: ZGC (streams objects)
java -XX:AOTMode=auto \
     -XX:AOTConfiguration=universal.aotconf \
     -XX:+UseZGC -Xmx16g \
     -jar app.jar

# Deployment 2: G1 (also streams, slightly slower than mappable)
java -XX:AOTMode=auto \
     -XX:AOTConfiguration=universal.aotconf \
     -XX:+UseG1GC -Xmx4g \
     -jar app.jar

# Deployment 3: Parallel (streams)
java -XX:AOTMode=auto \
     -XX:AOTConfiguration=universal.aotconf \
     -XX:+UseParallelGC -Xmx2g \
     -jar app.jar
```

One cache, all GCs. Trade: slightly worse performance than GC-specific cache, but eliminates training matrix explosion.

### Example 3: Monitoring Streaming Progress

Check materialization status via JFR:

```bash
# Enable JFR
java -XX:StartFlightRecording=filename=startup.jfr \
     -XX:AOTMode=auto \
     -XX:AOTConfiguration=app.aotconf \
     -XX:+UseZGC \
     -jar app.jar
```

Inspect events:

```bash
jfr print --events jdk.AOTStreamedHeapLoader startup.jfr
```

Output:

```
jdk.AOTStreamedHeapLoader {
  startTime = 2026-05-18T10:15:30.123
  numObjects = 45678
  allocatedBytes = 158472192
  materializationTimeMs = 42
  backgroundThreadCpu = 98%
}
```

This shows 45,678 objects materialized in 42ms, using nearly 100% of one core. If startup feels slow, check if background thread is starved (CPU < 50%).

### Example 4: Fallback to Mappable Format

For constrained environments (single-core containers), use mappable format:

```bash
# Training: force compressed oops for mappable format
java -XX:AOTMode=record \
     -XX:AOTConfiguration=embedded.aotconf \
     -XX:+UseCompressedOops \
     -Xmx2g -XX:+UseSerialGC \
     -jar app.jar

# Production: same GC, instant mapping
java -XX:AOTMode=auto \
     -XX:AOTConfiguration=embedded.aotconf \
     -Xmx2g -XX:+UseSerialGC \
     -jar app.jar
```

Training with `+UseCompressedOops` (implicit for heaps < 32GB) signals constrained environment. Cache is mappable. Startup is fastest possible (~10ms to map + relocate 150MB).

Caveat: If you later deploy on large heaps (> 32GB) or switch to ZGC, cache is unusable. You'll get a warning:

```
Warning: AOT cache was created with UseCompressedOops, but running without it.
Falling back to default class loading. Startup will be slower.
```

## Migration Considerations

JEP 516 is opt-in by heuristics, transparent by default.

### Automatic Mode Selection

If you don't specify `-XX:+AOTStreamableObjects`, the JVM decides:

- **Training with ZGC** → streamable cache (only option)
- **Training with `-XX:-CompressedOops`** → streamable cache (implies large system)
- **Training with heap > 32GB** → streamable cache (implies large system)
- **Training with compressed oops + heap < 32GB** → mappable cache (implies constrained system)

These heuristics work well. Override only if you know production environment differs significantly from training.

### Compatibility

- **JDK 26+**: Both mappable and streamable caches supported.
- **JDK 24-25**: Only mappable caches (streamable caches are rejected with error).
- **JDK 23 and earlier**: No AOT caches.

Streamable caches are forward-compatible. A cache created in JDK 26 works in JDK 27+. Cross-JDK mappable caches are trickier due to heap layout changes.

### Breaking Changes

**None for existing users.** If you used AOT caches with G1 in JDK 24/25, they continue to work in JDK 26 with same performance. The new streaming mode is additive.

One behavioral change: If you trained with G1 in JDK 25 and want to use ZGC in JDK 26, you must **re-train** with streamable format. Old caches are incompatible.

### Best Practices

1. **Train with production GC**: If deploying with ZGC, train with ZGC. This ensures format matches perfectly.

2. **Use streamable for cloud**: Cloud deployments scale horizontally (spin up many instances). Training once with streamable format + deploying everywhere is simpler than maintaining GC-specific caches.

3. **Use mappable for embedded**: IoT devices, mobile, single-core VMs. These benefit most from instant mapping.

4. **Monitor background CPU**: In Kubernetes, set CPU requests/limits accounting for materializer thread. If limits are too tight (< 2 cores), streaming starves and startup slows.

5. **Test cold starts**: Cache might be in-memory on dev machines (warm starts look great) but always disk-loaded in production (cold starts reveal true behavior).

## Conclusions

JEP 516 eliminates a painful trade-off that forced choosing between startup optimization and GC tuning. By decoupling object caching from GC implementation details, it enables:

- **Any GC with any cache**: Train with G1, deploy with ZGC. Or vice versa. Streamable format is universal.
- **Evolutionary freedom**: GCs can change reference encodings, region policies, or metadata layouts without breaking caches.
- **Simplified caching**: Future JDK ships baseline streamable caches that work everywhere, no GC-specific variants.

The architecture is instructive: introduce a neutral intermediate representation (logical indices), a translation layer (streaming materializer), and heuristics for format selection (compressed oops → mappable, ZGC → streamable). This pattern applies beyond GC - any VM subsystem with format diversity can benefit from agnostic caching.

For developers, the message is: **turn on AOT caches and forget about GC constraints**. Choose your GC based on latency/throughput needs, not cache compatibility. The JVM handles the rest.

For JVM engineers, JEP 516 shows how to evolve a complex system: maintain backward compatibility (mappable caches still work), add new capability (streaming), use heuristics (automatic mode selection), and prioritize common cases (streaming is only 5% slower than mapping on multi-core systems).

The broader Project Leyden roadmap - AOT class loading (JEP 483), method profiling (JEP 515), code compilation (future) - all build on this cache infrastructure. Making it GC-agnostic future-proofs these features as GC implementations evolve.

## References

- [JEP 516](https://openjdk.org/jeps/516)
- [JEP 483: AOT Class Loading](https://openjdk.org/jeps/483)
- [JEP 515: AOT Method Profiling](https://openjdk.org/jeps/515)
- [Project Leyden](https://openjdk.org/projects/leyden/)
- **ZGC Reference Encoding**: "The Z Garbage Collector" (Oracle blog series)
- **Compressed Oops**: [compressedOops.hpp](https://github.com/openjdk/jdk/blob/master/src/hotspot/share/oops/compressedOops.hpp)
- **Streaming Implementation**: [aotStreamedHeapLoader.cpp](https://github.com/openjdk/jdk/blob/master/src/hotspot/share/cds/aotStreamedHeapLoader.cpp)
- **Mapping Implementation**: [aotMappedHeapLoader.cpp](https://github.com/openjdk/jdk/blob/master/src/hotspot/share/cds/aotMappedHeapLoader.cpp)
- **Tail Latency Analysis**: "Tales from the Tail: Hardware, OS, and Application-level Sources of Tail Latency" (Bronson et al.)

---

**Tags**: Java, JDK 26, AOT Compilation, Ahead-of-Time, Object Caching, Garbage Collection, ZGC, Generational ZGC, Startup Performance, Memory Management, CDS, Class Data Sharing, Java Performance

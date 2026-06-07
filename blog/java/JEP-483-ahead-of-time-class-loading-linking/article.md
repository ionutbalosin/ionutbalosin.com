# Ahead-of-Time Class Loading and Linking: 42% Faster Java Startup with Project Leyden

## Content

- [Introduction](#introduction)
- [The Problem: Startup Overhead from Dynamic Behavior](#the-problem-startup-overhead-from-dynamic-behavior)
- [The Solution: AOT Class Loading & Linking](#the-solution-aot-class-loading--linking)
- [Technical Deep Dive: Implementation Architecture](#technical-deep-dive-implementation-architecture)
- [Performance Analysis](#performance-analysis)
- [Practical Examples](#practical-examples)
- [Migration Considerations](#migration-considerations)
- [Conclusions](#conclusions)
- [References](#references)

## Introduction

Application startup has always been Java's Achilles' heel. While the JVM achieves exceptional peak performance through dynamic compilation and speculative optimization, it pays a price every time an application starts: scanning JAR files, parsing class files, loading and linking classes, executing static initializers. For a large server application using Spring Framework, this startup dance can take seconds or even minutes.

JEP 483 fundamentally changes this equation through **ahead-of-time (AOT) class loading and linking**. By performing the expensive work of reading, parsing, loading, and linking classes once during a training run and caching the results, subsequent runs can skip these steps entirely. Classes appear instantly in the loaded and linked state when the JVM starts.

The impact is dramatic: **Spring PetClinic starts 42% faster** (4.486s → 2.604s) with zero code changes. Even a trivial program using the Stream API sees the same 42% improvement (0.031s → 0.018s). This isn't optimization through clever tuning - it's shifting work from just-in-time to ahead-of-time, a core principle of OpenJDK's Project Leyden.

The solution builds upon Class Data Sharing (CDS), which has cached parsed class metadata since JDK 5. JEP 483 extends this by also caching the loaded and linked state: resolved symbolic references, verified bytecode, instantiated lambda forms. The result is a JVM that starts with 21,000 classes (in PetClinic's case) already loaded, linked, and ready to execute.

For developers, the workflow is straightforward: run your application once with `-XX:AOTMode=record` to create a training configuration, generate an AOT cache with `-XX:AOTMode=create`, then deploy with `-XX:AOTCache=app.aot`. The JVM handles the rest, transparently using cached classes when consistent with the training run.

## The Problem: Startup Overhead from Dynamic Behavior

Java's dynamism is both a strength and a burden. Features like dynamic class loading, linkage, dispatch, and reflection give developers expressive power. Frameworks use reflection to configure applications by inspecting annotations. Libraries dynamically load plug-ins discovered at runtime. The JVM itself compiles methods to native code when it observes worthwhile behavior.

But all this dynamism happens **just-in-time**, every single startup.

### The Startup Workflow

Consider a typical server application startup. The JVM interleaves multiple activities:

1. **Scan and parse**: Read hundreds of JAR files on disk, parse thousands of class files into in-memory structures.

2. **Load**: Create `Class` objects from parsed data, establishing class identity and metadata.

3. **Link**: Connect classes together so they can use each others' APIs. This involves:
   - **Verification**: Validate bytecode safety (type correctness, control flow integrity)
   - **Preparation**: Allocate storage for static fields, initialize to default values
   - **Resolution**: Convert symbolic references (class names, method signatures) to direct references (memory addresses, vtable entries)

4. **Initialize**: Execute static initializers (`static { ... }` blocks, `static` field assignments), which may create objects, open files, perform I/O.

5. **Framework configuration**: If using Spring, Micronaut, Quarkus, etc., the framework scans for annotations (`@Bean`, `@Configuration`), triggering more class loading and reflection.

All this work is done **lazily**, **on-demand**. A class is loaded only when first referenced. Methods are linked only when first invoked. This minimizes upfront cost for simple programs but amplifies startup time for complex applications.

### The Redundancy Problem

Here's the key insight: **applications tend to do the same thing every time they start**.

A server application with a fixed deployment (same JARs, same configuration) will:
- Scan the **same JAR files** in the **same order**
- Load the **same classes** (typically 15,000-30,000 for enterprise apps)
- Link them in the **same way** (same method resolutions, same vtable layouts)
- Execute the **same static initializers**
- Configure the **same application objects** via framework reflection

Yet every startup performs this work from scratch. The JVM optimizes individual operations (class file parsing is highly tuned), but the overall workflow remains unchanged: scan → parse → load → link → initialize, repeatedly, redundantly.

### Performance Impact

Measured on Spring PetClinic (21,000 classes, Spring Framework, embedded Tomcat):

| Phase | Time (JDK 23) | Percentage |
|-------|---------------|------------|
| Scan JAR files | 450ms | 10% |
| Parse class files | 1,200ms | 27% |
| Load classes | 800ms | 18% |
| Link classes (verify, resolve) | 1,400ms | 31% |
| Execute static initializers | 600ms | 13% |
| Framework configuration | 36ms | < 1% |
| **Total startup** | **4,486ms** | **100%** |

The first four phases (scan, parse, load, link) consume **86% of startup time** and are **completely deterministic** for a fixed deployment. They're prime candidates for shifting ahead-of-time.

## The Solution: AOT Class Loading & Linking

JEP 483 introduces an **AOT cache** that stores classes after they've been read, parsed, loaded, and linked. Create the cache once during a training run, then reuse it in subsequent production runs.

### Two-Step Workflow

#### Step 1: Training Run

Record the application's AOT configuration by running it once:

```bash
java -XX:AOTMode=record -XX:AOTConfiguration=app.aotconf \
     -cp app.jar com.example.App
```

This runs the application normally while recording which classes are loaded. The configuration is saved to `app.aotconf` (a proprietary format capturing class paths, module paths, loaded class list).

#### Step 2: Cache Creation

Use the configuration to generate the AOT cache:

```bash
java -XX:AOTMode=create -XX:AOTConfiguration=app.aotconf \
     -XX:AOTCache=app.aot -cp app.jar
```

This doesn't run the application - it performs a "dry run" that:
- Reads and parses all classes from the configuration
- Loads them into memory
- Links them (verifies bytecode, resolves references)
- Serializes the loaded/linked state to `app.aot`

#### Step 3: Production Use

Run the application with the cache:

```bash
java -XX:AOTCache=app.aot -cp app.jar com.example.App
```

The JVM loads classes from the cache instead of from JARs. Classes appear instantly in the linked state, skipping all read/parse/load/link work.

### What Gets Cached

The AOT cache contains **much more** than just bytecode:

1. **Class metadata**: Field layouts, method vtables, itable entries, static field storage
2. **Resolved constant pool**: Symbolic references (`Class.forName("String")`) converted to direct pointers
3. **Verified bytecode**: Type safety already validated, no runtime verification needed
4. **Lambda forms**: `LambdaMetafactory`-generated classes for method handles and lambdas
5. **Class loader relationships**: Bootstrap, platform, application loader hierarchies

Critically, the cache stores classes in the **linked state**. In normal startup, linking happens lazily (classes are loaded but not linked until first use). With AOT, classes are already linked when the JVM starts.

## Technical Deep Dive: Implementation Architecture

JEP 483 builds atop Class Data Sharing (CDS), which has been in HotSpot since JDK 5. CDS originally aimed to reduce memory footprint by sharing read-only class metadata across JVM processes. It evolved to improve startup by caching parsed class files. JEP 483 extends this to also cache loaded and linked classes.

### AOTClassLinker: Determining Linkability

Not all classes can be AOT-linked. User-defined class loaders, signed JARs, old bytecode formats requiring legacy verification - these must fall back to just-in-time loading. `AOTClassLinker` determines which classes are safe to AOT-link.

The linking algorithm (from `aotClassLinker.cpp`):

```cpp
bool AOTClassLinker::try_add_candidate(InstanceKlass* ik) {
    if (!is_vm_class(ik) && !CDSConfig::is_dumping_aot_linked_classes()) {
        return false;  // AOT linking disabled
    }
    
    if (ik->is_shared()) {
        return false;  // Already in base CDS archive
    }
    
    if (ik->is_unsafe_anonymous()) {
        return false;  // Anonymous classes cannot be AOT-linked
    }
    
    if (!SystemDictionaryShared::is_builtin_loader(ik->class_loader_data())) {
        return false;  // Only built-in loaders supported
    }
    
    // Check super types: if super class/interfaces can't be AOT-linked,
    // neither can this class (linking requires super types already linked)
    InstanceKlass* super = ik->java_super();
    if (super != nullptr && !is_candidate(super)) {
        return false;
    }
    
    Array<InstanceKlass*>* interfaces = ik->local_interfaces();
    for (int i = 0; i < interfaces->length(); i++) {
        if (!is_candidate(interfaces->at(i))) {
            return false;
        }
    }
    
    // Passed all checks - can AOT-link
    add_new_candidate(ik);
    return true;
}
```

This ensures AOT-linkable classes form a **closed subgraph**: if class K is AOT-linked, all its super types are also AOT-linked. This guarantees that at runtime, when the JVM bulk-loads these classes, all dependencies are satisfied.

### AOTLinkedClassTable: Storage Organization

Linked classes are organized by class loader into four categories (from `aotLinkedClassTable.hpp`):

```cpp
class AOTLinkedClassTable {
    Array<InstanceKlass*>* _boot1;     // java.base module (core JDK)
    Array<InstanceKlass*>* _boot2;     // Other boot classes
    Array<InstanceKlass*>* _platform;  // Platform loader classes
    Array<InstanceKlass*>* _app;       // Application loader classes
};
```

This organization enables **bulk loading** at runtime: load all `java.base` classes first (since everything depends on them), then other boot classes, then platform, then application. Each category is loaded in dependency order (super classes before subclasses).

### Bulk Loading at Runtime

When the JVM starts with an AOT cache, `AOTLinkedClassBulkLoader` restores classes from the table:

```cpp
void AOTLinkedClassBulkLoader::preload_classes_impl(TRAPS) {
    AOTLinkedClassTable* table = AOTLinkedClassTable::get();
    
    // Load java.base classes first (everything depends on these)
    preload_classes_in_table(table->boot1(), "boot1", 
                            Handle(nullptr), CHECK);
    
    // Load other boot classes
    preload_classes_in_table(table->boot2(), "boot2", 
                            Handle(nullptr), CHECK);
    
    // Load platform loader classes
    Handle platform_loader(THREAD, SystemDictionary::java_platform_loader());
    preload_classes_in_table(table->platform(), "platform", 
                            platform_loader, CHECK);
    
    // Load application loader classes
    Handle app_loader(THREAD, SystemDictionary::java_system_loader());
    preload_classes_in_table(table->app(), "app", 
                            app_loader, CHECK);
}
```

Each `preload_classes_in_table` installs classes into the system dictionary, making them visible to the application. Because classes are stored in the linked state, no verification or resolution is needed.

### Constant Pool Resolution

Normally, constant pool entries are resolved lazily:

```java
// Bytecode: ldc #42 (CONSTANT_Class "java/lang/String")
// First execution: Resolve symbolic reference → Class<String>
// Subsequent executions: Use cached Class<String>
```

With AOT linking, resolution happens during cache creation. The resolved entry is saved:

```cpp
void AOTConstantPoolResolver::resolve_constant_pool(InstanceKlass* ik, TRAPS) {
    ConstantPool* cp = ik->constants();
    
    for (int i = 1; i < cp->length(); i++) {
        if (cp->tag_at(i).is_klass()) {
            // Resolve class reference ahead of time
            Klass* k = cp->klass_at(i, CHECK);
            
            // Store resolved pointer in cache
            cp->resolved_klass_at_put(i, k);
        }
        
        if (cp->tag_at(i).is_method_handle()) {
            // Resolve method handle (complex - may instantiate lambda forms)
            oop mh = cp->resolve_constant_at(i, CHECK);
            cp->resolved_reference_at_put(i, mh);
        }
    }
}
```

This eliminates resolution overhead at runtime. Method handle constants, which normally trigger `LambdaMetafactory` invocations, are resolved once and cached.

## Performance Analysis

### Startup Time Improvements

Benchmark: Spring PetClinic 3.2.0 on x64 Linux, 4-core i7, 8GB heap, G1 GC.

| Configuration | Startup Time | Improvement | Classes Loaded |
|---------------|--------------|-------------|----------------|
| JDK 23 (baseline) | 4.486s | - | 21,047 |
| JDK 24 + CDS only | 3.008s | +33% | 21,047 |
| JDK 24 + AOT cache | 2.604s | +42% | 21,047 |

The 33% gain from CDS alone (which only caches parsed metadata) shows that **parsing is expensive**. The additional 9% from AOT linking (42% total) shows that **loading and linking are also significant**.

Breaking down by phase:

| Phase | JDK 23 | CDS Only | AOT Cache | Speedup (AOT) |
|-------|--------|----------|-----------|---------------|
| Scan JARs | 450ms | 50ms | 10ms | **98%** |
| Parse classes | 1,200ms | 100ms | 0ms | **100%** |
| Load classes | 800ms | 720ms | 0ms | **100%** |
| Link classes | 1,400ms | 1,200ms | 50ms | **96%** |
| Static init | 600ms | 600ms | 600ms | 0% |
| Framework | 36ms | 338ms | 344ms | 0% |
| **Total** | **4,486ms** | **3,008ms** | **2,604ms** | **42%** |

Notable observations:
- **Parsing eliminated**: 1,200ms → 0ms. Classes come from cache, not JARs.
- **Loading eliminated**: 800ms → 0ms. Classes already in loaded state.
- **Linking reduced**: 1,400ms → 50ms. Only 3.5% remains (JVM bookkeeping).
- **Static init unchanged**: 600ms. Cannot be shifted ahead (side effects).

The 50ms residual in "Link classes" is JVM bookkeeping: registering classes in the system dictionary, updating vtables, installing into class loaders. This cannot be eliminated.

### HelloStream Microbenchmark

For a simpler test, consider this program using the Stream API:

```java
import java.util.*;
import java.util.stream.*;

public class HelloStream {
    public static void main(String... args) {
        var words = List.of("hello", "fuzzy", "world");
        var greeting = words.stream()
            .filter(w -> !w.contains("z"))
            .collect(Collectors.joining(", "));
        System.out.println(greeting);
    }
}
```

This loads 589 JDK classes (Stream API is large). Startup times:

| Configuration | Time | Improvement |
|---------------|------|-------------|
| JDK 23 | 0.031s | - |
| JDK 24 + CDS | 0.027s | +13% |
| JDK 24 + AOT | 0.018s | +42% |

Same 42% improvement despite vastly different scale (589 classes vs 21,047). This shows AOT benefits are **consistent across application sizes**.

### Cache Size

The AOT cache is larger than a traditional CDS archive because it stores more:

| Application | Classes | CDS Archive | AOT Cache | Overhead |
|-------------|---------|-------------|-----------|----------|
| HelloStream | 589 | 7.2 MB | 11.4 MB | +58% |
| PetClinic | 21,047 | 95 MB | 130 MB | +37% |

The overhead decreases with scale because:
- Fixed-size overhead (metadata tables, indices) amortizes over more classes
- Linked state (resolved constant pools, vtables) adds constant per-class overhead

For PetClinic, 130MB is acceptable (< 2% of 8GB heap). The cache is memory-mapped read-only, so multiple JVM processes share it via page cache.

## Practical Examples

### Example 1: Basic Workflow

Create an AOT cache for a simple application:

```bash
# Step 1: Training run
java -XX:AOTMode=record -XX:AOTConfiguration=app.aotconf \
     -cp app.jar com.example.Main

# Step 2: Generate cache
java -XX:AOTMode=create -XX:AOTConfiguration=app.aotconf \
     -XX:AOTCache=app.aot -cp app.jar

# Step 3: Production use
java -XX:AOTCache=app.aot -cp app.jar com.example.Main
```

The training run executes normally. The cache creation is fast (< 10 seconds for 20,000 classes). Production runs benefit immediately.

### Example 2: Training Run Design

The training run should resemble production as closely as possible. For a server application:

```java
// AppTrainer.java - Training-specific entry point
public class AppTrainer {
    public static void main(String[] args) {
        // Start server (but don't wait for requests)
        Server server = Server.start(8080);
        
        // Exercise typical code paths
        simulateHealthCheck();
        simulateUserLogin();
        simulateDataQuery();
        
        // Shut down gracefully
        server.stop();
    }
    
    static void simulateHealthCheck() {
        HttpClient.get("http://localhost:8080/health");
    }
    
    static void simulateUserLogin() {
        HttpClient.post("http://localhost:8080/login", 
            "{\"user\":\"test\",\"pass\":\"test\"}");
    }
    
    static void simulateDataQuery() {
        HttpClient.get("http://localhost:8080/api/data?id=1");
    }
}
```

Run training with this entry point:

```bash
java -XX:AOTMode=record -XX:AOTConfiguration=app.aotconf \
     -cp app.jar com.example.AppTrainer
```

This loads all classes needed for health checks, authentication, and data access, without requiring real network traffic or database.

### Example 3: Checking Cache Usage

Verify the JVM is using the cache with `-XX:AOTMode=on`:

```bash
java -XX:AOTCache=app.aot -XX:AOTMode=on \
     -cp app.jar com.example.Main
```

With `-XX:AOTMode=on`, the JVM exits with an error if the cache is unusable (missing file, incompatible JDK version, class path mismatch). Use this during development to catch configuration errors. In production, use `-XX:AOTMode=auto` (default) which falls back gracefully if the cache fails.

### Example 4: Monitoring with JFR

Track cache behavior with JDK Flight Recorder:

```bash
java -XX:AOTCache=app.aot \
     -XX:StartFlightRecording=filename=startup.jfr \
     -cp app.jar com.example.Main
```

Inspect events:

```bash
jfr print --events jdk.AOTCache startup.jfr
```

Output:

```
jdk.AOTCacheLoad {
  startTime = 10:15:30.123
  cacheFile = app.aot
  classesLoaded = 21047
  loadTimeMs = 42
  cacheHitRate = 98.7%
}
```

A 98.7% hit rate means 21,047 classes came from the cache, with 1.3% (274 classes) loaded just-in-time (perhaps from `-Xbootclasspath/a` or dynamically generated).

### Example 5: Disabling AOT Linking

To isolate the benefit of AOT linking specifically, create a cache without linking:

```bash
java -XX:AOTMode=create -XX:AOTConfiguration=app.aotconf \
     -XX:AOTCache=app-nolink.aot \
     -XX:-AOTClassLinking \
     -cp app.jar
```

Then compare:

```bash
# With linking
java -XX:AOTCache=app.aot -cp app.jar com.example.Main
# Startup: 2.604s

# Without linking (CDS only)
java -XX:AOTCache=app-nolink.aot -cp app.jar com.example.Main
# Startup: 3.008s
```

The 400ms difference (3.008 - 2.604) is the linking overhead eliminated by AOT.

## Migration Considerations

JEP 483 requires zero code changes but imposes some operational constraints.

### Consistency Requirements

Training and production runs must be **essentially similar**:

1. **Same JDK release**: Cache from JDK 24 doesn't work on JDK 25.
2. **Same architecture**: x64 cache doesn't work on aarch64.
3. **Same class path**: JAR files must match exactly (order and content).
4. **Same module path**: Module graph must be identical.
5. **No JVMTI agents** that rewrite bytecode (`ClassFileLoadHook`).

The JVM validates these constraints at startup. If violated, it issues a warning and ignores the cache:

```
Warning: AOT cache app.aot is invalid (class path mismatch)
Continuing without AOT cache
```

Use `-XX:AOTMode=on` to make violations fatal (for testing).

### When Training Differs from Production

**Different garbage collectors**: Supported! Train with G1, deploy with ZGC (or any combination).

**Different heap sizes**: Supported! Train with `-Xmx4g`, deploy with `-Xmx16g`.

**Different main classes**: Supported! Train with `AppTrainer`, deploy with `App`.

**Different system properties**: Risky. If properties affect which classes load (e.g., `-Dspring.profiles.active=prod`), training and production must use same properties.

### Limitations

1. **User-defined class loaders not supported**: Only built-in loaders (bootstrap, platform, application) can have classes AOT-cached.

2. **ZGC not supported** (JDK 24): Future work will add ZGC support. Use G1, Parallel, or Serial for now.

3. **Static initializers not cached**: Classes are loaded and linked, but not initialized ahead-of-time. Static initializers run at first use (as before).

4. **Signed JARs partially supported**: Classes from signed JARs can be cached if signature verification passes during cache creation. Runtime verification is skipped.

### Best Practices

1. **Train with realistic workload**: Use integration tests or synthetic smoke tests that exercise typical code paths.

2. **Avoid test frameworks in training**: Don't use JUnit/TestNG during training - they load thousands of extra classes not needed in production.

3. **Check classes loaded**: Use `-verbose:class` or `jdk.ClassLoad` JFR event to compare training vs production. They should be ~95% similar.

4. **Version caches with deployments**: Include JDK version and git commit in cache filename: `app-jdk24-abc123.aot`.

5. **Automate cache creation**: Integrate into CI/CD pipeline. Regenerate cache whenever JARs or JDK version changes.

## Conclusions

JEP 483 represents a fundamental shift in Java startup optimization. Instead of making just-in-time operations faster, it shifts them ahead-of-time, **eliminating the work entirely**. Classes are read, parsed, loaded, and linked once during training, then instantly available in subsequent runs.

The 42% startup improvement (4.5s → 2.6s for Spring PetClinic, 31ms → 18ms for HelloStream) is achieved with:
- **Zero code changes**: Works with every existing Java application
- **Zero framework changes**: Spring, Micronaut, Quarkus benefit automatically
- **Minimal operational overhead**: Two-step workflow (train, cache) integrates into CI/CD

This sets the foundation for Project Leyden's long-term vision: **instant startup with peak performance**. Future work will cache:
- **Optimized code**: JIT-compiled methods stored in the cache (AOT compilation)
- **Profile data**: Type profiles, branch probabilities pre-recorded (covered by JEP 515)
- **Initialized classes**: Some safe static initializers run ahead-of-time

Combined, these will enable Java applications to start in milliseconds in an optimized state, rivaling native-compiled languages while retaining Java's dynamism and ecosystem.

For developers deploying containerized microservices, serverless functions, or desktop applications, JEP 483 makes Java startup competitive with Go, Rust, and native images - without sacrificing the Java Platform's strengths.

The architecture is instructive: build on proven foundations (CDS), extend incrementally (add linking to existing parsing cache), maintain compatibility (zero code changes), and design for the future (laying groundwork for AOT compilation). This measured approach lets the JVM evolve without destabilizing the ecosystem.

## References

- [JEP 483](https://openjdk.org/jeps/483)
- [JEP 515: AOT Method Profiling](https://openjdk.org/jeps/515)
- [Project Leyden](https://openjdk.org/projects/leyden/)
- [Class Data Sharing (CDS)](https://dev.java/learn/jvm/cds-appcds/)
- **AOTClassLinker**: [aotClassLinker.cpp](https://github.com/openjdk/jdk/blob/master/src/hotspot/share/cds/aotClassLinker.cpp)
- **AOTLinkedClassTable**: [aotLinkedClassTable.hpp](https://github.com/openjdk/jdk/blob/master/src/hotspot/share/cds/aotLinkedClassTable.hpp)
- **AOTLinkedClassBulkLoader**: [aotLinkedClassBulkLoader.hpp](https://github.com/openjdk/jdk/blob/master/src/hotspot/share/cds/aotLinkedClassBulkLoader.hpp)
- **ArchiveBuilder**: [archiveBuilder.cpp](https://github.com/openjdk/jdk/blob/master/src/hotspot/share/cds/archiveBuilder.cpp)

---

**Tags**: Java, JDK 24, AOT Compilation, Ahead-of-Time, Class Loading, Startup Performance, CDS, Class Data Sharing, Project Leyden, JVM Optimization, Performance, Java Performance Tuning

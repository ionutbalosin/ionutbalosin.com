# Ahead-of-Time Method Profiling: Eliminating JIT Warmup Overhead

## Content

- [Introduction](#introduction)
- [The Warmup Problem](#the-warmup-problem)
- [How AOT Method Profiling Works](#how-aot-method-profiling-works)
- [Technical Deep Dive](#technical-deep-dive)
- [Performance Analysis](#performance-analysis)
- [Practical Examples](#practical-examples)
- [Migration Considerations](#migration-considerations)
- [Conclusions](#conclusions)
- [References](#references)

## Introduction

Anyone who's run Java applications in production knows the warmup dance: your service starts, requests trickle in, response times are terrible for the first few minutes, and gradually—sometimes painfully slowly—performance improves as the JIT compiler kicks in. This warmup period isn't a quirk; it's fundamental to how HotSpot works. The JVM needs to observe which methods are hot before it can optimize them.

JEP 515 tackles this chicken-and-egg problem head-on. Instead of collecting method profiles during production runs, we shift that work to training runs. The profiles get stored in an AOT cache, and when your application starts in production, the JIT compiler already knows what to optimize. The result? A 19% improvement in warmup time for the example in the JEP, with the promise of even better gains for more complex applications.

This feature builds on JEP 483 (AOT Class Loading & Linking) and JEP 514 (AOT Command-Line Ergonomics), extending the AOT cache to include not just pre-loaded classes but also the runtime behavior data that drives JIT optimization decisions.

## The Warmup Problem

HotSpot's design philosophy centers on observation-based optimization. The JVM doesn't guess which methods matter—it measures. When a method gets called repeatedly, HotSpot increments counters. When those counters hit thresholds, the method becomes a candidate for JIT compilation. But here's the catch: collecting those profiles takes time and CPU cycles.

During the warmup period, several things happen simultaneously:
- The interpreter executes bytecode (much slower than native code)
- Profile counters accumulate
- The C1 compiler generates tier-2 and tier-3 code
- Eventually, C2 compiles hot methods with aggressive optimizations

Each step requires actual execution. You can't statically analyze a Java application and predict which code paths will dominate at runtime. Polymorphism, dynamic class loading, and user input all influence execution patterns in ways that defy static analysis.

Consider a REST API handling diverse request types. During warmup:
```java
@RestController
public class OrderController {
    public Response processOrder(Order order) {
        // First few hundred requests: interpreter mode
        // JVM observes: OrderValidator.validate() called frequently
        // After threshold: C1 compiles validate()
        // More observations: specific order types dominate
        // Eventually: C2 compiles with type-specific optimizations
        
        validator.validate(order);
        paymentService.charge(order);
        inventoryService.reserve(order);
        return Response.ok();
    }
}
```

During those first few hundred requests, users experience higher latency. For microservices that scale up and down frequently, or serverless functions that start fresh for each invocation, this warmup overhead becomes a significant portion of total runtime.

## How AOT Method Profiling Works

The core idea: run your application with a representative workload, collect profiles, save them to disk, and reload them on subsequent starts. HotSpot already had infrastructure for profiling (`MethodData` objects), so JEP 515 extends this to persist and restore profiles across JVM invocations.

**Training Run:**
```bash
# Record profiles during a training run
java -XX:AOTCache=app.aot -XX:AOTMode=record \
     -jar myapp.jar

# Or using AOT configuration
java -XX:AOTConfiguration=app.aotconfig -XX:AOTMode=record \
     -jar myapp.jar
```

During recording, the JVM writes:
- Method invocation counts
- Branch taken/not-taken statistics
- Type profiles (which concrete classes appear at call sites)
- Deoptimization traps and their reasons

**Production Run:**
```bash
# Use cached profiles
java -XX:AOTCache=app.aot \
     -jar myapp.jar
```

When loading the cache, HotSpot:
1. Deserializes `MethodData` structures
2. Associates them with their corresponding methods
3. Immediately makes them available to the compilation policy
4. Starts JIT compilation based on cached profiles, not fresh observations

Critically, this doesn't freeze behavior. The JVM continues profiling during production runs. If actual runtime behavior diverges from training—new code paths activate, different types appear—HotSpot adapts. Cached profiles provide a head start, not a straitjacket.

## Technical Deep Dive

### Method Training Data Storage

The implementation introduces `MethodTrainingData` to track compilation history:

```cpp
// From https://github.com/openjdk/jdk/blob/master/src/hotspot/share/oops/trainingData.hpp
class MethodTrainingData : public TrainingData {
  KlassTrainingData* _klass;
  Method* _holder;
  
  // Compilation level history
  CompileTask* _last_toplevel_compiles[CompLevel_count - 1];
  int _highest_top_level;
  uint _level_mask;
  bool _was_toplevel;
  
  // The cached profile from training
  MethodData* _final_profile;
  
  int _invocation_count;
  int _backedge_count;
  
public:
  bool saw_level(CompLevel l) const { 
    return (_level_mask & level_mask(l)) != 0; 
  }
  int highest_top_level() const { return _highest_top_level; }
  MethodData* final_profile() const { return _final_profile; }
};
```

Each method that was hot during training gets a `MethodTrainingData` object. The `_final_profile` field points to the actual `MethodData` structure containing invocation counts, branch statistics, and type profiles.

### Profile Installation at Startup

When loading an AOT cache, HotSpot checks if training data exists before allocating fresh `MethodData`:

```cpp
// From https://github.com/openjdk/jdk/blob/master/src/hotspot/share/oops/method.cpp
void Method::build_profiling_method_data(const methodHandle& method, TRAPS) {
  // Try to install training data first
  if (install_training_method_data(method)) {
    return;  // Success - we have cached profiles
  }
  
  // Fall back to allocating new MethodData
  ClassLoaderData* loader_data = method->method_holder()->class_loader_data();
  MethodData* method_data = MethodData::allocate(loader_data, method, THREAD);
  // ...
}
```

The `install_training_method_data()` function attempts to attach the cached `MethodData*` directly:

```cpp
bool install_training_method_data(const methodHandle& method) {
  MethodTrainingData* mtd = method->training_data();
  if (mtd != nullptr && mtd->final_profile() != nullptr) {
    AtomicAccess::replace_if_null(&method->_method_data, mtd->final_profile());
    return true;
  }
  return false;
}
```

This atomic operation ensures thread-safety during initialization. If multiple threads try to compile the same method early, only one successfully installs the training profile.

### Compilation Policy Adjustments

The tiered compilation policy adapts when training data is available:

```cpp
// From https://github.com/openjdk/jdk/blob/master/src/hotspot/share/compiler/compilationPolicy.cpp
CompLevel CompilationPolicy::trained_transition_from_none(
    const methodHandle& method, MethodTrainingData* mtd, JavaThread* THREAD) {
  
  bool training_has_profile = (mtd->final_profile() != nullptr);
  
  // If trained at C2 but no saved profile, collect one now
  if (mtd->saw_level(CompLevel_full_optimization) && !training_has_profile) {
    return CompLevel_full_profile;
  }
  
  CompLevel highest_training_level = 
      static_cast<CompLevel>(mtd->highest_top_level());
  
  switch (highest_training_level) {
    case CompLevel_limited_profile:
    case CompLevel_full_profile:
      return CompLevel_limited_profile;
    case CompLevel_full_optimization:
      // We have a C2 profile - maybe skip directly to C2
      if (SkipTier2IfPossible && ctd->init_deps_left_acquire() == 0) {
        return CompLevel_full_optimization;
      }
      return CompLevel_limited_profile;
    default:
      return CompLevel_none;
  }
}
```

When `SkipTier2IfPossible` is set and all dependencies are satisfied, methods can jump directly to tier-4 (C2) compilation. This aggressive strategy works because we have high-quality profiles from training, reducing the risk of speculative optimizations failing.

### MethodData Structure

The `MethodData` class stores per-bytecode profiling information:

```cpp
// From https://github.com/openjdk/jdk/blob/master/src/hotspot/share/oops/methodData.hpp
class MethodData : public Metadata {
  // Compiler counters
  uint _nof_decompiles;
  uint _nof_overflow_recompiles;
  uint _nof_overflow_traps;
  
  // Per-bytecode profiling data follows in a variable-length array
  // Each bytecode that needs profiling gets a DataLayout cell
  
  static int compute_allocation_size_in_bytes(const methodHandle& method);
  static MethodData* allocate(ClassLoaderData* loader_data, 
                               const methodHandle& method, TRAPS);
};
```

Different bytecodes require different profile structures:
- `invokevirtual`: `VirtualCallData` (receiver type histogram)
- `if_icmpge`: `BranchData` (taken/not-taken counts)
- `checkcast`: `ReceiverTypeData` (observed types)
- `invokedynamic`: `CallTypeData` (argument and return type profiles)

The layout is computed during `MethodData` allocation:

```cpp
int MethodData::compute_allocation_size_in_bytes(const methodHandle& method) {
  int data_size = 0;
  BytecodeStream stream(method);
  Bytecodes::Code c;
  
  while ((c = stream.next()) >= 0) {
    int size_in_bytes = compute_data_size(&stream);
    data_size += size_in_bytes;
  }
  
  // Add extra cells for trap history, argument info, parameters
  int extra_data_count = compute_extra_data_count(data_size, ...);
  object_size += extra_data_count * DataLayout::compute_size_in_bytes(0);
  
  return object_size;
}
```

Each `MethodData` object is precisely sized for its method's bytecode, avoiding waste.

## Performance Analysis

The JEP documents a concrete example: a Stream API program that loads 900 classes and compiles 30 hot methods.

**Without AOT Profiles:**
- Runtime: 90 milliseconds
- Warmup dominated by interpreter execution and incremental compilation

**With AOT Profiles:**
- Runtime: 73 milliseconds
- Improvement: **19%**
- Cache overhead: 250 KB (2.5% increase)

That 17-millisecond savings comes from:
- Earlier C2 compilation starts (profiles available immediately)
- More accurate initial optimizations (training data reflects real usage)
- Reduced time spent in lower-tier compiled code

For longer-running applications, the gains compound. Consider a microservice handling 1000 requests/second:
- Traditional warmup: 10 seconds at degraded performance
- With AOT profiles: 3 seconds warmup
- Difference: 7 seconds × 1000 req/s = 7000 requests see better latency

In autoscaling scenarios where pods spin up and down frequently, this matters enormously. A 70% reduction in warmup time means new instances reach full capacity faster, reducing the need for over-provisioning.

### Cache Size Considerations

The 250 KB overhead for cached profiles is remarkably modest. Profile data is dense:
- Method metadata: ~100 bytes per hot method
- Per-bytecode counters: 8-16 bytes per profiled bytecode
- Type profiles: ~32 bytes per polymorphic call site

For 30 hot methods with mixed bytecode, 250 KB provides comprehensive coverage. Applications with hundreds of hot methods might see 1-2 MB of profile data, still negligible compared to class metadata and heap usage.

## Practical Examples

### Example 1: Web Service Startup

```java
// A typical Spring Boot application
@SpringBootApplication
public class OrderServiceApplication {
    public static void main(String[] args) {
        SpringApplication.run(OrderServiceApplication.class, args);
    }
}

@RestController
public class OrderController {
    private final OrderRepository orderRepo;
    
    @GetMapping("/orders/{id}")
    public Order getOrder(@PathVariable Long id) {
        return orderRepo.findById(id)
            .orElseThrow(() -> new OrderNotFoundException(id));
    }
    
    @PostMapping("/orders")
    public Order createOrder(@RequestBody OrderRequest request) {
        Order order = Order.fromRequest(request);
        validateOrder(order);
        return orderRepo.save(order);
    }
    
    private void validateOrder(Order order) {
        // Complex validation logic executed frequently
        if (order.items().isEmpty()) {
            throw new ValidationException("Empty order");
        }
        // ... more validation
    }
}
```

**Training workflow:**
```bash
# Step 1: Record during load testing
java -XX:AOTCache=order-service.aot -XX:AOTMode=record \
     -jar order-service.jar &

# Generate realistic load
ab -n 10000 -c 50 http://localhost:8080/orders/123

# Step 2: Production deployment uses cached profiles
java -XX:AOTCache=order-service.aot \
     -jar order-service.jar
```

The training run captures which endpoints get called, which validation paths execute, and which database queries dominate. Production instances start with that knowledge baked in.

### Example 2: Batch Processing

```java
public class LogAnalyzer {
    public void processLogs(Stream<LogEntry> logs) {
        Map<String, Long> errorCounts = logs
            .filter(entry -> entry.level() == Level.ERROR)
            .collect(Collectors.groupingBy(
                LogEntry::component,
                Collectors.counting()
            ));
        
        errorCounts.forEach((component, count) -> {
            if (count > THRESHOLD) {
                alertService.sendAlert(component, count);
            }
        });
    }
}
```

Stream pipelines are notoriously tricky for JIT compilers. The filter/map/collect chain involves multiple lambda invocations, method references, and boxing operations. Training data helps the JIT specialize these operations aggressively:

- Which log entry types dominate?
- Are most entries filtered out or kept?
- Does the grouping key have high cardinality?

With cached profiles, the JIT makes better inlining decisions from the start.

### Example 3: Gaming Server

```java
public class GameServer {
    private final Map<PlayerId, GameState> activeSessions = new ConcurrentHashMap<>();
    
    public void handleAction(PlayerId player, Action action) {
        GameState state = activeSessions.get(player);
        
        // The JVM observes: Move actions dominate (80%)
        // Attack actions: 15%, Chat: 5%
        switch (action.type()) {
            case MOVE -> handleMove(state, action);
            case ATTACK -> handleAttack(state, action);
            case CHAT -> handleChat(state, action);
        }
    }
}
```

During training, the JVM observes that `MOVE` dominates the switch statement. With cached profiles, the JIT immediately generates code optimized for that branch, potentially inlining `handleMove()` while keeping other branches as cold calls.

## Migration Considerations

### Creating Effective Training Runs

The quality of cached profiles depends entirely on how representative your training workload is. Guidelines:

**DO:**
- Use production-like data volumes
- Exercise all critical code paths
- Run long enough to trigger C2 compilation (10+ seconds)
- Include edge cases that occur frequently in production

**DON'T:**
- Use synthetic microbenchmarks
- Focus exclusively on happy paths
- Train for too short (profiles incomplete)
- Train for too long (wasted time after profiles stabilize)

A good training run mimics production load distribution. If 80% of production traffic hits endpoint A and 20% hits endpoint B, your training run should match that ratio.

### Version Management

AOT caches are tied to specific JVM builds and class versions. When to regenerate:
- JDK update (profiles may be incompatible)
- Application code changes (profiles no longer match bytecode)
- Performance characteristics shift (profiles become misleading)

Consider automating cache generation in CI/CD:
```bash
# In your build pipeline
./gradlew build
java -XX:AOTMode=record -XX:AOTCache=target/app.aot \
     -jar build/app.jar < training-script.txt
# Package app.aot alongside app.jar
```

### Monitoring

Check if profiles are being used:
```bash
java -Xlog:compilation,aot \
     -XX:AOTCache=app.aot \
     -jar app.jar
```

Look for log messages like:
```
[aot] Loaded method profile for com.example.Service.process()
[compilation] Compiling at tier 4 immediately (trained profile available)
```

If you see methods compiling at tier 2 despite having training data, investigate cache validity.

### Compatibility

- **JDK Version:** Requires JDK 25+
- **Garbage Collectors:** Works with all GCs (G1, Parallel, ZGC, Shenandoah)
- **Platform:** All 64-bit platforms supported by HotSpot
- **Frameworks:** Framework-agnostic (profiles work regardless of application structure)

No code changes required. This is purely a deployment-time optimization controlled by JVM flags.

## Conclusions

Ahead-of-time method profiling fundamentally changes the JVM warmup story. By decoupling profile collection from production execution, we eliminate one of Java's longstanding pain points: that awkward period where your application is running but not yet running well.

The 19% improvement demonstrated in the JEP is impressive for a trivial program. Real-world applications with hundreds of hot methods and complex execution patterns stand to gain even more. Combined with AOT class loading (JEP 483) and AOT object caching (JEP 516), we're seeing a comprehensive attack on startup and warmup overhead.

What's particularly elegant about this feature is how it preserves HotSpot's adaptive optimization while front-loading the benefits. Training profiles don't lock in behavior—they inform initial optimization decisions. The JVM continues observing, continues adapting, continues optimizing based on actual runtime behavior. We get the best of both worlds: fast initial performance and long-term adaptability.

For teams running microservices, serverless functions, or any workload where startup time matters, JEP 515 is a game-changer. The implementation complexity is hidden behind simple command-line flags, and the performance gains are immediate.

## References

- [JEP 515: Ahead-of-Time Method Profiling](https://openjdk.org/jeps/515)
- [JEP 483: Ahead-of-Time Class Loading & Linking](https://openjdk.org/jeps/483)
- [JEP 514: Ahead-of-Time Command-Line Ergonomics](https://openjdk.org/jeps/514)
- [Project Leyden](https://openjdk.org/projects/leyden)
- [OpenJDK Source: trainingData.hpp](https://github.com/openjdk/jdk/blob/master/src/hotspot/share/oops/trainingData.hpp)
- [OpenJDK Source: methodData.hpp](https://github.com/openjdk/jdk/blob/master/src/hotspot/share/oops/methodData.hpp)
- [OpenJDK Source: compilationPolicy.cpp](https://github.com/openjdk/jdk/blob/master/src/hotspot/share/compiler/compilationPolicy.cpp)

---

**Tags**: Java, JDK 25, AOT Compilation, Ahead-of-Time, Method Profiling, JIT Compiler, Performance, Startup Time, Code Generation, HotSpot, PGO, Profile-Guided Optimization, Java Performance

# JFR Method Timing and Tracing: Deterministic Profiling Without Overhead

## Content

- [Introduction](#introduction)
- [Why This Matters](#why-this-matters)
- [How Method Tracing Works](#how-method-tracing-works)
- [Technical Deep Dive](#technical-deep-dive)
- [Performance Analysis](#performance-analysis)
- [Practical Examples](#practical-examples)
- [Migration Considerations](#migration-considerations)
- [Conclusions](#conclusions)
- [References](#references)

## Introduction

Profilers are great until you need precision. Sampling-based tools like JFR's built-in profiler or async-profiler give you flame graphs and hot method lists, but they're fundamentally statistical. If a method executes 100 times and you're sampling at 10ms intervals, you might catch it 5 times, or 15 times, or miss it entirely if it's fast.

JEP 520 brings something different to Java 25: exact, deterministic method instrumentation through JFR. Instead of hoping your profiler catches important method invocations, you tell JFR exactly which methods to watch, and it instruments them with bytecode that records every single call. Want to know precisely how many times `HashMap.resize()` ran? Now you can. Need stack traces for every database connection that wasn't closed? Done.

The implementation leverages bytecode instrumentation—JFR injects tracking code at method entry and exit points. This isn't new technology (Java agents have done this for years), but having it built into the JDK, controlled by simple flags and configuration files, changes what's practical. No more setting up agents, no more parsing bytecode twice, no friction.

## Why This Matters

Let's talk about what sampling profilers can't do well.

Suppose your application occasionally hangs for 200ms. Your profiler runs every 10ms, so it catches... something. Maybe the hang happened during garbage collection. Maybe it was waiting on a lock. Maybe it was deep in a nested call that your stack sampling happened to miss. You get approximations, not certainty.

Or consider debugging a resource leak. Your application runs out of database connections after several hours. A sampling profiler might show you that `ConnectionPool.acquire()` gets called frequently, but you need more: Which code paths forget to release connections? How many times did `release()` actually run compared to `acquire()`? Sampling won't tell you—it might miss the rare paths where connections leak.

JEP 520 addresses these scenarios by offering complete visibility into specific methods. The trade-off? Higher overhead. If you instrument 500 hot methods simultaneously, your application will slow down noticeably. That's why the JEP explicitly warns against timing or tracing too many methods at once. This feature isn't meant to replace sampling profilers—it complements them. Sample first to identify suspects, then instrument precisely to gather evidence.

Here's where it shines:
- **Static initializers**: They run once, so sampling might miss them entirely. Timing all `<clinit>` methods reveals startup bottlenecks.
- **Resource management**: Trace constructor/destructor pairs to find leaks.
- **Rare code paths**: That exception handler that fires once per thousand requests? You'll catch every invocation.
- **Annotation-based profiling**: Instrument all methods marked `@SlowQuery` to track database performance without modifying code.

The key insight: sometimes you need surgery, not statistics.

## How Method Tracing Works

JFR introduces two new events: `jdk.MethodTiming` and `jdk.MethodTrace`. Both accept filters to select methods, but they serve different purposes.

**`jdk.MethodTiming`** tracks aggregate statistics:
- How many times did the method run?
- What was the average execution time?
- Min/max execution times?

It emits periodic events (every 10 seconds by default), summarizing activity since the last emission. Low per-invocation overhead because it doesn't capture stack traces—just increment counters and accumulate durations.

**`jdk.MethodTrace`** captures individual invocations:
- Exact start time
- Duration
- Complete stack trace showing who called it
- Thread information

Every method invocation generates an event, so overhead is higher. Use this when you need forensic detail about specific calls.

### Filter Syntax

Filters use method reference syntax familiar from Java code:

```bash
# Specific method
java.util.HashMap::resize

# All methods in a class
java.util.HashMap

# All static initializers
::<clinit>

# All constructors in a class
java.io.File::<init>

# Methods with specific annotations
@jakarta.ws.rs.GET

# Multiple filters separated by semicolons
java.io.FileDescriptor::<init>;java.io.FileDescriptor::close
```

Annotations are particularly elegant. Mark methods with `@Profile` during development, then activate instrumentation in production without redeploying:

```java
@Retention(RUNTIME)
@Target({ TYPE, METHOD })
public @interface Profile {}

public class OrderService {
    @Profile
    public void processOrder(Order order) {
        // JFR can instrument this without code changes
    }
}
```

Command-line usage:
```bash
java -XX:StartFlightRecording:method-timing=@com.example.Profile ...
```

### Instrumentation Mechanics

When you specify a filter, JFR modifies method bytecode at class load time (or via retransformation for already-loaded classes). The injected code looks conceptually like this:

```java
// Original method
public void processOrder(Order order) {
    validateOrder(order);
    saveOrder(order);
}

// After instrumentation for tracing
public void processOrder(Order order) {
    long startTime = MethodTracer.timestamp();
    try {
        validateOrder(order);
        saveOrder(order);
    } finally {
        MethodTracer.trace(startTime, METHOD_ID);
    }
}

// After instrumentation for timing
public void processOrder(Order order) {
    long startTime = MethodTracer.timestamp();
    try {
        validateOrder(order);
        saveOrder(order);
    } finally {
        MethodTracer.timing(startTime, METHOD_ID);
    }
}
```

The `MethodTracer` class lives in the `jdk.jfr.tracing` package and handles event emission. For timing, it updates counters in a concurrent map keyed by method ID. For tracing, it commits JFR events directly.

Constructors require special handling because of JVM initialization rules—you can't execute arbitrary code before `super()` or `this()`. JFR places instrumentation after the superclass constructor completes.

## Technical Deep Dive

### Bytecode Transformation Architecture

The implementation centers around `JfrMethodTracer`, which orchestrates filter evaluation and class retransformation:

```cpp
// From https://github.com/openjdk/jdk/blob/master/src/hotspot/share/jfr/support/methodtracer/jfrMethodTracer.cpp
void JfrMethodTracer::on_klass_creation(InstanceKlass*& ik, 
                                        ClassFileParser& parser, 
                                        TRAPS) {
  // 1. Is this the initial load or a retransform?
  const InstanceKlass* const existing_ik = 
      JfrClassTransformer::find_existing_klass(ik, THREAD);
  const bool is_retransform = existing_ik != nullptr;
  
  // 2. Test methods against installed filters
  JfrMethodProcessor mp(is_retransform ? existing_ik : ik, THREAD);
  if (!mp.has_methods()) {
    return;  // No matches
  }
  
  // 3. Construct modified bytecode with instrumentation
  const ClassFileStream* clone = parser.clone_stream();
  ClassFileStream* result = JfrUpcalls::on_method_trace(
      ik, clone, mp.methods(), THREAD);
  
  // 4. Create new InstanceKlass from modified bytecode
  InstanceKlass* new_ik = JfrClassTransformer::create_instance_klass(
      ik, result, !is_retransform, THREAD);
  
  // 5. Replace original klass with instrumented version
  JfrClassTransformer::rewrite_klass_pointer(ik, new_ik, parser, THREAD);
}
```

This hook runs during class loading. When JFR detects a filter match, it calls out to Java code (`JfrUpcalls::on_method_trace`) to perform the actual bytecode manipulation. Why Java? Because bytecode transformation is complex and error-prone. Using libraries like ASM (via the Instrumentation API) keeps the native code simpler.

### Filter Evaluation

The `JfrFilter` class holds configured filters and evaluates them against classes and methods:

```cpp
// From https://github.com/openjdk/jdk/blob/master/src/hotspot/share/jfr/support/methodtracer/jfrFilter.cpp
int JfrFilter::method_modifications(const Method* method) const {
  InstanceKlass* klass = method->method_holder();
  int result = NONE;
  
  for (int i = 0; i < _count; i++) {
    Symbol* annotation_name = _annotation_names[i];
    
    if (annotation_name != nullptr) {
      // Check method annotations
      if (match_annotations(klass, method->annotations(), 
                           annotation_name, false)) {
        result = combine_bits(result, _modifications[i]);
      }
    } else {
      Symbol* class_name = _class_names[i];
      if (class_name == nullptr || klass->name() == class_name) {
        Symbol* method_name = _method_names[i];
        if (method_name == nullptr || 
            (method->name() == method_name && can_instrument_method(method))) {
          result = combine_bits(result, _modifications[i]);
        }
      }
    }
  }
  return result;
}
```

The result is a bitmask indicating whether to apply timing (bit 0), tracing (bit 1), or both. Multiple filters can match the same method, combining their effects.

Protection against dangerous instrumentation:

```cpp
bool JfrFilter::can_instrument_class(const InstanceKlass* ik) const {
  if (ik->is_hidden()) return false;
  if (JdkJfrEvent::is_a(ik)) return false;  // Don't instrument JFR itself
  if (ik == vmClasses::Continuation_klass()) return false;
  if (ik->module()->name()->equals("jdk.jfr", 7)) return false;
  return can_instrument_module(ik->module());
}
```

Instrumenting JFR's own code would cause infinite recursion. The JEP acknowledges this is "fragile" and asks users to report bugs if they encounter recursion. In practice, the exclusion list covers most dangerous cases.

### Java-Side Instrumentation

The actual bytecode modification happens in Java, using the `jdk.jfr.internal.tracing.Transform` class:

```java
// From https://github.com/openjdk/jdk/blob/master/src/jdk.jfr/share/classes/jdk/jfr/internal/tracing/Transform.java
@Override
public void accept(CodeBuilder builder, CodeElement element) {
  if (simplifiedInstrumentation) {
    acceptSimplifiedInstrumentation(builder, element);
    return;
  }
  
  if (method.constructor()) {
    acceptConstructor(builder, element, isConstructorInvocation(element));
  } else {
    acceptRegularMethod(builder, element);
  }
}

private void acceptRegularMethod(CodeBuilder builder, CodeElement element) {
  if (element instanceof LabelTarget target) {
    // Entry point - inject timestamp capture
    if (timestampSlot == -1) {
      timestampSlot = allocateTimestampSlot();
      builder.invokestatic(METHOD_TRACER_CLASS, TIMESTAMP_METHOD);
      builder.lstore(timestampSlot);
    }
  }
  
  if (element instanceof ReturnInstruction) {
    // Exit point - emit event
    builder.lload(timestampSlot);
    builder.ldc(method.methodId());
    if (method.isTiming() && method.isTracing()) {
      builder.invokestatic(METHOD_TRACER_CLASS, TRACE_TIMING_METHOD);
    } else if (method.isTiming()) {
      builder.invokestatic(METHOD_TRACER_CLASS, TIMING_METHOD);
    } else {
      builder.invokestatic(METHOD_TRACER_CLASS, TRACE_METHOD);
    }
  }
  
  builder.accept(element);  // Pass through original instruction
}
```

The transformer injects:
1. **At method entry**: Call `MethodTracer.timestamp()` and store in a local variable
2. **At each return**: Load the start time, push the method ID, call the appropriate tracing/timing method

For exception paths, similar instrumentation wraps in `try-finally` blocks to ensure events get emitted even when methods throw.

### Timing Data Aggregation

`MethodTiming` events aggregate statistics across invocations:

```java
// From https://github.com/openjdk/jdk/blob/master/src/jdk.jfr/share/classes/jdk/jfr/internal/tracing/PlatformTracer.java
public static void addTiming(long id, long duration) {
  TimedMethod entry = timedMethods.get(id);
  if (entry != null) {
    entry.invocations().getAndIncrement();
    entry.time().addAndGet(duration);
    entry.updateMinMax(duration);
  }
}

public static void emitTiming() {
  synchronized (MetadataRepository.getInstance()) {
    removeClasses(JVM.drainStaleMethodTracerIds());
    long timestamp = MethodTimingEvent.timestamp();
    for (var tc : timedClasses.values()) {
      tc.emit(timestamp);  // Emit periodic summary
    }
  }
}
```

A background thread calls `emitTiming()` periodically (configurable via the `period` setting). Each `TimedMethod` object maintains:
- `AtomicLong invocations`: total call count
- `AtomicLong time`: cumulative duration
- `volatile long min/max`: extreme values

Lock-free updates keep per-invocation overhead low. The periodic emission resets counters, so each event represents activity since the last emission.

### Stack Trace Capture

`MethodTrace` events include full stack traces:

```cpp
// JFR automatically captures stack traces when configured
jdk.MethodTrace {
  startTime = 00:39:26.379
  duration = 0.00113 ms
  method = java.util.HashMap.resize()
  eventThread = "main"
  stackTrace = [
    java.util.HashMap.putVal(...)
    java.util.HashMap.put(...)
    sun.awt.AppContext.put(...)
    // ... full trace
  ]
}
```

Stack walking is expensive—JFR walks the stack, resolves method metadata, and formats strings for each frame. That's why tracing has higher overhead than timing. Use it judiciously.

## Performance Analysis

Overhead depends entirely on what you instrument. A few rarely-called methods? Negligible. Hundreds of hot methods? Your application will crawl.

The JEP doesn't provide hard numbers because overhead varies wildly. Let's reason through some scenarios:

**Timing a single hot method (1M invocations/second):**
- Per-invocation cost: ~50ns (timestamp capture + atomic increments)
- Total overhead: 50ms/second = 5%

**Tracing a rare method (10 invocations/second):**
- Per-invocation cost: ~10µs (timestamp + stack walk + event emission)
- Total overhead: 100µs/second = negligible

**Timing all static initializers:**
- They run once at class load
- Total cost: milliseconds added to startup
- No runtime impact once classes are loaded

**Tracing a method in a tight loop:**
- Don't do this. If a method runs 100,000 times per second and you trace every call, you'll generate 100,000 JFR events per second, overwhelming the recording buffer.

Guidelines from experience:
- **Timing**: Reasonable for methods called thousands of times per second
- **Tracing**: Use for methods called < 100 times per second
- **Annotations**: Safe if annotated methods aren't called excessively
- **Static initializers**: Always safe (one-time cost)

JFR Flight Recorder normally aims for < 1% overhead. Method timing/tracing explicitly abandons that goal. The documentation warns: "It is not a goal to remain within this constraint when timing and tracing methods." Plan accordingly.

### Filtering Strategies

Start narrow, expand gradually:

```bash
# Step 1: Identify suspects with sampling
jcmd <pid> JFR.start name=sample duration=60s settings=profile

# Step 2: Instrument specific method
jcmd <pid> JFR.start method-trace=com.example.SuspiciousService::slowMethod

# Step 3: Examine results
jcmd <pid> JFR.dump filename=trace.jfr
jfr view MethodTrace trace.jfr
```

If you need coverage of many methods, use timing rather than tracing—aggregate statistics cost far less than per-invocation events with stack traces.

## Practical Examples

### Example 1: Finding Startup Bottlenecks

A Spring Boot application takes 15 seconds to start. Where's the time going?

```bash
$ java '-XX:StartFlightRecording:method-timing=::<clinit>,filename=startup.jfr' \
       -jar my-app.jar

$ jfr view method-timing startup.jfr

                                 Method Timing

Timed Method                                           Invocations Average Time
------------------------------------------------------ ----------- ------------
sun.font.HBShaper.<clinit>()                                     1 32.500000 ms
java.awt.GraphicsEnvironment$LocalGE.<clinit>()                  1 32.400000 ms
org.springframework.core.io.support.ResourceLoader.<clinit>()    1 18.900000 ms
java.nio.file.TempFileHelper.<clinit>()                          1 17.100000 ms
```

Four static initializers consume 100ms. Dig deeper into `ResourceLoader`—maybe it's scanning classpath resources that could be lazily loaded.

### Example 2: Tracking Resource Leaks

Database connections leak somewhere in a microservice:

```bash
$ java '-XX:StartFlightRecording:method-trace=com.zaxxer.hikari.pool.HikariPool::getConnection;com.zaxxer.hikari.pool.PoolEntry::close,filename=leak.jfr' \
       -jar service.jar

# Let it run for a while, then analyze
$ jfr view --cell-height 10 MethodTrace leak.jfr

                                                  Method Trace

Start Time  Duration  Event Thread       Method
----------  --------  -----------------  ---------------------------------------
14:23:01    0.120 ms  http-nio-8080-123  HikariPool.getConnection()
                                         Stack: OrderController.createOrder()
14:23:01    0.002 ms  http-nio-8080-123  PoolEntry.close()
14:23:02    0.110 ms  http-nio-8080-124  HikariPool.getConnection()
                                         Stack: OrderController.getOrders()
// Missing close for this connection!
14:23:03    0.115 ms  http-nio-8080-125  HikariPool.getConnection()
                                         Stack: OrderController.updateOrder()
14:23:03    0.001 ms  http-nio-8080-125  PoolEntry.close()
```

The second `getConnection()` call has no matching `close()`. Check `OrderController.getOrders()`—probably an exception thrown before the connection gets released.

### Example 3: Profiling REST Endpoints

An API has variable response times. Which endpoints are slow?

```java
// Annotate endpoints (or use existing JAX-RS annotations)
@RestController
public class UserController {
    
    @GetMapping("/users")
    @GET  // Jakarta RS annotation
    public List<User> getUsers() {
        return userService.findAll();
    }
    
    @PostMapping("/users")
    @POST
    public User createUser(@RequestBody User user) {
        return userService.create(user);
    }
}
```

Enable timing:
```bash
$ jcmd <pid> JFR.start method-timing=@jakarta.ws.rs.GET,@jakarta.ws.rs.POST period=5s
$ jcmd <pid> JFR.dump filename=endpoints.jfr

$ jfr view method-timing endpoints.jfr

Timed Method                              Invocations  Average Time
----------------------------------------  -----------  ------------
UserController.getUsers()                        1250   12.5 ms
UserController.createUser()                       450  120.0 ms
OrderController.getOrder()                       3400    8.2 ms
```

`createUser()` is 10x slower than reads. Check database indexes, or maybe the validation logic is expensive.

### Example 4: Remote Monitoring

Monitor a production JVM over JMX without restarting:

```java
import javax.management.remote.*;
import jdk.management.jfr.*;

var url = "service:jmx:rmi:///jndi/rmi://prod-server:7091/jmxrmi";
var jmxURL = new JMXServiceURL(url);

try (var conn = JMXConnectorFactory.connect(jmxURL)) {
  try (var stream = new RemoteRecordingStream(conn.getMBeanServerConnection())) {
    
    var settings = Map.of(
        "jdk.MethodTrace#enabled", "true",
        "jdk.MethodTrace#filter", "com.example.PaymentService::charge",
        "jdk.MethodTrace#threshold", "500 ms"
    );
    
    stream.setSettings(settings);
    stream.onEvent("jdk.MethodTrace", event -> {
      System.out.printf("Slow charge: %s ms from %s%n",
          event.getDuration().toMillis(),
          event.getStackTrace());
    });
    
    stream.startAsync();
    Thread.sleep(300_000);  // Monitor for 5 minutes
    stream.stop();
  }
}
```

This instruments `PaymentService.charge()` on a running production JVM, captures only calls taking > 500ms, and streams results back to your monitoring application. When you stop the stream, instrumentation is removed automatically.

## Migration Considerations

### When to Use This Feature

**Good use cases:**
- Debugging resource leaks (trace constructor/close pairs)
- Analyzing startup performance (time static initializers)
- Monitoring rare code paths that sampling misses
- Verifying performance fixes (did my optimization actually work?)
- Tracking annotated methods for custom profiling

**Bad use cases:**
- Profiling hundreds of hot methods simultaneously
- Continuous production monitoring with tracing enabled (use sampling instead)
- Methods in tight loops (will generate event floods)
- General-purpose performance analysis (use sampling profilers first)

### Deployment Strategy

Start in development and QA environments. Validate that:
1. Filters match the intended methods
2. Overhead is acceptable
3. Event data provides actionable insights

For production, use conservatively:
- Enable timing for a few key methods
- Use high thresholds for tracing (e.g., only events > 100ms)
- Limit to specific troubleshooting windows
- Monitor JFR buffer usage to avoid dropping events

### Configuration Management

Store filters in reusable JFC files:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<configuration version="2.0" label="Database Monitoring">
  <event name="jdk.MethodTiming">
    <setting name="enabled">true</setting>
    <setting name="period">10 s</setting>
    <setting name="filter">
      com.example.db.ConnectionPool::acquire;
      com.example.db.ConnectionPool::release;
      @com.example.annotations.DatabaseOperation
    </setting>
  </event>
  
  <event name="jdk.MethodTrace">
    <setting name="enabled">true</setting>
    <setting name="threshold">100 ms</setting>
    <setting name="filter">
      com.example.api.PaymentController
    </setting>
  </event>
</configuration>
```

Load via:
```bash
$ java -XX:StartFlightRecording:settings=database-monitoring.jfc ...
```

Version control these configs alongside your application for reproducible troubleshooting.

### Compatibility

- **JDK Version**: Requires Java 25+
- **Platforms**: All platforms that support JFR (Linux, Windows, macOS)
- **Garbage Collectors**: Works with all GCs
- **Ahead-of-Time Compilation**: Compatible with GraalVM native-image (though JFR support in native images is limited)

No application code changes required. This is entirely JVM configuration.

## Conclusions

JFR method timing and tracing fills a gap that sampling profilers can't close: deterministic, complete visibility into specific methods. When you need to know exactly how many times a method ran, or capture stack traces for every invocation, this feature delivers.

The key trade-offs are clear. Sampling profilers give you broad coverage with minimal overhead—perfect for understanding overall application behavior. Method instrumentation gives you precision at the cost of performance. Use sampling to identify areas of interest, then instrument surgically to gather detailed evidence.

What makes this feature particularly valuable is its integration with the rest of JFR. You're not just getting timing and tracing data—you can correlate it with GC events, lock contention, I/O operations, and all the other metrics JFR collects. That holistic view often reveals root causes that isolated profiling tools would miss.

The annotation-based filtering deserves special mention. Being able to mark methods with `@Profile` or `@Critical` during development, then activate instrumentation in production without redeploying, is elegant. You're essentially building profiling hooks into your application that remain dormant until needed.

Expect this feature to be most useful during troubleshooting sessions rather than continuous monitoring. When you're chasing a bug or optimizing a specific code path, the ability to instrument precisely what you care about—without modifying code, without third-party agents—is powerful. JFR has always been about observability with minimal friction. JEP 520 extends that philosophy to method-level instrumentation.

## References

- [JEP 520: JFR Method Timing & Tracing](https://openjdk.org/jeps/520)
- [JDK Flight Recorder Documentation](https://dev.java/learn/jvm/jfr/)
- [Java Instrumentation API](https://docs.oracle.com/en/java/javase/25/docs/api/java.instrument/java/lang/instrument/Instrumentation.html)
- [OpenJDK Source: jfrMethodTracer.cpp](https://github.com/openjdk/jdk/blob/master/src/hotspot/share/jfr/support/methodtracer/jfrMethodTracer.cpp)
- [OpenJDK Source: Transform.java](https://github.com/openjdk/jdk/blob/master/src/jdk.jfr/share/classes/jdk/jfr/internal/tracing/Transform.java)
- [OpenJDK Source: PlatformTracer.java](https://github.com/openjdk/jdk/blob/master/src/jdk.jfr/share/classes/jdk/jfr/internal/tracing/PlatformTracer.java)
- [JFR RemoteRecordingStream API](https://docs.oracle.com/en/java/javase/25/docs/api/jdk.management.jfr/jdk/management/jfr/RemoteRecordingStream.html)

---

**Tags**: Java, JDK 25, JFR, Java Flight Recorder, Profiling, Method Timing, Performance Monitoring, Observability, Tracing, Production Profiling, Performance Analysis, Diagnostics, JVM Monitoring

<!-- WordPress Categories: Java, Performance, Profiling -->

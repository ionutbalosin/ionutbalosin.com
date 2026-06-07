# HotSpot JVM Performance Tuning Guidelines (OpenJDK 13)

## Content

- [Intro](#intro)
- [Memory](#memory)
  - [Heap](#heap)
  - [Off-Heap](#off-heap)
    - [Metaspace](#metaspace)
    - [CodeCache](#codecache)
    - [Direct Buffers](#direct-buffers)
- [ClassLoader](#classloader)
  - [Dynamic Class-Data Sharing](#dynamic-class-data-sharing)
- [Just-In-Time Compiler](#just-in-time-jit-compiler)
  - [Tiered Mode: C1+C2](#c1c2-compiler)
  - [Graal JIT](#graal-compiler)
- [Threads](#threads)
- [Garbage Collectors](#garbage-collectors-gc)
  - [Serial Garbage Collector](#serial-gc)
  - [Parallel Garbage Collector](#parallel-gc)
  - [Concurrent Mark Sweep Garbage Collector](#concurrent-mark-sweep-gc)
  - [G1 Garbage Collector](#g1-gc)
  - [Z Garbage Collector](#z-gc)
  - [Shenandoah Garbage Collector](#shenandoah-gc)
  - [Epsilon Garbage Collector](#epsilon-gc)
- [Container](#container)
- [References](#references)

## Intro

Tuning the HotSpot Java Virtual Machine (HotSpot JVM) to achieve optimal application performance is one of the most critical aspects, especially in the case of latency-sensitive applications. A poorly-tuned JVM can result in longer latencies, slower transactions, system freezes, system crashes, etc.

This article aims to cover the most useful HotSpot JVM options that could be used to properly tune the Virtual Machine. Since the reference JVM implementation is HotSpot, the current guidelines should be valid for a wide range of JVM distributions, HotSpot based, including Oracle OpenJDK, Oracle JDK, AdoptOpenJDK, Azul Zulu, Azul Zing (to some extent, since Zing is HotSpot OpenJDK based with some proprietary changes; e.g. C4 GC, Falcon Compiler), Red Hat OpenJDK, SAP Machine, Amazon Corretto, BellSoft Liberica, Alibaba Dragonwell, Pivotal Spring RT, etc.

The current VM options are based on **AdoptOpenJDK 64-Bit Server VM version 13 (build 13+33) for Linux x64**. Since from one release to another these options are continuously changing (some are added, others are marked as deprecated or even removed, etc.) you can use the command line “*$ java -XX:+UnlockDiagnosticVMOptions -XX:+UnlockExperimentalVMOptions -XX:+PrintFlagsFinal -version | grep <option>*” to check for another particular JVM distribution or version. There is also an online tool [VM Options Explorer](https://www.chriswhocodes.com/hotspot_option_differences.html) developed by [Chris Newland](https://twitter.com/chriswhocodes) very useful to check the flags.

Please note this guideline is not exclusive, there might be other handy flags not listed here, but in essence, I am trying to cover the most relevant ones, which anyway is biased to my knowledge and experience. Also, take into consideration inside the HotSpot JVM there are hundreds of options that we can choose from. For example, HotSpot JDK 13 comes with about 650 available product flags (for all component types, all Operating Systems, and all CPU types), hence understanding all of these is a big challenge, almost impossible. In reality, the majority of the developers are aware of only a small subset (the most common ones, in general corresponding to the Heap and Metaspace memory). In this context, from my point of view, a short guideline covering the most relevant tuning JVM flags might be very useful.

Before going into further details, it is important to have a high-level understanding of possible components that shape the HotSpot JVM architecture.

[![](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/hotspot-jvm-performance-tuning-guidelines/HotSpotArchitecture.png)](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/hotspot-jvm-performance-tuning-guidelines/HotSpotArchitecture.png)**Legend:**

- Java Heap contains all Java object instances. In the case of generational Collectors, it is further split into the Young Generation (Eden, Survivor 0 and Survivor 1) and the Tenured Generation.
- Metaspace (formerly PermGen) contains class metadata (e.g. method bytecodes, symbols, constant pools, annotations, etc.).
- CodeCache contains dynamically generated code (e.g. JIT C1/C2/Graal), Interpreter (i.e. Template Interpreter) and stubs.
- Thread Stacks refer to the interpreted, compiled and native stack frames.
- Direct Memory is used for direct-buffer allocations (e.g. NIO buffers).
- C-Heap is used, for example, by the JIT Compiler or by the GC to allocate memory for internal data structures.

Since Graal JIT is written in Java, all the structures it needs are allocated into Java Heap, as opposite to C1/C2  Compilers which require off-heap memory to allocate the IR graph and the internal Compiler structures (i.e. Compiler <<Arenas>>).

## Memory

### General tuning guidelines

```shell
-XX:+UseCompressedOops (default true)
```

It allows references to be 32-bit in a 64-bit JVM for heap sizes less than 32 GB, typically increasing the performance. For Java heap sizes bigger than 32 GB please also consider tuning the **-XX:ObjectAlignmentInBytes** (default 8 bytes). Nevertheless, increasing the object alignment will also increase the unused space between objects, hence there might not be any benefit from using compressed pointers on larger Java heap sizes.

**Note**: ZGC does not support Compressed OOPs.

```shell
-XX:+UseCompressedClassPointers (default true)
```

It enables 32-bit offset to represent the class pointer in a 64-bit JVM for Java heap sizes less than 32 GB, as does **-XX:+UseCompressedOops** for Java object references.

```shell
-XX:+UseLargePages (default false)
```

Enable the use of large page memory. The goal of the large page support is to optimize processor Translation-Lookaside Buffers (TLB) and hence increase performance.

Large pages might be suitable for intensive memory applications with large contiguous memory accesses.

Large pages might not be suitable for (i) short-lived applications with a small working set or for (ii) applications with a large but sparsely used heap.

**Note**: consider enabling large pages when the number of TLB misses and TLB Page walk take a significant amount of time (i.e. *dtlb\_load\_misses\_\** CPU counters).

```shell
-XX:+UseNUMA (default false)
```

Improve the performance of a JVM that runs on a machine with nonuniform memory architecture (NUMA), or multiple sockets, by enabling the NUMA aware Collector to allocate objects in memory node local to a processor, increasing the application’s use of lower latency memory.

Note: at the moment the NUMA aware Collectors are: Parallel GC, G1 GC, and ZGC.

```shell
LD_PRELOAD (default glibc’s malloc)
```

The main memory allocation interface is “malloc”. When a process typically requests very large chunks of native memory using “malloc”, under the hood it uses “mmap” system calls to find addressable memory space. Then, it manages these memory chunks according to its allocation algorithm that can lead to fragmentation.

Changing the default “malloc” allocator will overcome the possible native memory fragmentation issues (i.e. native memory leaks). Possible alternatives: {[jemalloc](http://jemalloc.net/); [tcmalloc](https://github.com/gperftools/gperftools); [mimalloc](https://github.com/microsoft/mimalloc)}.

**Note**: consider changing LD\_PRELOAD when the process resident set size (RSS) grows significantly (for example it becomes much bigger than **-Xmx** plus **-XX:MaxMetaspaceSize** plus **-XX:MaxDirectMemorySize**), eventually getting killed by the OOM killer.

### Heap

```
set -Xms equals to -Xmx
```

Setting the initial heap size equal to the max heap size avoids resizing hiccups.

```shell
-XX:+AlwaysPretouch
```

Trigger pre-zeroed memory-mapped pages at startup, during JVM initialization, to avoid commit hiccups.

### Off-Heap

The Off-Heap memory groups the JVM regions that live outside the Java Heap: Metaspace (class metadata), CodeCache (JIT-generated code, Interpreter and stubs) and Direct Buffers (NIO direct-buffer allocations).

#### Metaspace

```shell
-XX:MetaspaceSize (default 21,807,104)
```

Sets the size of the allocated class metadata space that will trigger a Garbage Collection the first time it is exceeded.

Consider a higher value to avoid early Garbage Collections induced for class metadata.

```shell
-XX:InitialBootClassLoaderMetaspaceSize (default 4,194,304)
```

Consider a higher value to increase the boot class loader Metaspace.

```shell
-XX:MaxMetaspaceExpansion (default 5,451,776)
```

Represents the maximum size to expand a Metaspace by without Full GC.

Consider a higher value for Metaspace to be expanded by without a need for a full GC.

```shell
-XX:MinMetaspaceFreeRatio (default 40)
```

Consider slightly increasing the default value to make Metaspaces growing more aggressively.

```shell
-XX:MaxMetaspaceFreeRatio (default 70)
```

Consider slightly increasing the default value to reduce the chances of Metaspaces shrinking.

#### CodeCache

It is rather unusual to change the default CodeCache values. If based on the profiling data it turns out that the CodeCache is not big enough to accommodate the JIT-compiled code, you might consider increasing the initial and reserved CodeCache size. Nevertheless, make sure the flushing policy and segmented CodeCache are enabled.

```shell
-XX:InitialCodeCacheSize (default 2,555,904)
```

The initial code cache size (in bytes).

```shell
-XX:ReservedCodeCacheSize (default 251,658,240)
```

The reserved code cache size (in bytes) – maximum code cache size.

```shell
-XX:+UseCodeCacheFlushing (default true)
```

Attempt to sweep the CodeCache before shutting off the Compiler. Please make sure this option is enabled.

```shell
-XX:+SegmentedCodeCache (default true)
```

Divide the CodeCache into distinct segments (e.g. non-method, profiled, and non-profiled code) to improve the code locality (i.e. better iTLB and iCache behavior), to decrease fragmentation of highly-optimized code and to better control JVM memory footprint. Please make sure this option is enabled.

##### Use with caution

```shell
-XX:-TieredCompilation
```

It disables the intermediate compilation tiers (Tier 1, Tier 2, and Tier 3) so that a method is either Interpreted or compiled at the maximum optimization level by C2 JIT (basically it uses only Tier 0, and Tier 4).

**Note**: disabling **TieredCompilation** will (i) minimize the number of Compiler threads, (ii) simplify the compilation policy (i.e. based on method invocation and backedge counters but without detailed profiled information), and (iii) reduce the amount of JIT-compiled code, hence minimizing CodeCache usage.

#### Direct Buffers

```shell
-XX:MaxDirectMemorySize (default 0)
```

The maximum total size (in bytes) for direct-buffer allocations, using the *java.nio.ByteBuffer.allocateDirect()* method. By default, the size is set to 0, meaning that the JVM chooses the size for NIO direct-buffer allocations automatically.

```shell
-Djdk.nio.maxCachedBufferSize
```

Under the hood, the HeapByteBuffer allocates a temporary direct-buffer (e.g. direct ByteBuffer) and copies data to it. The JDK caches one temporary buffer per thread, without any memory limits. As a result, if there are multiple I/O method calls with large heap ByteBuffers, from multiple threads, the process can use a huge amount of native memory. For a long-lived thread, this memory usage will only increase, never shrink. This looks similar to a native memory leak, causing long-lived applications to continue using more and more native memory until they eventually get killed. Consider limiting **maxCachedBufferSize** to avoid these kinds of problems.

## ClassLoader

```shell
-XX:ClassUnloadingWithConcurrentMark (default true)
```

Enable class unloading after completing a concurrent mark cycle.

### Dynamic Class-Data Sharing

The Class Data Sharing (CDS) feature helps reduce the startup time and memory footprint between multiple Java Virtual Machines (JVM). CDS works only for system classes loaded by the Bootstrap ClassLoader.

To further reduce the startup time and the footprint, Application Class-Data Sharing (AppCDS) is introduced that extends the CDS to include selected classes from the application classpath. AppCDS allows the built-in system class loader, built-in platform class loader, and custom class loaders to load the archived classes.

Dynamic CDS archive extends application class-data sharing (AppCDS) to allow dynamic archiving of classes when a Java application exits. It simplifies AppCDS usage by eliminating the trial runs to create a class list for each application.

```shell
-XX:ArchiveClassesAtExit=<dynamic_archive_file.jsa>
```

Dynamically creates the application shared archive when the application exits.

```shell
-XX:SharedArchiveFile=<dynamic_archive_file.jsa>
```

Specify the name of the dynamic archive file.

## Just-in-Time (JIT) Compiler

### General tuning guidelines

```
-Xbatch
```

Enabling this will switch from a background to a foreground compilation process across JIT threads which leads to a more deterministic JIT behavior. By default, the JVM compiles the method as a background task, running the method in Interpreter mode until the background compilation is finished.

### Not recommended / use with caution

```
-Xverify:none / -noverify
```

It disables bytecode verification, potentially leading to a faster JVM startup. Nevertheless, my recommendation is to never disable bytecode verification in production or for any system where security is a concern.

```shell
-XX:TieredStopAtLevel=1
```

It basically stops the compilation at C1. Nevertheless, it limits the optimizations of the JIT Compiler, since neither C2 JIT nor Graal JIT will be kicked in anymore.

### C1+C2 Compiler

HotSpot features a Java byte code Interpreter in addition to two different Just In Time (JIT) Compilers, the client (also known as C1) and the sever (also known as C2). HotSpot JVM defaults to interpreting Java byte code. It compiles (JIT compilation) methods that are executed for a predetermined number of times. JIT compliers are either client or server:

- client Compiler: it compiles methods quickly but emits machine code that is less optimized than the server compiler. This complier is used for quick startup. Also, in this compiler, the smaller memory footprint is more important than steady-state performance.
- server Compiler: the compiler often takes more time (and memory) to compile the same methods. However, it generates a better-optimized machine code than the code generated by the client compiler. It provides better runtime performance after the application reaches the steady-state.

Tiered Compilation starts with the Interpreter, it uses C1 JIT Compiler to generate a fast code of acceptable quality (i.e. rock-solid and proved optimizations) and C2 JIT for highly optimized code.

```shell
-XX:+TieredCompilation (default true)
```

This enables tiered compilation (e.g. Interpreter -> C1 JIT -> C2 JIT).

### Tuning options

Slightly tuning (i.e. increasing) of inlining parameters could make a difference. Theoretically, better inlining brings the benefit of enabling more inlining-based optimizations, however, too much inlining fills the CodeCache more quickly but also reduces the instruction cache hit rate, thus reducing the speed of instruction fetch, negatively impacting the performance. Pragmatic advice is to find that sweet spot for your particular application.

The most useful inlining parameters to be considered are described below (otherwise fixed during JVM lifetime):

```shell
-XX:InlineSmallCode (default 2,000)
```

Inline a previously compiled method only if its generated native code size is less than **InlineSmallCode**.

```shell
-XX:MaxInlineSize (default 35)
```

Maximum size of method bytecode which gets inlined if reaching **-XX:MinInliningThreshold**

```shell
-XX:MinInliningThreshold (default 250)
```

The minimum number of invocations for a method to be inlined.

```shell
-XX:MaxInlineLevel (default 9)
```

The maximum number of nested calls that gets inlined.

```shell
-XX:FreqInlineSize (default 325)
```

Maximum bytecode size of a frequently executed method to be inlined.

### Graal Compiler

Graal is a high-performance, optimizing, Just-In-Time compiler written in Java that integrates with HotSpot via JVMCI. It is supposed to be a replacement for C2 JIT Compiler targeting (i) flexible speculative optimizations, (ii) better inlining heuristics and (iii) partial escape analysis.

A normal compilation process still starts with the Interpreter, it uses C1 JIT Compiler to generate a fast code of acceptable quality (i.e. rock-solid and proved optimizations) and Graal JIT for highly optimized code.

Graal JIT might be suitable for applications that produce a lot of objects when there is a high degree of polymorphic calls and a myriad of tiny nested calls.

**Limitations**: at this moment JVMCI does not support selected Garbage Collectors: {CMS, Z; Shenandoah; Epsilon}

```shell
-XX:+UnlockExperimentalVMOptions -XX:+UseJVMCICompiler (experimental, default false)
```

To enable the Graal JIT Compiler (e.g. Interpreter -> C1 JIT -> Graal JIT).

## Threads

### Threads Stack

In most of cases the default thread stack sizes do not need to be tuned since the default values should be enough. However, some JVM options might improve the performance in the case of applications with a significant number of thrown exceptions.

```shell
-XX:+OmitStackTraceInFastThrow (default true)
```

For performance reasons, consider throwing pre-allocated exceptions that do not provide a stack trace.

```shell
-XX:+StackTraceInThrowable (default true)
```

For performance reasons, consider removing stack traces from thrown exceptions.

## Garbage Collectors (GC)

### General tuning guidelines

```shell
-XX:+ExplicitGCInvokesConcurrent (default false)
```

Avoid a lengthy pause in response to a System.gc() or Runtime.getRuntime().gc() by enabling concurrent GCs.

```shell
-XX:-UseGCOverheadLimit (default true)
```

If more than 98% of the total time is spent in Garbage Collection and less than 2% of the heap is recovered an OOME is thrown. It is designed to prevent applications from running for an extended period of time while making little or no progress because the heap is too small. If necessary, this feature might be disabled.

### Not recommended / use with caution

```shell
-XX:-DisableExplicitGC (default false)
```

Avoid disabling explicit GC. It might have the hidden side effect of not reclaiming the unused off-heap memory used by direct ByteBuffers. For example, in case of direct ByteBuffer allocations fails, under the hood, the JDK code explicitly calls System.gc() which suppose to reclaim the unused memory. Disabling the explicit GC will invalidate this mechanism.

There are also some applications that programmatically trigger System.gc() during some idle time intervals to clean up the memory, avoiding the GC overhead during normal processing. Disabling the explicit GC will also invalidate this trick.

Nevertheless, be very careful and avoid writing code that abuses of invoking System.gc(), since it might trigger additional GC cycles, impacting low latency applications.

### Serial GC

It collects Young and Tenured Generations using a single thread, in a Stop-the-World fashion. It was introduced in Java 1.3 and was the default Collector in versions [1.3; 6).

It might be suitable for applications that have a small data set (e.g. a few hundreds of MB), run on a single processor and there are no pause-time requirements.

```shell
-XX:+UseSerialGC (default false)
```

To enable Serial GC.

### Parallel GC

Known as Throughput Collector, it collects Young and Tenured Generations in parallel threads, in a Stop-the-World fashion. It was introduced in Java 1.4.2 and was the default Collector in Java versions [6; 9).

However, the Tenured Generation was not always collected using parallel threads. In older Java versions, until Java 7u4, the Tenured Generation was collected in a Stop-the-World and single-threaded fashion. Starting Java 7u4 ParallelOld GC was made the default GC and also the normal mode of operation for Parallel GC. This means, starting Java 7u4 Parallel GC and ParallelOld GC is the same Collector.

It might be suitable for applications where (i) peak performance is the first priority and (ii) there are no pause-time requirements or pauses of second(s) is acceptable.

```shell
-XX:+UseParallelGC / -XX:+UseParallelOldGC (default false)
```

To enable Parallel [Old] GC.

**Tuning guidelines**

A proper (manual) tuning of the Young Generation size (e.g. survivor spaces) and the Tenuring threshold will have the biggest impact on the throughput. It will help avoiding prematurely promoting objects into Old generation (hence reducing the likelihood of Full GCs, mostly an ergonomic issue).

```shell
-XX:NewRatio (default 2), -XX:NewSize (default 1,363,144), -XX:MaxNewSize (default 5,003,804,672), -XX:SurvivorRatio (default 8)
```

Consider tuning the Young Generation size (e.g. survivor spaces), if needed.

```shell
-XX:InitialTenuringThreshold (default 7), -XX:MaxTenuringThreshold (default 15)
```

Consider tuning the Tenuring threshold, if needed.

**Scenario**: for applications with an unknown steady behavior the **AdaptiveSizePolicy** might bring a big benefit, otherwise not really necessary.

```shell
-XX:+UseAdaptiveSizePolicy (default true) - tries to achieve three goals: (i) a maximum GC pause goal; (ii) application throughput goal; (iii) a minimum footprint
```

**-XX:MaxGCPauseMillis**=nnn (default 200) – attempt to keep GC-induced pauses shorter than nnn milliseconds

**-XX:GCTimeRatio**=nnn (default 12)  – attempt to not spent more than 1 / (1 + nnn) of the application execution time in the Collector

In addition to the above tuning options, please also consider:

```
+XX:+UseNUMA (default false)
```

To enable the NUMA aware Collector.

```shell
-XX:ParallelGCThreads
```

Sets the number of threads used for Parallel GC in the Young and Tenured generations. The default value depends on the number of CPUs available to the JVM.

Increasing the number of parallel threads used for GC might improve the throughput at the cost of monopolizing CPU threads (potentially impacting other apps running on the same host).

### Concurrent Mark Sweep GC

It is mostly a concurrent collector, it performs some expensive work concurrently to the application. It was introduced in Java 1.4.2, made deprecated in Java 9 (JEP 291) and is going to be removed in Java 14 (JEP 363).

It might be suitable for applications that prefer shorter Garbage Collection pauses and that can afford to share processor resources with the Garbage Collector while the application is running.

```shell
-XX:+UseConcMarkSweepGC (default false)
```

To enable CMS GC.

#### Tuning guidelines

In general CMS GC needs a proper (manual) tuning of the Young Generation size (e.g. survivor spaces) and the Tenuring threshold – same recommendation as in the case of Parallel Garbage Collector.

Besides this, consider also manually tuning the marking threshold (adaptive by default):

```shell
-XX:CMSInitiatingOccupancyFraction=n (default -1)
```

The concurrent Collection starts if the occupancy of the Tenured Generation exceeds this initiating occupancy.

```shell
-XX:+UseCMSInitiatingOccupancyOnly (default false)
```

To keep the same occupancy percentage based on that the concurrent Collection kicks in, otherwise, the GC heuristics will dynamically update it. To be used in tandem with **-XX:CMSInitiatingOccupancyFraction**.

**Additional tuning options:**

```shell
-XX:ConcGCThreads
```

Sets the number of threads used for concurrent GC. The default value depends on the number of CPUs available to the JVM.

Increasing the number of concurrent threads might reduce the CMS cycle duration at the cost of increasing the concurrent overhead.

```shell
-XX:+CMSParallelRemarkEnabled (default true)
```

Parallelize re-marking phase.

```shell
-XX:+ParallelRefProcEnabled (default true)
```

If remark pauses are high or increasing (i.e. ref-proc is the major contributor) it parallelizes the reference processing, reducing Young and Tenured GC times.

```shell
-XX:+ScavengeBeforeFullGC (default false)
```

Trigger a Young Generation GC prior to a full GC.

```shell
-XX:+CMSScavengeBeforeRemark (default false)
```

Trigger a Young Generation GC prior to CMS remark.

```shell
-XX:+CMSClassUnloadingEnabled (default true)
```

To allow class unloading after a concurrent cycle, instead of relying on Full GCs to reclaim the metadata memory.

### G1 GC

It is mostly a concurrent collector, it performs some expensive work concurrently to the application. G1 GC tries to maintain a balance between throughput and latency. It was introduced in Java 7 u4 and made default in Java versions [9; 13].

It might be suitable for applications that run on multiprocessor machines with a large amount of memory. It meets Garbage Collection pause-time goals with high probability while achieving high throughput.

```shell
-XX:+UseG1GC (default true)
```

To enable G1 GC.

#### Tuning for latency

```shell
-XX:-UseTransparentHugePages (default false)
```

Consider keeping Transparent Huge Pages (THP) disabled unless there is a proven benefit.

```
set -Xms equals to -Xmx
```

To minimize heap resizing work by disabling it.

```shell
-XX:+AlwaysPreTouch
```

Pre-touch and set to zero all virtual memory pages during VM startup time.

```shell
-XX:+UseNUMA (default false)
```

Consider enabling NUMA aware GC.

```shell
-XX:+ParallelRefProcEnabled (default true)
```

If the time taken to process reference objects is high or increasing (i.e. *ref-proc* and *ref-enq* is the major contributor) enable parallelization of these phases.

```shell
-XX:G1NewSizePercent (experimental, default 5)
```

If the Evacuate Collection Set phase (i.e. Object Copy sub-phase) during a Young GC takes too long, consider decreasing the **G1NewSizePercent** (i.e. the percentage of the heap to use as the minimum for the Young Generation size).

```shell
-XX:G1MaxNewSizePercent (experimental, default 60)
```

If the amount of objects surviving a Collection suddenly changes it might cause spikes in the GC pause time. Consider decreasing **G1MaxNewSizePercent** (i.e. the percentage of the heap size to use as the maximum for Young Generation size). This limits the maximum size of the Young Generation and so the number of objects that need to be processed during the pause.

```shell
-XX:G1HeapRegionSize=n (default 2,097,152)
```

Understand the **G1HeapRegionSize**, it directly affects the number of cross-region references and as well as the size of the remembered set. Handling the remembered sets for regions may be a significant part of Garbage Collection work, so this has a direct effect on the achievable maximum pause time. Larger regions tend to have fewer cross-region references, so the relative amount of work spent in processing them decreases, although, at the same time, larger regions may mean more live objects to evacuate per region, increasing the time for other phases.

#### A Mixed Collection takes too long?

```shell
-XX:G1MixedGCCountTarget (default 8)
```

If a Mixed Collection takes too long, consider spreading the Tenured Generation reclamation across more Garbage Collections by increasing **G1MixedGCCountTarget**.

```shell
-XX:G1MixedGCLiveThresholdPercent (experimental, default 85)
```

If a Mixed Collection takes too long, avoid collecting regions that take a proportionally large amount of time to collect by not putting them into the candidate collection set. In many cases, highly occupied regions take a lot of time to collect.

```shell
-XX:G1HeapWastePercent (default 5)
```

If a Mixed Collection takes too long, stop Tenured Generation space reclamation earlier so that G1 won’t collect as many highly occupied regions, by increasing the **G1HeapWastePercent**.

```shell
-XX:InitiatingHeapOccupancyPercent (default 45)
```

It starts the concurrent marking phase when the occupancy of the entire Java heap reaches this percentage. Also, consider tuning this threshold.

```shell
-XX:G1OldCSetRegionThresholdPercent (experimental, default 85)
```

The number of Tenured regions to be collected during a mixed Garbage Collection cycle. If a Mixed Collection takes too long, consider decreasing **G1OldCSetRegionThresholdPercent**.

#### Tuning for throughput

```
set -Xms equals to -Xmx
```

To minimize heap resizing work by disabling it.

```shell
-XX:+AlwaysPreTouch
```

Pre-touch and set to zero all virtual memory pages during VM startup time.

```shell
-XX:+UseLargePages
```

Enabling the use of large pages may also improve throughput. Refer to the OS documentation on how to set up large pages.

```shell
-XX:MaxGCPauseMillis=n (default 200)
```

Attempt to keep Garbage Collection induced pauses shorter than n milliseconds. The generation sizing heuristics will automatically adapt the size of the Young Generation, which directly determines the frequency of pauses. Hence, increasing the maximum pause time will potentially decrease the frequency of the pauses, improving the throughput.

```shell
-XX:G1NewSizePercent (experimental, default 5)
```

If **-XX:****MaxGCPauseMillis** does not have any expected behavior (i.e. increasing the throughput), consider increasing the minimum size of the Young Generation.

```shell
-XX:G1MaxNewSizePercent (experimental, default 60)
```

If the combined percentage of Eden regions and Survivor regions is close to **G1MaxNewSizePercent** (check the region summary output from Garbage Collector logs), consider increasing the **G1MaxNewSizePercent** value.

```shell
-XX:GCPauseIntervalMillis=n (default 201)
```

In addition to the **-XX:MaxGCPauseMillis** you can specify the length of the time period (i.e. time span) during which the pause can occur.

```shell
-XX:G1RSetUpdatingPauseTimePercent (default 10)
```

Try to decrease the amount of concurrent work, in particular, concurrent remembered set updates, which requires a lot of CPU resources. By decreasing **G1RSetUpdatingPauseTimePercent** it will move the work from the concurrent operation into the Garbage Collection pause, potentially increasing the throughput.

### Z GC

It is a scalable low latency garbage collector designed to meet the following goals: (i) pause times do not exceed 10ms; (ii) pause times do not increase with the heap or live-set size; (iii) handle heaps ranging from a few hundred megabytes to multi terabytes in size. Introduced in Java 11, still experimental.

It might be suitable for applications where response time is a high priority and/or heap sizes are ranging from relatively small to very large in size.

```shell
-XX:+UseZGC (experimental, default false)
```

To enable Z GC.

### Tuning options

```shell
-Xmx
```

Setting an appropriate max heap size is the most important tuning option for ZGC. Since ZGC is a concurrent Collector, a max heap size must be selected such that (i) the heap can accommodate the live-set of your application and (ii) there is enough headroom in the heap to allow allocations to be serviced while the GC is running. In general, the more memory you give to ZGC the better.

```shell
-XX:ConcGCThreads
```

The number of concurrent GC threads is automatically selected, nevertheless, depending on the characteristics of the application this might need to be adjusted.

**Note**: a higher **ConcGCThreads** value will steal more CPU-time from the application; a lower **ConcGCThreads** value will potentially let the application to allocate more garbage than the GC can concurrently reclaim.

```shell
-XX:+UseNUMA
```

ZGC has basic NUMA support, which means it will try it’s best to direct Java heap allocations to NUMA-local memory.

```shell
-XX:+UseLargePages
```

Use large pages will generally yield better performance (in terms of throughput, latency and start-up time) and comes with no real disadvantage.

```shell
-XX:+UseTransparentHugePages
```

An alternative to using explicit large pages (as described above) is to use transparent huge pages. The use of transparent huge pages is usually not recommended for latency-sensitive applications because it tends to cause unwanted latency spikes. However, it might be worth experimenting with to see if/how the workload is affected by it.

### Shenandoah GC

It has a similar target as ZGC: (i) pause times do not exceed 10ms; (ii) pause times do not increase with the heap or live-set size; (iii) handle heaps ranging from a few hundred megabytes to multi terabytes in size. Introduced in Java 12, still experimental.

```shell
-XX:+UseShenandoahGC (experimental, default false)
```

To enable Shenandoah GC.

### Tuning options

```
set -Xms equals to -Xmx
```

To minimize heap resizing work by disabling it.

```shell
-XX:+AlwaysPreTouch
```

Pre-touch and set to zero all virtual memory pages during VM startup time.

```shell
-XX:+UseNUMA
```

While Shenandoah does not support NUMA explicitly, it is a good idea to enable this to also enable NUMA interleaving ( **-XX:UseNUMAInterleaving** (default false)) on multi-socket hosts.

When coupled with **-XX:+AlwaysPreTouch**, it provides better performance than the default out-of-the-box configuration

```shell
-XX:+UseLargePages
```

Using large pages greatly improves performance on large heaps. This would enable **hugetlbfs** (Linux) or Windows (with appropriate privileges) support.

When coupled with **-XX:+AlwaysPreTouch**, then init/shutdown would be faster, because it will pre-touch with larger pages. It will also pay the defrag costs upfront, at startup.

```shell
-XX:+UseTransparentHugePages
```

Will enable the large pages transparently. It is recommended to set **/sys/kernel/mm/transparent\_hugepage/enabled** and **/sys/kernel/mm/transparent\_hugepage/defrag** to **“madvise”**.

When coupled with **-XX:+AlwaysPreTouch**, then init/shutdown would be faster, because it will pre-touch with larger pages. It will also pay the defrag costs upfront, at startup.

```shell
-XX:-UseBiasedLocking
```

For latency-oriented workloads, it makes sense to turn biased locking off. Nevertheless, this is a tradeoff between uncontended (biased) locking throughput, and the safepoints JVM does to enable and disable them as needed.

### Epsilon GC

A completely passive GC implementation with a bounded allocation limit and the lowest latency overhead possible, at the expense of memory footprint and memory throughput. It does not clean up any memory, hence once the Java heap is exhausted, no memory reclamation is possible, and therefore it fails and throws an OutOfMemoryError. Introduced in Java 11, still experimental.

It might be suitable for (i) performance testing, (ii) memory pressure testing, (iii) VM interface testing, (iv) extremely short-lived jobs, (v) last-drop latency improvements, (vi) last-drop throughput improvements.

```shell
-XX:+UseEpsilonGC (experimental, default false)
```

To enable Epsilon GC.

### Tuning options

```shell
-XX:+AlwaysPreTouch
```

Pre-touch and set to zero all virtual memory pages during VM startup time otherwise there will be allocations hiccups due to OS peculiarities: usually, OS does not actually wired up the memory when it is “reserved” or “committed” but when it is allocated. Since in Epsilon case the allocations always reach for new memory, it needs to be first wired up, hence adding delays.

## Container

```shell
-XX:+UseContainerSupport (default true)
```

Make sure container support is enabled. It allows the JVM to read cgroup limits like available CPUs and RAM.

```shell
-XX:+PreferContainerQuotaForCPUCount (default true)
```

If the flag **PreferContainerQuotaForCPUCount** is set to true, use the cpu\_quota instead of cpu\_shares for picking the number of cores, without exceeding the number of physical CPUs in the system. The JVM will use this count to make decisions such as how many compiler threads, GC threads, and sizing of the fork-join pool.

Otherwise, if the flag **PreferContainerQuotaForCPUCount** is false, use the minimum of cpu\_shares or cpu\_quotas, if set, without exceeding the number of physical CPUs in the system. If only one of cpu\_shares or cpu\_quotas is provided, then use the specified value limited by the number of physical processors in the system.

```shell
-XX:InitialRAMPercentage (default 1.5)
```

Consider increasing the number of minimum heap size as a percentage of the available container memory.

```shell
-XX:MaxRAMPercentage (default 25)
```

Consider increasing the number of maximum heap size as a percentage of available container memory.

## References

- [HotSpot Virtual Machine Garbage Collection Tuning Guide](https://docs.oracle.com/en/java/javase/13/gctuning)
- [OpenJDK Wiki – Shenandoah Garbage Collector](https://wiki.openjdk.java.net/display/shenandoah)
- [JEP 189 – Shenandoah: A Low-Pause-Time Garbage](https://openjdk.java.net/jeps/189)
- [OpenJDK Wiki – Z Garbage Collector](https://wiki.openjdk.java.net/display/zgc)
- [JEP 333 – ZGC: A Scalable Low-Latency Garbage Collector](https://openjdk.java.net/jeps/333)
- [JEP 318 – Epsilon: A No-Op Garbage Collector](https://openjdk.java.net/jeps/318)
- [OpenJDK Wiki – Server Compiler Inlining Messages](https://wiki.openjdk.java.net/display/HotSpot/Server+Compiler+Inlining+Messages)
- [Oracle Blogs – Never disable bytecode verification in a production system](https://blogs.oracle.com/buck/never-disable-bytecode-verification-in-a-production-system)
- [Using jemalloc to get to the bottom of a memory leak](https://technology.blog.gov.uk/2015/12/11/using-jemalloc-to-get-to-the-bottom-of-a-memory-leak)
- [OpenJDK Wiki – Print Assembly](https://wiki.openjdk.java.net/display/HotSpot/PrintAssembly)
- [VM Options Explorer](https://www.chriswhocodes.com/hotspot_option_differences.html)
- [The JVM in Docker 2018](http://www.batey.info/docker-jvm-k8s.html)
- [Memory footprint of a Java process by Andrei Pangin](https://drive.google.com/file/d/1xoa2xZz3sa4FWeMLTVthNL09AniVxHy_/view)

UPDATE: The initial post was slightly updated based on the feedback received from **Alex Blewitt** and **Aleksey Shipilëv** on [Twitter](https://twitter.com/ionutbalosin/status/1214479770005753857).

---

**Tags**: Java, JVM, HotSpot, Performance Tuning, Heap, Metaspace, Code Cache, Class Loading, JIT Compiler, Garbage Collection, Java Performance, Tuning Guidelines

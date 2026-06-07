# Application / Dynamic Class Data Sharing In HotSpot JVM (OpenJDK 17)

## Content

- [Intro](#intro)
- [Class Data Sharing (CDS)](#class-data-sharing)
  - [Archive footprint on disk](#cds-archive-footprint-on-disk)
- [Application Class Data Sharing (AppCDS)](#application-class-data-sharing)
  - [Shared base address](#app-cds-shared-base-address)
  - [Store interned strings](#app-cds-store-interned-strings)
- [Dynamic Class Data Sharing (Dynamic CDS)](#dynamic-class-data-sharing)
  - [Base-layer dependency](#dynamic-cds-base-layer-dependency)
  - [Create a dynamic CDS archive based on the AppCDS archive](#dynamic-cds-base-layer-app-cds)
  - [Chaining a dynamic CDS archive and an AppCDS archive in the same command line](#dynamic-cds-app-cds-chaining)
- [Restrictions and recommendations](#app-dynamic-cds-restrictions-recommendations)
- [Summary](#summary)

## Intro

The purpose of this article is to discuss in detail one feature that HotSpot JVM offers since JDK 1.5 to reduce the startup time but also the memory footprint if the same Class Data Sharing (CDS) archive is shared across multiple JVMs.

## Class Data Sharing (CDS)

The idea of CDS is to cache preprocessed class metadata on disk, in an archive, using a specific format so they can be loaded very quickly (in comparison to classes stored and loaded from a JAR file). CDS was introduced in Sun JDK 1.5 and it initially worked with only Java HotSpot Client VM and Serial Garbage Collector (GC). In JDK 9 it was extended to support C2 Just-inTime Compiler (JIT) and other collectors (e.g., Parallel, ParallelOld, and G1). As of JDK 17, it supports ZGC, G1 GC, Serial GC, Parallel GC, and Shenandoah GC.

The CDS archive contains only core library classes that are used by most of the applications. These classes (around 1400 in total, as of JDK 17) are loaded by the bootstrap class loader and they belong to packages: *java.lang.\**, *java.util.\**, *java.io.\**, *java.nio.\**, *jdk.internal.\**, *java.security.\**, *java.net.\**, etc. The CDS archive is also referred to as the **default CDS archive** or **static base CDS archive**.

Starting JDK 12 ([JEP 341](https://openjdk.java.net/jeps/341)), the CDS archive is created during JDK build time on 64-bit platforms by running `-Xshare:dump` and using G1 GC (the default GC). It uses a built-time generated default class list and it is located under different directories, depending on the platform.

Linux/macOS:

```
// default CDS archive
$JAVA_HOME/lib/server/classes.jsa

// class list
$JAVA_HOME/lib/classlist
```

Windows:

```
// default CDS archive
$JAVA_HOME\\bin\\server\\classes.jsa

// class list
$JAVA_HOME\\bin\\classlist
```

CDS archive is divided into 7 regions, as per the below diagram:

![](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/application-dynamic-class-data-sharing-in-hotspot-jvm/CDSStructure.svg)

**Details:**

- **rw** – read-write metadata (e.g., C++ vtables)
- **ro** – read-only metadata and read-only tables (e.g., SymbolTable, StringTable, SystemDictionary)
- **bm** – bitmap that marks locations of all pointers across different regions within the archive
- **oa0** – open archive heap space 0 (e.g., java basic types (e.g., Boolean, Char, Float, etc.), Klass\* objects (e.g., Instance\*Klass\*, TypeArrayKlass\*, ObjArrayKlass\*))
- **oa1** – open archive heap space 1 (maybe empty)
- **ca0** – closed archive heap space 0 (e.g., interned strings)
- **ca1** – closed archive heap space 1 (maybe empty)

For a deeper understanding (or just curiosity) I recommend looking into the [OpenJDK sources](https://github.com/openjdk/jdk/tree/master/src/hotspot/share/cds).

CDS is enabled by default in most JDK distributions unless `-Xshare:off` is specified. When the JVM starts, the archive is memory-mapped and shared among multiple JVM processes (using a shared file system). Nevertheless, at the moment only G1 GC with `Compressed{Opps,ClassPointers}` could map the archived heap regions at start-up. Launching the JVM with a different GC, SerialGC for example will end up disabling the shared Java heap objects. By default, this information is not printed out, so to get it you have to explicitly specify `-Xlog:cds` option while starting the application.

```bash
$ java -Xlog:cds -XX:+UseSerialGC -cp <app jar> MyApp

[info][cds] CDS heap data is being ignored. UseG1GC, UseCompressedOops and UseCompressedClassPointers are required.
```

### Archive footprint on disk

Classes stored in the CDS are a few times (e.g., 3 – 5x) larger than classes stored in JAR files or the JDK runtime image. For example, the default class list from JDK 17 contains 1399 classes and the archive takes around 13,372 KB (~ 13.05MB) in total.

```bash
$ cat $JAVA_HOME/lib/classlist | wc -l
1399

$ ls -l --block-size=1K $JAVA_HOME/lib/server/
-r--r--r-- 1 10668 10668 13372 Dec  7 22:48 classes.jsa
```

## Application Class Data Sharing (AppCDS)

Application Class Data Sharing (AppCDS) extends the CDS concept to built-in system class loader (i.e., application class loader) and custom class loaders. This was originally added as a commercial Oracle JDK feature but then it become part of the OpenJDK 10 ([JEP 310](https://openjdk.java.net/jeps/310)). The AppCDS is also referred to as the **static archive**.

AppCDS archive must be explicitly created and is a three-step procedure.

**Step 1:** create the AppCDS class list (e.g., `static-cds.lst`). There could be multiple trial runs to create this class list.

```bash
$ java -Xshare:off -XX:DumpLoadedClassList=static-cds.lst -cp <app jar> MyApp
```

If you open the class list you might notice it also includes the core library classes (that are part of the default CDS archive).

**Step 2:** create the AppCDS archive (e.g., `static-cds.jsa`) based on the previously created class list

```bash
$ java -Xshare:dump -XX:SharedClassListFile=static-cds.lst -XX:SharedArchiveFile=static-cds.jsa -cp <app jar> MyApp
```

**Step 3:** start the application and specify the name of the AppCDS archive as an argument

```bash
$ java -XX:SharedArchiveFile=static-cds.jsa -cp <app jar> MyApp
```

### Shared base address

By default, during dumping, the archive is mapped at the shared base address `0x800000000`. [Address Space Layout Randomization](https://en.wikipedia.org/wiki/Address_space_layout_randomization) (ASLR) might cause this to occasionally fail if the required address space is not available. To make the JVM resilient to this failure you can consider running it with `-Xshare:auto` option or (if this makes sense for your setup; e.g., during benchmark tests) to even disable ASLR.

Either way, during `-Xshare:dump`, the option`-XX:SharedBaseAddress=<new_address>` could be used to override the default shared base address or `-XX:SharedBaseAddress=0` to map at an OS selected address.

Adding`-Xlog:cds` option to the command from the previous **Step 2** (i.e., create the AppCDS archive) prints the archive regions and their base addresses:

```bash
$ java -Xlog:cds -Xshare:dump -XX:SharedClassListFile=static-cds.lst -XX:SharedArchiveFile=static-cds.jsa -cp <app jar> MyApp 

[info][cds] Dumping shared data to file: 
[info][cds]    static-cds.jsa
[info][cds] Shared file region (rw )  0:  8093376 bytes, addr 0x0000000800000000 file offset 0x00001000 crc 0x5b23ef23
[info][cds] Shared file region (ro )  1: 13016776 bytes, addr 0x00000008007b8000 file offset 0x007b9000 crc 0x12a5a9d7
[info][cds] Shared file region (bm )  2:   381440 bytes, addr 0x0000000000000000 file offset 0x01423000 crc 0x80f2eed3
[info][cds] Shared file region (ca0)  3:   925696 bytes, addr 0x00000007bfc00000 file offset 0x01481000 crc 0x0e32d31c
[info][cds] Shared file region (oa0)  5:   724992 bytes, addr 0x00000007bf800000 file offset 0x01563000 crc 0xc4b5b70d
```

### Store interned strings

If you are using AppCDS then you might also be interested to know about enhancing the archive with string data and symbol data ([JEP 250](https://openjdk.java.net/jeps/250)). This will potentially further decrease the application start-up time, especially in cases where the application uses a lot of strings. Nevertheless, the creation of the additional shared config file (containing the strings and symbols) is not straightforward, hence I will try to briefly explain it here.

The string data and symbol data could be generated using the `jcmd` tool attached to a running JVM process:

```bash
$ jcmd <PID> VM.stringtable -verbose
$ jcmd <PID> VM.symboltable -verbose
```

The output must then be merged to a single file (e.g., `static-cds-shared-strings.cfg`) with the overall structure as following:

```bash
VERSION: 1.0
@SECTION: String
$ jcmd <pid> VM.stringtable -verbose
@SECTION: Symbol
$ jcmd <pid> VM.symboltable -verbose
```

One sample is available (for testing purposes) inside [OpenJDK sources](https://github.com/openjdk/jdk/blob/master/test/hotspot/jtreg/runtime/cds/appcds/sharedStrings/SharedStringsBasic.txt) (if you want to see, for example, the overall structure). [Volker Simonis](https://twitter.com/volker_simonis) covers the same feature in detail during his presentation [Class data sharing in the HotSpot VM](https://www.youtube.com/watch?v=fqUG1rr-y78).

To create the AppCDS archive using the additional shared config file (including the strings and symbols data) you need to start the application with the below list of arguments:

```bash
$ java -Xshare:dump -XX:SharedClassListFile=static-cds.lst -XX:SharedArchiveConfigFile=static-cds-shared-strings.cfg -XX:SharedArchiveFile=static-cds.jsa -cp <app jar> MyApp
```

This is very similar to **Step 3** from above, but additionally `-XX:SharedArchiveConfigFile` is used.

## Dynamic Class Data Sharing (Dynamic CDS)

Dynamic CDS further extends AppCDS to dynamically allow archiving at the end of the Java process. This archive is also simply referred to as the **dynamic archive**. This feature is part of OpenJDK since version 13 ([JEP 350](https://openjdk.java.net/jeps/350))

Dynamic CDS simplifies the AppCDS archive creation by eliminating the need to create the class list (i.e., the initial AppCDS step), hence it is a two-step procedure.

**Step 1:** create the dynamic CDS archive

```bash
$ java -XX:ArchiveClassesAtExit=dynamic-cds.jsa -cp <app jar> MyApp
```

**Step 2:** start the application and specify the name of the dynamic CDS archive as an argument

```bash
$ java -XX:SharedArchiveFile=dynamic-cds.jsa -cp <app jar> MyApp
```

### Base-layer dependency

A dynamic CDS archive is (implicitly) created on top of the static base CDS archive (e.g., `classes.jsa`) as a **top-layer archive**, and it uses less disk space (since the core library classes are not part of it). Starting the application with `-Xlog:cds` option prints both archives:

```bash
$ java -Xlog:cds -XX:SharedArchiveFile=dynamic-cds.jsa -cp <app jar> MyApp

[info][cds] trying to map $JAVA_HOME/lib/server/classes.jsa
[info][cds] Opened archive $JAVA_HOME/lib/server/classes.jsa

[info][cds] trying to map dynamic-cds.jsa
[info][cds] Opened archive dynamic-cds.jsa
```

The layering dependency between the dynamic CDS archive and the static archive could be illustrated as follows:

![](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/java/application-dynamic-class-data-sharing-in-hotspot-jvm/TopBaseCDSLayers-1.svg)

In this dependency chain, the static archive could be the default CDS archive (i.e., `classes.jsa`) or a custom AppCDS archive (i.e., a static archive). AppCDS used as a base layer archive overrides the default CDS archive. The dynamic archive just provides additional classes that can be loaded on top of those from the AppCDS archive.

Having the AppCDS as a static archive in the base layer might be beneficial when you have the same set of libraries (e.g., framework libraries) common to all applications. Additionally, each application’s specifics are dumped in the dynamic archive, as a top layer archive.

### Create a dynamic CDS archive based on the AppCDS archive

To create the dynamic CDS archive on top of an AppCDS archive (as a non-default static CDS) you have to start the JVM with the below command:

```bash
$ java -XX:SharedArchiveFile=static-cds.jsa -XX:ArchiveClassesAtExit=dynamic-cds.jsa -cp <app jar> MyApp
```

This is very similar to **Step 2** from above, but additionally `-XX:SharedArchiveFile` option is used to specify the AppCDS archive.

### Chaining a dynamic CDS archive and an AppCDS archive in the same command line

There is also the option to chain both AppCDS and the dynamic CDS archives in the same command line:

```bash
$ java -XX:SharedArchiveFile=static-cds.jsa:dynamic-cds.jsa -cp <app jar> MyApp
```

**Note:** the separator on Windows is `\;` (backslash semicolon) instead of `:`(colon)

HotSpot does not support more than two archives.

Starting the application with `-Xlog:cds` option prints both archives:

```bash
$ java -Xlog:cds -XX:SharedArchiveFile=static-cds.jsa:dynamic-cds.jsa -cp <app jar> MyApp

[info][cds] trying to map static-cds.jsa
[info][cds] Opened archive static-cds.jsa.

[info][cds] trying to map dynamic-cds.jsa
[info][cds] Opened archive dynamic-cds.jsa.
```

## Create the App/Dynamic CDS archives with jcmd

So far we have seen, in the previous two sections, that to create either an AppCDS or a dynamic CDS archive the application start-up scripts needs to be enhanced (with additional JVM options) and the application needs to be restarted multiple times. In this section, I will present a simplified approach to creating either a static but also a dynamic archive using the `jcmd` tool.

**First**, start the application:

```bash
$ java -cp <app jar> MyApp
```

**Second**, use `jcmd` to dump the archives while the application is running:

```bash
$ jcmd <PID> VM.cds static_dump static-cds.jsa
$ jcmd <PID> VM.cds dynamic_dump dynamic-cds.jsa
```

**Note:** to be able to dump the dynamic archive, the JVM process corresponding to the `<PID>` needs an additional option`-XX:+RecordDynamicDumpInfo` to be specified while starting the application (in the first step).

## Restrictions and recommendations

Running the CDS archive with a different JDK version than it was created with does not work (i.e., upgrading the JDK version without regenerating the archive). This is addressed in JDK 18, 19 ([JDK-8272331](https://bugs.openjdk.java.net/browse/JDK-8272331), [JDK-8261455](https://bugs.openjdk.java.net/browse/JDK-8261455)). For example, the below archive was created with JDK 17 and launched with JDK 18.

```bash
$ java -Xlog:cds -XX:SharedArchiveFile=dynamic-cds.jsa -cp <app jar> MyApp

[info][cds] Opening shared archive: dynamic-cds.jsa
[info][cds] UseSharedSpaces: Cannot handle shared archive file version 11. Must be at least 12
[info][cds] Unable to use shared archive: invalid archive
```

CDS archive is not cross-platform reusable (e.g., Linux, Windows, macOS). For example, the below archive was created on Linux and launched on Windows (even though the same JDK version was used).

```bash
$ java -Xlog:cds -XX:SharedArchiveFile=dynamic-cds.jsa -cp <app jar> MyApp

[info][cds] trying to map dynamic-cds.jsa
[info][cds] Opened archive dynamic-cds.jsa.
[info][cds] _jvm_ident expected: OpenJDK 64-Bit Server VM (17.0.2+8-86) for windows-amd64 JRE (17.0.2+8-86), built on Dec 7 2021 21:49:10 by "mach5one" with MS VC++ 16.8 / 16.9 (VS2019)
[info][cds] actual: OpenJDK 64-Bit Server VM (17.0.2+8-86) for linux-amd64 JRE (17.0.2+8-86), built on Dec 7 2021 21:41:21 by "mach5one" with gcc 10.3.0
[info][cds] UseSharedSpaces: The shared archive file was created by a different version or build of HotSpot
[info][cds] UseSharedSpaces: Unable to map shared spaces
```

Running the CDS archive with a modified jar timestamp in the classpath or module path after the archive is generated does not work (i.e., the dynamic archive is disabled, just the base layer archive is used). This means that recompiling the classes and recreating the jars (even though the source Java classes are the same, the same artifact id, and group id) is not possible.

```bash
$ java -Xlog:cds -XX:SharedArchiveFile=dynamic-cds.jsa -cp <app jar> MyApp

[info][cds] trying to map /usr/lib/jvm/openjdk-17.0.2/lib/server/classes.jsa
[info][cds] Opened archive /usr/lib/jvm/openjdk-17.0.2/lib/server/classes.jsa.
[info][cds] trying to map dynamic-cds.jsa
[info][cds] Opened archive dynamic-cds.jsa.
[info][cds] Reserved archive_space_rs [0x0000000800000000 - 0x0000000804400000] (71303168) bytes
[info][cds] Reserved class_space_rs   [0x0000000804400000 - 0x0000000844400000] (1073741824) bytes
[info][cds] Mapped static  region #0 at base 0x0000000800000000 top 0x0000000800457000 (ReadWrite)
[info][cds] Mapped static  region #1 at base 0x0000000800457000 top 0x0000000800bde000 (ReadOnly)
[info][cds] Mapped dynamic region #0 at base 0x0000000800bde000 top 0x00000008021aa000 (ReadWrite)
[info][cds] Mapped dynamic region #1 at base 0x00000008021aa000 top 0x0000000804130000 (ReadOnly)
[info][cds] UseSharedSpaces: A jar file is not the one used while building the shared archive file: target/my-app-0.0.1-SNAPSHOT.jar
[info][cds] Unmapping region #0 at base 0x0000000800bde000 (ReadWrite)
[info][cds] Unmapping region #1 at base 0x00000008021aa000 (ReadOnly)
[warning][cds,dynamic] Unable to use shared archive. The top archive failed to load: dynamic-cds.jsa
```

CDS archive does not include pre JDK 5/6 classes ([JDK-8202556](https://bugs.openjdk.java.net/browse/JDK-8202556), [JDK-8230413](https://bugs.openjdk.java.net/browse/JDK-8230413)). For example, the below output is from generating a dynamic archive with `-Xlog:cds` option enabled.

```bash
$ java -Xlog:cds -XX:ArchiveClassesAtExit=dynamic-cds.jsa -cp <app jar> MyApp

[warning][cds] Pre JDK 6 class not supported by CDS: 49.0 jdk/internal/reflect/GeneratedConstructorAccessor30
[warning][cds] Pre JDK 6 class not supported by CDS: 49.0 org/springframework/cglib/core/internal/Function
[warning][cds] Pre JDK 6 class not supported by CDS: 49.0 net/bytebuddy/dynamic/scaffold/MethodRegistry$Compiled
[warning][cds] Pre JDK 6 class not supported by CDS: 46.0 antlr/collections/impl/ASTArray
```

CDS is disabled if any of the options `--upgrade-module-path`, `--patch-module`, or `--limit-modules` are specified.

```bash
$ java -Xlog:cds -XX:SharedArchiveFile=dynamic-cds.jsa --upgrade-module-path=target/modules -cp <app jar> MyApp

[0.000s][info][cds] optimized module handling: disabled due to incompatible property: jdk.module.upgrade.path=target/modules
```

The classpath used at archive creation time must be the same as (or a prefix of) the classpath used at run time. The module path does not follow the same restriction.

App/dynamic CDS does not include the jars referred to by other jars as `class-path` attributes.

Dynamic CDS archives should be created after a broader usage of the application (covering different business flows in the application) and not by just starting and immediately stopping the application (i.e., classes are lazily loaded).

The more recent JDK version to use the better. Latest JDK versions include noticeable CDS improvements or bug fixes, for example:

- JDK 15 – Try to link all classes during dynamic CDS dump (i.e., not linked) ([JDK-8232081](https://bugs.openjdk.java.net/browse/JDK-8232081))
- JDK 15 – Support Lambda proxy classes in dynamic CDS archive ([JDK-8198698](https://bugs.openjdk.java.net/browse/JDK-8198698))
- JDK 15 – ZGC (production-ready) supports CDS ([ZGC Main](https://wiki.openjdk.java.net/display/zgc/Main#Main-JDK15))
- JDK 16 – Support Lambda proxy classes in static CDS archive ([JDK-8247666](https://bugs.openjdk.java.net/browse/JDK-8247666))
- JDK 17 – Store old class files in static CDS archive ([JDK-8261090](https://bugs.openjdk.java.net/browse/JDK-8261090))

## Summary

In my opinion, AppCDS or dynamic CDS is a feature you should try out on your own. It is a mechanism that could bring benefits almost for free, you do not have to change the application code. How big are these improvements, I cannot tell you, it depends, as always, from case to case.

Similar topics (e.g., CDS, AppCDS, and dynamic CDS) I recently presented at a Java conference. You can download [the slides](https://github.com/ionutbalosin/ionutbalosin.com/blob/main/blog/java/application-dynamic-class-data-sharing-in-hotspot-jvm/Techniques-for-a-faster-JVM-start-up.pdf) and additionally there is a [short tutorial](https://github.com/ionutbalosin/faster-jvm-start-up-techniques/blob/main/app-dynamic-cds-hotspot/README.md) on GitHub (including some command-line options and an application I used).

---

**Tags**: Java, JVM, HotSpot, CDS, AppCDS, Dynamic CDS, Class Data Sharing, Startup Performance, jcmd, Performance, JVM Internals, Class Loading

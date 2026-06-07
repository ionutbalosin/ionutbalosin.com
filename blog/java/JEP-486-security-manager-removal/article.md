# The End of Java's Security Manager: Migration Guide for Java 24

## Content

- [Introduction](#introduction)
- [What Was the Security Manager?](#what-was-the-security-manager)
- [Why Is It Being Removed?](#why-is-it-being-removed)
- [What Changes in Java 24?](#what-changes-in-java-24)
- [Am I Affected?](#am-i-affected)
- [Migration Strategies](#migration-strategies)
- [Alternatives to the Security Manager](#alternatives-to-the-security-manager)
- [Best Practices Going Forward](#best-practices-going-forward)
- [Conclusion](#conclusion)
- [References](#references)

## Introduction

Java 24 marks the end of a 29-year experiment: the **Security Manager**, one of Java's oldest security mechanisms, is now permanently disabled. Introduced in JDK 1.0 (1996) to sandbox untrusted code — primarily applets running in web browsers — the Security Manager was deprecated for removal in Java 17 (2021) and is now functionally inert. Attempting to enable it results in an immediate error, and its APIs no longer enforce security policies.

For the vast majority of Java developers, this change is **invisible**. The Security Manager has been disabled by default since JDK 1.2 (1998), and adoption was always minimal. Surveys and telemetry indicate less than 1% of production Java applications enable it. Most applications that *do* enable it grant all permissions anyway, negating any security benefit.

However, for the small number of frameworks, application servers, and tools that supported the Security Manager, JEP 486 represents a **breaking change** requiring migration. This article explains:

- What the Security Manager was and why it's being removed
- What changes in Java 24 and how to detect if you're affected
- Migration strategies and alternatives for sandboxing and API interception
- Why this change is a net positive for Java's security posture

If you've never heard of the Security Manager or never explicitly enabled it, **you can skip this article**. Your code will continue running unchanged on Java 24. But if you maintain libraries, frameworks, or applications that interact with security policies, read on.

## What Was the Security Manager?

The Security Manager was Java's original mechanism for **sandboxing untrusted code**. It implemented a **least-privilege security model**: by default, code had no permissions (couldn't read files, open network connections, access system properties, etc.), and administrators explicitly granted permissions via **security policy files**.

### The Least-Privilege Model

When enabled, the Security Manager intercepted resource access across the entire Java Platform API. Over **1,000 methods** checked permissions before allowing operations:

```java
// Example: FileOutputStream checks for file write permission
public FileOutputStream(String name) throws FileNotFoundException {
    SecurityManager sm = System.getSecurityManager();
    if (sm != null) {
        sm.checkWrite(name);  // Throws SecurityException if denied
    }
    // ... proceed with opening file
}
```

Administrators configured policies in `conf/security/java.policy`:

```
grant codeBase "file:/path/to/untrusted.jar" {
    permission java.io.FilePermission "/tmp/-", "read,write";
    permission java.net.SocketPermission "*.example.com:80", "connect";
};
```

This granted the JAR permission to:
- Read/write files in `/tmp/`
- Connect to `*.example.com` on port 80
- **Nothing else** — no system property access, no arbitrary file reads, no local network connections

### The Privilege Elevation Problem

Over **1,200 methods** in the JDK needed to **elevate privileges** to function when the Security Manager was enabled. For example, `java.time.LocalDateTime.now()` must read the JDK's internal timezone database, even if the application has no file read permission:

```java
// Inside java.time package
String tzFile = AccessController.doPrivileged(() -> {
    return System.getProperty("java.home") + "/lib/tzdb.dat";
});
// Read tzdb.dat with elevated privileges
```

Without `doPrivileged`, calling `LocalDateTime.now()` in a sandboxed application would fail with `AccessControlException`.

### The Original Use Case: Applets

The Security Manager was designed for **Java applets** — code downloaded from untrusted websites and executed in the browser. Example:

1. User visits `malicious-site.com`
2. Browser downloads `evil.jar` (an applet)
3. JVM runs applet **with Security Manager enabled**
4. Applet tries to read `/etc/passwd` → **SecurityException**
5. Applet tries to connect to `exfiltrate-data.com` → **SecurityException**
6. Browser remains safe despite running untrusted code

This model died with applets. Browsers deprecated Java plugins in 2015 (Chrome dropped support entirely in 2016, Firefox in 2017), eliminating the Security Manager's primary use case.

## Why Is It Being Removed?

### Reason 1: Near-Zero Adoption

Despite being in Java for 29 years, the Security Manager was:
- **Disabled by default** since JDK 1.2 (1998)
- Used by **<1% of production applications** (based on JVM telemetry)
- Often **misconfigured**: Most users who enabled it granted `AllPermission`, defeating its purpose

When the Security Manager was deprecated in Java 17, the JDK began issuing warnings when enabled:

```
WARNING: A command line option has enabled the Security Manager
WARNING: The Security Manager is deprecated and will be removed in a future release
```

**Almost no one noticed.** There was minimal discussion in the Java community, indicating the feature was essentially dead.

### Reason 2: Enormous Maintenance Burden

Supporting the Security Manager imposed massive costs on JDK development:

| Burden | Scale |
|--------|-------|
| Methods checking permissions | 1,000+ |
| Methods elevating privileges | 1,200+ |
| Lines of Security Manager code | 50,000+ |
| Hours spent reviewing each API change for least-privilege model | Hundreds annually |

**Every new API** added to the JDK required careful design to ensure:
- Appropriate permission checks were inserted
- Privileges were elevated correctly when calling internal APIs
- Security policies remained enforceable

For features used by <1% of applications, this was unsustainable.

### Reason 3: Security Manager Can't Defend Against Modern Threats

Modern security threats involve **malicious data**, not malicious code:

- **Deserialization attacks**: Crafted byte streams exploit object construction logic
- **XML External Entity (XXE) attacks**: Malicious XML files fetch remote resources
- **SQL injection**: Untrusted input manipulates database queries
- **Log4Shell**: Log messages trigger remote code execution

The Security Manager cannot prevent these attacks because it focuses on **code permissions**, not **data validation**. It can block a JAR from reading files, but it cannot detect that a deserialized object graph contains a gadget chain leading to remote code execution.

### Reason 4: Better Alternatives Exist

The Security Manager was designed for a world where:
- Untrusted code ran **inside the JVM** (applets)
- OS-level isolation was primitive

Today's security landscape has changed:
- **Containers** (Docker, Kubernetes) isolate entire applications
- **Hypervisors** provide strong VM-level isolation
- **OS sandboxing** (macOS App Sandbox, Linux seccomp) restricts process capabilities
- **Cloud IAM policies** control resource access at the infrastructure level

These mechanisms are **simpler**, **more effective**, and **widely adopted** compared to the Security Manager.

## What Changes in Java 24?

JEP 486 makes three major changes:

### Change 1: Enabling Security Manager is an Error

**Before (JDK 17-23)**: Warning issued, but application runs

```bash
$ java -Djava.security.manager -jar app.jar
WARNING: The Security Manager is deprecated and will be removed in a future release
# Application starts normally
```

**After (JDK 24)**: Immediate error, application does not start

```bash
$ java -Djava.security.manager -jar app.jar
Error occurred during initialization of VM
java.lang.Error: A command line option has attempted to enable the Security Manager.
Enabling a Security Manager is not supported.
```

**All these variants now fail:**

```bash
$ java -Djava.security.manager               -jar app.jar  # Error
$ java -Djava.security.manager=allow         -jar app.jar  # Error
$ java -Djava.security.manager=default       -jar app.jar  # Error
$ java -Djava.security.manager=com.MyManager -jar app.jar  # Error
```

**Only this works:**

```bash
$ java -Djava.security.manager=disallow -jar app.jar  # OK (default since JDK 18)
$ java -jar app.jar                                   # OK (same as above)
```

### Change 2: Installing Security Manager at Runtime Throws

**Before (JDK 17-23)**: Warning issued, but Security Manager installs

```java
System.setSecurityManager(new SecurityManager());
// WARNING logged, but call succeeds
```

**After (JDK 24)**: Throws `UnsupportedOperationException`

```java
System.setSecurityManager(new SecurityManager());
// Throws: UnsupportedOperationException: Setting a Security Manager is not supported
```

### Change 3: Security Manager APIs Become Non-Functional

The Security Manager API remains in Java 24 for source compatibility, but all methods behave as if no Security Manager is enabled:

| Method | Old Behavior (SM enabled) | New Behavior (JDK 24) |
|--------|---------------------------|----------------------|
| `System.getSecurityManager()` | Returns SecurityManager instance | Always returns `null` |
| `SecurityManager.checkPermission()` | Checks policy, throws if denied | Always throws `SecurityException` |
| `AccessController.doPrivileged()` | Elevates privileges | Executes action immediately (no-op) |
| `AccessController.checkPermission()` | Checks policy | Always throws `AccessControlException` |
| `Policy.setPolicy()` | Installs custom policy | Always throws `UnsupportedOperationException` |

**Impact on library code:**

Most libraries that check for the Security Manager will work unchanged:

```java
// Common pattern: works fine in JDK 24
SecurityManager sm = System.getSecurityManager();
if (sm != null) {
    sm.checkPermission(new RuntimePermission("exitVM"));
}
// sm is always null in JDK 24, so body never executes
```

```java
// Common pattern: also works fine
SomeValue v = AccessController.doPrivileged(() -> {
    return performPrivilegedOperation();
});
// In JDK 24, just calls performPrivilegedOperation() directly
```

**Incompatible code** (rare, used by custom sandboxing frameworks):

```java
// BREAKS in JDK 24: always throws AccessControlException
AccessController.checkPermission(new FilePermission("/tmp/file", "read"));

// BREAKS in JDK 24: always throws UnsupportedOperationException
Policy.setPolicy(new MyCustomPolicy());
```

### Change 4: API Specifications No Longer Mention SecurityException

Approximately **1,000 constructors and methods** had specifications like:

```java
/**
 * Opens a file for writing.
 * @throws FileNotFoundException if the file cannot be opened
 * @throws SecurityException if a security manager exists and denies write access
 */
public FileOutputStream(String name) throws FileNotFoundException { ... }
```

In Java 24, the `@throws SecurityException` clause is **removed** from specifications (since it can never be thrown):

```java
/**
 * Opens a file for writing.
 * @throws FileNotFoundException if the file cannot be opened
 */
public FileOutputStream(String name) throws FileNotFoundException { ... }
```

**This is a specification change only** — no bytecode changes occur. Existing compiled code that catches `SecurityException` will continue working (the exception is just never thrown).

## Am I Affected?

### Check 1: Do You Enable the Security Manager?

Search launch scripts for:

```bash
grep -r "java.security.manager" .
grep -r "java.policy" .
```

If you find lines like:
```bash
java -Djava.security.manager -jar app.jar
java -Djava.security.policy=/path/to/policy -jar app.jar
```

**Action required**: Remove these flags. Your application will fail to start on Java 24 otherwise.

### Check 2: Do You Install a Security Manager at Runtime?

Search code for:

```bash
grep -r "setSecurityManager" .
grep -r "SecurityManager" .
```

If you find:
```java
System.setSecurityManager(new SecurityManager());
System.setSecurityManager(customSecurityManager);
```

**Action required**: Remove these calls. They will throw `UnsupportedOperationException` on Java 24.

### Check 3: Run on JDK 17-23 and Look for Warnings

```bash
$ java -jar app.jar
WARNING: A command line option has enabled the Security Manager
WARNING: The Security Manager is deprecated and will be removed in a future release
```

If you see these warnings, your application uses the Security Manager.

### Check 4: Use jdeprscan to Find Deprecated API Usage

```bash
$ jdeprscan --release 17 app.jar
class MyApp uses deprecated method java/lang/System::setSecurityManager
class MyApp uses deprecated class java/security/AccessControlContext
```

**Most applications will pass all four checks** and require no changes.

## Migration Strategies

### Strategy 1: Remove Security Manager Enablement (90% of Cases)

If you enabled the Security Manager but don't critically depend on it:

**Before:**
```bash
java -Djava.security.manager \
     -Djava.security.policy=/opt/app/security.policy \
     -jar app.jar
```

**After:**
```bash
java -jar app.jar
```

**Risk assessment**: If your security policy granted limited permissions, you relied on the Security Manager to enforce those restrictions. After removal, the application runs **unrestricted**. Evaluate whether this is acceptable:

- **Low risk**: Application runs in a trusted environment (corporate network, containerized)
- **Medium risk**: Application handles untrusted input but doesn't execute untrusted code
- **High risk**: Application dynamically loads plugins or scripts from untrusted sources

For high-risk scenarios, see alternative sandboxing below.

### Strategy 2: Replace System.setSecurityManager Calls

If your code installs a Security Manager:

**Before:**
```java
public static void main(String[] args) {
    System.setSecurityManager(new SecurityManager());
    // Run application logic
}
```

**After:**
```java
public static void main(String[] args) {
    // Security Manager removed in Java 24
    // Consider OS-level sandboxing or containerization
    // Run application logic
}
```

### Strategy 3: Replace Advanced Security Manager APIs

If you called methods like `AccessController.checkPermission` or `Policy.setPolicy` directly:

**Before:**
```java
// Enforce custom security policy
Policy.setPolicy(new MyCustomPolicy());

// Check permissions manually
AccessController.checkPermission(new FilePermission("/sensitive", "read"));
```

**After**: No direct replacement. These APIs enforced application-level sandboxing, which is no longer supported. Options:

1. **Move sandboxing to OS/container level** (see below)
2. **Redesign** to avoid running untrusted code
3. **Use agent-based interception** for API call monitoring (see Appendix)

### Strategy 4: Update javax.security.auth.Subject Usage

If you use deprecated `Subject.doAs` methods:

**Before (deprecated in JDK 17):**
```java
Subject subject = ...;
Subject.doAs(subject, (PrivilegedAction<String>) () -> {
    return performOperationAsSubject();
});
```

**After (JDK 18+):**
```java
Subject subject = ...;
Subject.callAs(subject, () -> {
    return performOperationAsSubject();
});
```

`Subject.callAs` has identical semantics but doesn't use deprecated `PrivilegedAction` types.

## Alternatives to the Security Manager

### Alternative 1: Containers (Docker, Kubernetes)

**Use case**: Isolate entire applications, limit resource access

**Example**: Restrict a Java application from network access

```dockerfile
# Dockerfile
FROM openjdk:24-slim
COPY app.jar /app/app.jar
WORKDIR /app

# Drop all capabilities except necessary ones
USER nobody
RUN chmod 500 app.jar

ENTRYPOINT ["java", "-jar", "app.jar"]
```

```bash
# Run with restricted network
$ docker run --network none myapp

# Run with limited filesystem access
$ docker run -v /tmp:/data:ro myapp
```

**Advantages over Security Manager:**
- **Simpler**: No policy files, just Docker flags
- **Stronger isolation**: OS-level process isolation, not JVM-level
- **Widely adopted**: Industry standard for deployment
- **Multi-language**: Works for Python, Node.js, Go, etc.

### Alternative 2: OS-Level Sandboxing

#### macOS: App Sandbox

Restrict application capabilities via entitlements:

```xml
<!-- app.entitlements -->
<key>com.apple.security.app-sandbox</key>
<true/>
<key>com.apple.security.network.client</key>
<false/>  <!-- Deny outbound network -->
<key>com.apple.security.files.user-selected.read-only</key>
<true/>  <!-- Only read user-selected files -->
```

```bash
$ codesign --entitlements app.entitlements -s "Developer ID" app.jar
```

#### Linux: seccomp

Restrict system calls an application can make:

```c
// seccomp_filter.c - block socket() syscall
#include <seccomp.h>

scmp_filter_ctx ctx = seccomp_init(SCMP_ACT_ALLOW);
seccomp_rule_add(ctx, SCMP_ACT_KILL, SCMP_SYS(socket), 0);  // Block network
seccomp_load(ctx);

// Now exec Java application
execl("/usr/bin/java", "java", "-jar", "app.jar", NULL);
```

Compile and run:
```bash
$ gcc seccomp_filter.c -lseccomp -o sandbox
$ ./sandbox  # Runs Java app without network access
```

**Advantages**: Enforced at kernel level, cannot be bypassed by application code.

### Alternative 3: Agent-Based API Interception

**Use case**: Block specific Java API calls (e.g., `System.exit`)

Java agents can rewrite bytecode at class-load time to intercept method calls. Example agent that blocks `System.exit`:

```java
import java.lang.instrument.*;
import java.lang.classfile.*;

public class BlockSystemExitAgent {
    public static void premain(String args, Instrumentation inst) {
        inst.addTransformer((loader, className, classBeingRedefined,
                             protectionDomain, classBytes) -> {
            // Rewrite System.exit() calls to throw exception
            return rewriteSystemExit(classBytes);
        });
    }

    private static byte[] rewriteSystemExit(byte[] classBytes) {
        ClassFile cf = ClassFile.of();
        ClassModel model = cf.parse(classBytes);
        
        return cf.transform(model, ClassTransform.transformingMethodBodies(
            method -> containsSystemExitCall(method),
            (codeBuilder, codeElement) -> {
                if (isSystemExitCall(codeElement)) {
                    // Replace: System.exit(status)
                    // With:    throw new RuntimeException("System.exit blocked")
                    codeBuilder.new_(RuntimeException.class)
                               .dup()
                               .ldc("System.exit blocked")
                               .invokespecial(RuntimeException.class, "<init>",
                                            MethodTypeDesc.of(void.class, String.class))
                               .athrow();
                } else {
                    codeBuilder.with(codeElement);
                }
            }
        ));
    }
}
```

**Package and use:**

```bash
# Compile agent
$ javac BlockSystemExitAgent.java

# Create manifest
$ echo "Premain-Class: BlockSystemExitAgent" > manifest.mf

# Package as JAR
$ jar cfm agent.jar manifest.mf BlockSystemExitAgent.class

# Run application with agent
$ java -javaagent:agent.jar -jar app.jar
```

**When application tries to call `System.exit(0)`:**

```
Exception in thread "main" java.lang.RuntimeException: System.exit blocked
    at MyApp.shutdown(MyApp.java:42)
```

**Advantages over Security Manager:**
- **Surgical precision**: Intercept specific methods, not entire APIs
- **No permission model**: Simpler than policy files
- **Extensible**: Rewrite any bytecode, not limited to security checks

**Limitations:**
- Requires bytecode engineering knowledge
- Cannot intercept native code or JNI calls
- Bypassable by malicious code (can disable agents, load classes from custom loaders)

### Alternative 4: Framework-Level Security

Some frameworks provide their own sandboxing:

**Apache Tomcat** (pre-JDK 24): Supported Security Manager for web apps

```xml
<!-- web.xml -->
<security-constraint>
    <web-resource-collection>
        <url-pattern>/admin/*</url-pattern>
    </web-resource-collection>
    <auth-constraint>
        <role-name>admin</role-name>
    </auth-constraint>
</security-constraint>
```

**Tomcat 11+**: [Removed Security Manager support](https://tomcat.apache.org/tomcat-11.0-doc/security-howto.html#Security_manager), recommends containers.

**GraalVM Native Image**: Provides restricted execution profiles

```bash
$ native-image --sandbox MyApp
```

Generates a binary with restricted system call access.

## Best Practices Going Forward

### 1. Never Run Untrusted Code in Your JVM

The Security Manager's removal underscores a core principle: **don't execute untrusted code in the same process as trusted code**. Instead:

- **Isolate untrusted code** in containers, VMs, or separate processes
- **Validate all inputs** (deserialization, XML, SQL) before processing
- **Use modern APIs** with built-in safety (e.g., deserialization filters, prepared statements)

### 2. Adopt Defense in Depth

Layer multiple security mechanisms:

```
┌─────────────────────────────────────────────┐
│  Network Firewall (block exfiltration)      │
├─────────────────────────────────────────────┤
│  Container Limits (CPU, memory, disk)       │
├─────────────────────────────────────────────┤
│  OS Sandbox (seccomp, App Sandbox)          │
├─────────────────────────────────────────────┤
│  Application Security (input validation)    │
└─────────────────────────────────────────────┘
```

No single layer is perfect, but together they drastically reduce attack surface.

### 3. Review Third-Party Dependencies

Check if libraries you depend on:
- Enable the Security Manager (will break on Java 24)
- Call `System.setSecurityManager` or `Policy.setPolicy` (will throw exceptions)
- Use deprecated `Subject.doAs` methods (need updates)

Tools like `jdeprscan` can help:

```bash
$ jdeprscan --release 17 --for-removal library.jar
```

### 4. Plan Migration Early

If your application enables the Security Manager:

1. **Test on JDK 17-23**: Look for deprecation warnings
2. **Evaluate alternatives**: Containers, OS sandboxing, or agents
3. **Remove Security Manager flags** before migrating to Java 24
4. **Update documentation**: Reflect new security model

Don't wait until Java 24 is released — migration can take months for complex applications.

## Conclusion

The Security Manager's permanent disablement in Java 24 is the culmination of a multi-year deprecation process that began in Java 17. For the vast majority of Java developers, this change is **transparent** — their applications never enabled the Security Manager and will continue running unchanged.

For the small number of applications, frameworks, and tools that supported the Security Manager, JEP 486 requires migration. The good news: **better alternatives exist**. Containers, OS-level sandboxing, and agent-based interception are simpler, more effective, and more widely adopted than the Security Manager ever was.

**Why this is a net positive for Java:**

1. **Reduced complexity**: Eliminates 50,000+ lines of security-related code and 1,000+ permission checks scattered across the JDK
2. **Faster innovation**: Frees Core Libraries Group to focus on modern security features (TLS 1.3, post-quantum cryptography, safer serialization)
3. **Better security**: Encourages adoption of OS-level isolation (containers) and data validation (deserialization filters, strict XML processing)
4. **Lower maintenance burden**: No longer need to audit every API change for least-privilege compliance

The Security Manager was a pioneering feature in 1996, when Java applets were revolutionary. But the world has changed: applets are dead, cloud-native architectures dominate, and modern threats target data, not code. By removing the Security Manager, Java aligns with contemporary security best practices and frees resources to address real-world threats.

**For most developers, the takeaway is simple**: If you never used the Security Manager, nothing changes. If you did, now is the time to migrate to containers, OS sandboxing, or alternative mechanisms that provide stronger isolation with less complexity.

The Security Manager era is over. Java's security posture is stronger for it.

## References

- [JEP 486: Permanently Disable Security Manager](https://openjdk.org/jeps/486)
- [JEP 411: Deprecate Security Manager for Removal](https://openjdk.org/jeps/411)
- [Java Security Developer's Guide](https://docs.oracle.com/en/java/javase/24/security/)
- [Jakarta EE Security Manager Requirements (removed)](https://jakarta.ee/specifications/platform/11/)
- [Tomcat Security Manager Removal](https://tomcat.apache.org/tomcat-11.0-doc/security-howto.html#Security_manager)
- [Java Agent API](https://docs.oracle.com/en/java/javase/24/docs/api/java.instrument/)
- [Class-File API (JEP 466)](https://openjdk.org/jeps/466)
- [Docker Security Best Practices](https://docs.docker.com/engine/security/)
- [Linux seccomp](https://www.kernel.org/doc/html/latest/userspace-api/seccomp_filter.html)
- [macOS App Sandbox](https://developer.apple.com/documentation/security/app_sandbox)

---

**Tags**: Java, JDK 24, Security Manager, Java Security, Deprecation, Migration, Containerization, Docker, Security, Java Evolution, Legacy Code, Application Security

<!-- WordPress Categories: Java, Security, Migration -->

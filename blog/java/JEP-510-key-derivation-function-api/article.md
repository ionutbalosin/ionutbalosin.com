# Key Derivation Function API: Foundation for Post-Quantum Cryptography in Java

## Content

- [Introduction](#introduction)
- [What Are Key Derivation Functions?](#what-are-key-derivation-functions)
- [The Missing API Problem](#the-missing-api-problem)
- [The Post-Quantum Imperative](#the-post-quantum-imperative)
- [API Design](#api-design)
- [HKDF: Extract and Expand](#hkdf-extract-and-expand)
- [Technical Implementation](#technical-implementation)
- [Practical Examples](#practical-examples)
- [Security Considerations](#security-considerations)
- [Migration and Adoption](#migration-and-adoption)
- [Conclusions](#conclusions)
- [References](#references)

## Introduction

Cryptographic key derivation is one of those operations that's absolutely critical but remained surprisingly ad-hoc in Java for decades. Need to derive multiple encryption keys from a shared secret? Roll your own solution using `Mac` and `SecretKeyFactory`. Want to implement modern protocols like TLS 1.3 or Hybrid Public Key Encryption? Write custom HKDF implementations that duplicate logic across libraries. Third-party security providers offering hardware-backed KDFs? No standard API to plug into.

JEP 510 fixes this with a proper Key Derivation Function (KDF) API in `javax.crypto`. It's not flashy—mostly interfaces and parameter specs—but it matters. The Java Platform finally has a standard way to derive cryptographic keys from input material, and that unlocks several things: clean HKDF implementations, PKCS#11 hardware support, and crucially, building blocks for post-quantum cryptography through Hybrid Public Key Encryption (HPKE).

The API is deliberately minimal. A `KDF` class with `getInstance()` methods, a `KDFSpi` provider interface, and `AlgorithmParameterSpec` subclasses for different KDF modes. The only bundled implementation is HKDF (HMAC-based Extract-and-Expand Key Derivation Function from RFC 5869), but the extensibility is the point. Third-party providers can now offer Argon2, PKCS#11-backed KDFs, or custom algorithms in a uniform way.

This isn't just about cleaning up technical debt. With quantum computers threatening classical cryptography, Java needs robust post-quantum primitives. KDF support is one piece of that puzzle—HPKE relies on it, and ML-KEM (the NIST-standardized post-quantum key encapsulation mechanism) will benefit from it. The timing is strategic: lay the foundation now so applications can transition smoothly when quantum-safe algorithms become mandatory.

## What Are Key Derivation Functions?

A KDF takes some input keying material (IKM)—maybe a shared secret from Diffie-Hellman, maybe a password—and stretches it into multiple cryptographically strong keys or raw bytes. The process isn't reversible: given a derived key, you can't recover the original IKM. This one-way property comes from using cryptographic hash functions or HMACs as the underlying primitives.

Why not just use the IKM directly as an encryption key? Several reasons:

1. **Length mismatch**: Your IKM might be 32 bytes but you need 48 bytes for AES-256 + HMAC-SHA256 keys.
2. **Key separation**: Deriving distinct keys for encryption, authentication, and integrity prevents key reuse vulnerabilities.
3. **Entropy extraction**: IKM from key exchange might not be uniformly random; KDFs extract concentrated entropy.
4. **Domain separation**: Adding context info (like protocol version or user ID) ensures keys derived in different contexts are uncorrelated.

The classic example: TLS derives multiple keys (client write key, server write key, client MAC key, server MAC key, IVs) from a single master secret. Without a KDF, you'd either reuse keys (bad) or need a separate key exchange for each purpose (inefficient).

KDFs come in two flavors:

**Password-based KDFs** (PBKDF2, bcrypt, scrypt, Argon2) are designed to be slow—intentionally computationally expensive to resist brute-force attacks. They take a password and salt, iterate thousands of times, and output a key. Java has PBKDF2 via `SecretKeyFactory` since ages ago, but modern alternatives like Argon2 had no standard API.

**General-purpose KDFs** (HKDF, SHAKE, ANSI X9.63) are designed for key material that's already high-entropy (not passwords). They're fast and deterministic: same inputs always produce the same outputs, which is essential when two parties need to independently derive identical keys.

JEP 510 targets general-purpose KDFs. The API could support password KDFs in the future (Argon2 is explicitly mentioned as planned work), but the immediate goal is algorithms like HKDF for protocol-level cryptography.

## The Missing API Problem

Before JEP 510, Java had no dedicated KDF API. Developers improvised using existing primitives:

**Option 1: Abuse `KeyGenerator`**. It's designed to generate random keys, not derive deterministic ones. You'd need to pass a fixed `SecureRandom` seeded with your IKM, which is awkward and defeats the purpose of `SecureRandom`'s entropy mixing.

**Option 2: Abuse `SecretKeyFactory`**. Java shoehorned PBKDF2 into this API, but it's a poor fit for general KDFs. `SecretKeyFactory` is conceptually about transforming one key representation into another, not deriving multiple keys from input material.

**Option 3: Roll your own**. Most implementations did this—directly call `Mac.getInstance("HmacSHA256")`, implement RFC 5869's extract-expand logic, hope you didn't introduce timing vulnerabilities. Every TLS library, every JOSE implementation, every protocol stack had its own HKDF copy-paste.

The consequences:

- **Code duplication**: Ten different HKDF implementations across the JDK alone (TLS, DHKEM, internal crypto utilities).
- **No hardware support**: PKCS#11 hardware devices offer KDF acceleration, but Java had no API to expose it. Vendors couldn't integrate without custom extensions.
- **Testing gaps**: RFC 5869 provides test vectors, but ad-hoc implementations might skip validation. A standard API means standard test suites.
- **Protocol fragmentation**: Higher-level protocols (TLS 1.3, HPKE, JOSE) couldn't share infrastructure. Each reimplemented primitives.

The JEP explicitly calls out the PKCS#11 angle. The standard describes KDF support for hardware security modules, but Java's `SunPKCS11` provider had no way to expose it. With JEP 510, there's now a `P11HKDF` implementation that delegates to the token, enabling hardware-accelerated key derivation.

## The Post-Quantum Imperative

Why now? The answer is quantum computing. Classical public-key algorithms (RSA, ECDH) rely on mathematical problems (factoring, discrete logarithms) that quantum computers can solve efficiently using Shor's algorithm. Once large-scale quantum computers exist, most current cryptography breaks.

NIST ran a post-quantum cryptography competition and standardized three algorithms in 2024:
- **ML-KEM** (Module-Lattice-Based Key Encapsulation Mechanism, formerly CRYSTALS-Kyber)
- **ML-DSA** (Module-Lattice-Based Digital Signature Algorithm, formerly CRYSTALS-Dilithium)  
- **SLH-DSA** (Stateless Hash-Based Digital Signature Algorithm, formerly SPHINCS+)

Java's strategy is pragmatic: support **hybrid schemes** that combine classical and post-quantum algorithms. If the post-quantum part turns out to have a flaw, the classical part still provides security against non-quantum attackers. If quantum computers arrive faster than expected, the post-quantum part protects you.

**HPKE (Hybrid Public Key Encryption, RFC 9180)** is the mechanism for smooth transition. It encapsulates keys using either classical KEMs (DHKEM), post-quantum KEMs (ML-KEM), or a combination. KDFs are integral—HPKE uses them in three places:

1. **Extract**: Derive a shared secret from the KEM output.
2. **Expand**: Generate encryption and authentication keys from the shared secret.
3. **Export**: Create additional keys for application-specific purposes.

JEP 452 (KEM API) arrived in JDK 21. JEP 510 (KDF API) is the next building block. Together, they enable Java to implement HPKE natively, which is currently being developed ([PR #18411](https://github.com/openjdk/jdk/pull/18411)).

The stakes are high. Government agencies (NSA, BSI) are mandating post-quantum readiness timelines. NIST wants migration complete by 2035. Java's ecosystem needs the primitives in place before applications can transition.

## API Design

The design follows Java's standard crypto provider pattern: abstract service class, SPI for implementations, pluggable providers.

### The KDF Class

Entry point for applications:

```java
public final class KDF {
    public static KDF getInstance(String algorithm) 
        throws NoSuchAlgorithmException;
    
    public static KDF getInstance(String algorithm, Provider provider)
        throws NoSuchAlgorithmException;
    
    public SecretKey deriveKey(String alg, AlgorithmParameterSpec spec)
        throws InvalidAlgorithmParameterException, NoSuchAlgorithmException;
    
    public byte[] deriveData(AlgorithmParameterSpec spec)
        throws InvalidAlgorithmParameterException;
    
    public String getAlgorithm();
    public String getProviderName();
    public KDFParameters getParameters();
}
```

Two derivation methods:

- **`deriveKey(String alg, ...)`**: Returns a `SecretKey` object. Use this when you're deriving keys for `Cipher`, `Mac`, or other JCE APIs. The `alg` parameter specifies the key algorithm (e.g., `"AES"`, `"HmacSHA256"`).
  
- **`deriveData(...)`**: Returns raw bytes. Use this for entropy or when you need the material in byte array form (e.g., deriving IVs, deriving multiple keys that you'll split manually).

The `AlgorithmParameterSpec` abstraction is key (pun intended). Different KDF algorithms have wildly different parameters:
- HKDF needs IKM, salt, info, output length
- Argon2 needs password, salt, iterations, memory cost, parallelism
- SHAKE needs input, output length

By accepting `AlgorithmParameterSpec`, the API accommodates this diversity without hardcoding parameter structures.

### Delayed Provider Selection

One subtle design choice: **delayed provider selection**. When you call `KDF.getInstance("HKDF-SHA256")` without specifying a provider, the KDF object doesn't immediately pick an implementation. It delays selection until you call `deriveKey()` or `deriveData()`.

Why? Key material might reside on hardware (PKCS#11 token). The first provider supporting the algorithm might not support that hardware. By delaying, Java can traverse the provider list and select one that works with your specific key material.

Example: You call `getInstance("HKDF-SHA256")`. Java sees:
1. SunJCE (software HKDF)
2. SunPKCS11 (hardware HKDF)

If you then pass a `SecretKey` from the PKCS#11 token, the delayed selection picks provider #2. If you'd picked SunJCE upfront, the derivation would fail because SunJCE can't extract keys from the hardware.

Trade-off: You can't reliably call `getProviderName()` before derivation—it might give you a provider that won't work with your keys. The javadoc explicitly warns about this.

### The KDFSpi Interface

Providers implement this:

```java
public abstract class KDFSpi {
    protected KDFSpi(KDFParameters kdfParameters)
        throws InvalidAlgorithmParameterException;
    
    protected abstract KDFParameters engineGetParameters();
    
    protected abstract SecretKey engineDeriveKey(
        String alg, AlgorithmParameterSpec derivationSpec)
        throws InvalidAlgorithmParameterException, NoSuchAlgorithmException;
    
    protected abstract byte[] engineDeriveData(
        AlgorithmParameterSpec derivationSpec)
        throws InvalidAlgorithmParameterException;
}
```

The constructor takes optional `KDFParameters` for algorithms that need global initialization (e.g., configuring iteration counts). HKDF doesn't need this—it's parameterless at the algorithm level—so implementations throw if you pass non-null.

## HKDF: Extract and Expand

HKDF (RFC 5869) is the star of the show. It's a two-phase KDF:

**Phase 1: Extract** - Concentrate entropy from potentially uneven input material.

```
PRK = HMAC-Hash(salt, IKM)
```

Input keying material (IKM) goes through HMAC keyed with a salt. Output is a pseudorandom key (PRK) of fixed length (hash output size). The salt should be random, but even a fixed salt is better than none—it ensures domain separation.

**Phase 2: Expand** - Stretch the PRK into arbitrary-length output.

```
T(0) = empty string
T(1) = HMAC-Hash(PRK, T(0) | info | 0x01)
T(2) = HMAC-Hash(PRK, T(1) | info | 0x02)
...
T(N) = HMAC-Hash(PRK, T(N-1) | info | N)
OKM = first L bytes of T(1) | T(2) | ... | T(N)
```

Each iteration feeds the previous output back into HMAC along with optional `info` (context string) and a counter. Limit: output length ≤ 255 × hash length (e.g., 8160 bytes for SHA-256).

The `info` parameter is criminally underused. It's for domain separation—include protocol version, user ID, session ID, anything that makes this derivation unique. Different `info` values produce uncorrelated keys even from the same IKM. TLS 1.3 uses this heavily to derive distinct keys for handshake vs. application traffic.

HKDF supports three modes:

1. **Extract-only**: Just get the PRK. Useful if you're doing custom expansion or passing the PRK to another protocol.
2. **Expand-only**: You already have a PRK (maybe from a previous extract or from a KEM), just expand it.
3. **Extract-then-Expand**: The full two-phase operation. Most common.

### HKDFParameterSpec

The API provides nested classes for each mode:

```java
// Extract-only
HKDFParameterSpec.Builder builder = HKDFParameterSpec.ofExtract();
builder.addIKM(ikmBytes).addSalt(saltBytes);
AlgorithmParameterSpec extractSpec = builder.extractOnly();

// Expand-only  
AlgorithmParameterSpec expandSpec = HKDFParameterSpec.expandOnly(prk, info, 32);

// Extract-then-Expand
AlgorithmParameterSpec fullSpec = HKDFParameterSpec.ofExtract()
    .addIKM(ikm)
    .addSalt(salt)
    .thenExpand(info, 32);
```

The builder pattern for Extract mode is clever: it lets you add IKM and salt in chunks. Why? Hardware security modules. If part of your IKM is on a smart card and part is in software, you can't easily concatenate them—one piece isn't extractable. The builder accepts multiple `SecretKey` objects, and the implementation concatenates them internally (or, for PKCS#11, tells the hardware to do it).

Empty salts are fine—HKDF spec says to use a zero-filled salt of hash length. Empty IKM is technically allowed but probably a mistake (you're deriving from nothing).

## Technical Implementation

Let's dissect the `HKDFKeyDerivation` class from the JDK.

### Extract Implementation

```java
private byte[] hkdfExtract(byte[] inputKeyMaterial, byte[] salt)
        throws InvalidKeyException, NoSuchAlgorithmException {
    
    if (salt.length == 0) {
        salt = new byte[hmacLen];  // Zero-filled salt
    }
    Mac hmacObj = Mac.getInstance(hmacAlgName);  // e.g., "HmacSHA256"
    hmacObj.init(new SecretKeySpec(salt, hmacAlgName));
    
    return hmacObj.doFinal(inputKeyMaterial);
}
```

Straightforward: HMAC the IKM using the salt as the key. The PRK is exactly `hmacLen` bytes (32 for SHA-256, 48 for SHA-384, 64 for SHA-512).

### Expand Implementation

```java
private byte[] hkdfExpand(byte[] prk, byte[] info, int outLen)
        throws InvalidKeyException, NoSuchAlgorithmException {
    
    if (prk.length < hmacLen) {
        throw new InvalidKeyException("prk must be at least " + hmacLen + " bytes");
    }
    
    SecretKeySpec pseudoRandomKey = new SecretKeySpec(prk, hmacAlgName);
    Mac hmacObj = Mac.getInstance(hmacAlgName);
    hmacObj.init(pseudoRandomKey);
    
    int rounds = (outLen + hmacLen - 1) / hmacLen;
    byte[] kdfOutput = new byte[outLen];
    int offset = 0;
    
    for (int i = 0; i < rounds; i++) {
        if (i > 0) {
            hmacObj.update(kdfOutput, offset - hmacLen, hmacLen);  // T(i-1)
        }
        hmacObj.update(info);                     // Add info
        hmacObj.update((byte) (i + 1));           // Add counter (1-indexed)
        
        if (i == rounds - 1 && (outLen - offset < hmacLen)) {
            // Last chunk might be partial
            byte[] tmp = hmacObj.doFinal();
            System.arraycopy(tmp, 0, kdfOutput, offset, outLen - offset);
            Arrays.fill(tmp, (byte) 0);
        } else {
            hmacObj.doFinal(kdfOutput, offset);
            offset += hmacLen;
        }
    }
    
    return kdfOutput;
}
```

Key points:

- **Rounds calculation**: Ceiling division `(outLen + hmacLen - 1) / hmacLen`. If you want 48 bytes from SHA-256 (32-byte output), you need 2 rounds.
  
- **Chaining**: Each iteration includes the previous HMAC output (`T(i-1)`), except the first iteration which has no predecessor.

- **Counter**: 1-indexed, as per RFC 5869. This is subtle—most programmers would use 0-indexed. The spec chose 1-indexed to avoid ambiguity with "no counter."

- **Partial final block**: If the requested length isn't a multiple of hash length, the last block is truncated. Example: 50 bytes from SHA-256 requires 2 rounds (64 bytes), but you only copy the first 50.

- **Zeroing temporary buffers**: The `tmp` array is zeroed after use. The PRK `SecretKeySpec` is also cleared via `SharedSecrets` (internal API for wiping key material).

### Key Material Consolidation

The `consolidateKeyMaterial()` method handles the multi-chunk IKM/salt scenario:

```java
private byte[] consolidateKeyMaterial(List<SecretKey> keys)
        throws InvalidKeyException {
    if (keys == null || keys.isEmpty()) {
        return new byte[0];
    }
    if (keys.size() == 1) {
        return CipherCore.getKeyBytes(keys.get(0));
    }
    
    ByteArrayOutputStream os = new ByteArrayOutputStream();
    for (SecretKey key : keys) {
        os.writeBytes(CipherCore.getKeyBytes(key));
    }
    return os.toByteArray();
}
```

`CipherCore.getKeyBytes()` extracts the raw bytes from a `SecretKey`. If the key is a `SecretKeySpec`, it's trivial. If it's a PKCS#11 key, this might fail if the key is marked non-extractable—that's handled upstream by the hardware-specific code path in `P11HKDF`.

### PKCS#11 Integration

The `P11HKDF` class is more complex because it interacts with native tokens:

```java
// In P11HKDF.engineDeriveData():
long baseKeyID = p11BaseKey.getKeyID();  // Key handle on the hardware token

long mechanism = isData ? CKM_HKDF_DATA : CKM_HKDF_DERIVE;

CK_ATTRIBUTE[] attrs = new CK_ATTRIBUTE[] {
    new CK_ATTRIBUTE(CKA_CLASS, derivedKeyClass),
    new CK_ATTRIBUTE(CKA_KEY_TYPE, ki.keyType),
    new CK_ATTRIBUTE(CKA_VALUE_LEN, outLen)
};

// Invoke PKCS#11 C_DeriveKey()
token.p11.C_DeriveKey(session.id(), mechanism, baseKeyID, attrs);
```

The derivation happens entirely on the hardware. The JDK never sees the PRK or derived key bytes—they stay in the secure token's memory. This is essential for high-security environments where key material must never touch software.

## Practical Examples

### Example 1: Deriving Encryption and MAC Keys

You have a shared secret from Diffie-Hellman. Derive separate keys for AES-GCM encryption and HMAC-SHA256 authentication:

```java
// Shared secret from key agreement
SecretKey sharedSecret = keyAgreement.doPhase(peerPublicKey, true);

// Context info for domain separation
byte[] info = "MyProtocol v1.0 | session-12345".getBytes(UTF_8);

// Derive 32 bytes for AES-256 + 32 bytes for HMAC = 64 bytes total
KDF kdf = KDF.getInstance("HKDF-SHA256");
byte[] derivedMaterial = kdf.deriveData(
    HKDFParameterSpec.ofExtract()
        .addIKM(sharedSecret)
        .addSalt(randomSalt())
        .thenExpand(info, 64)
);

// Split into two keys
SecretKey aesKey = new SecretKeySpec(derivedMaterial, 0, 32, "AES");
SecretKey hmacKey = new SecretKeySpec(derivedMaterial, 32, 32, "HmacSHA256");

// Zero the intermediate buffer
Arrays.fill(derivedMaterial, (byte) 0);
```

Why not just call `deriveKey()` twice? Because you'd get the same key material both times (KDFs are deterministic). You need to either (a) derive enough bytes once and split, or (b) use different `info` contexts for each derivation.

Better approach with distinct contexts:

```java
SecretKey aesKey = kdf.deriveKey("AES", 
    HKDFParameterSpec.ofExtract()
        .addIKM(sharedSecret)
        .addSalt(salt)
        .thenExpand("MyProtocol v1.0 | AES-key".getBytes(), 32)
);

SecretKey hmacKey = kdf.deriveKey("HmacSHA256",
    HKDFParameterSpec.ofExtract()
        .addIKM(sharedSecret)
        .addSalt(salt)
        .thenExpand("MyProtocol v1.0 | HMAC-key".getBytes(), 32)
);
```

Now the two keys are cryptographically independent even though they share the same IKM and salt.

### Example 2: TLS 1.3 Key Schedule

TLS 1.3 uses HKDF extensively. Simplified version of the handshake key derivation:

```java
// Early secret from PSK or zeros
byte[] zeros = new byte[hashLen];
byte[] earlySecret = hkdfExtract(zeros, pskOrZeros);

// Handshake secret after ECDHE
byte[] derivedSecret = hkdfExpandLabel(earlySecret, "derived", "", hashLen);
byte[] handshakeSecret = hkdfExtract(derivedSecret, ecdhSharedSecret);

// Traffic keys for handshake
byte[] clientHandshakeTrafficSecret = hkdfExpandLabel(
    handshakeSecret, "c hs traffic", transcriptHash, hashLen);
byte[] serverHandshakeTrafficSecret = hkdfExpandLabel(
    handshakeSecret, "s hs traffic", transcriptHash, hashLen);

// Helper: HKDF-Expand-Label from RFC 8446
byte[] hkdfExpandLabel(byte[] secret, String label, byte[] context, int length) {
    // Constructs: struct { uint16 length; opaque label<7..255>; opaque context<0..255>; }
    byte[] hkdfLabel = buildHkdfLabel(length, "tls13 " + label, context);
    return kdf.deriveData(HKDFParameterSpec.expandOnly(
        new SecretKeySpec(secret, "Generic"), hkdfLabel, length));
}
```

TLS 1.3's key schedule is a cascade of HKDF operations. Each stage feeds into the next, with labels providing domain separation. The entire handshake and application traffic security depends on this derivation chain being correct.

Before JEP 510, the JDK's TLS implementation had an internal `HKDF` class buried in `sun.security.ssl`. That's being refactored to use the public KDF API ([PR #24393](https://github.com/openjdk/jdk/pull/24393)), eliminating duplication and letting other components share the implementation.

### Example 3: Password-Based Encryption (Future)

Although Argon2 isn't included yet, here's how it would look:

```java
// User's password
char[] password = ...;
byte[] salt = new SecureRandom().generateSeed(16);

// Argon2 parameters (hypothetical)
KDF kdf = KDF.getInstance("Argon2id");
Argon2ParameterSpec params = new Argon2ParameterSpec.Builder()
    .password(password)
    .salt(salt)
    .iterations(3)
    .memoryCost(65536)  // 64 MB
    .parallelism(4)
    .build();

SecretKey derivedKey = kdf.deriveKey("AES", params);

// Use derivedKey for encryption
Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
cipher.init(Cipher.ENCRYPT_MODE, derivedKey, ...);
```

The KDF API's extensibility enables this without changing the core classes. Argon2 providers can ship as separate JARs, and applications just call `getInstance("Argon2id")`.

### Example 4: HPKE Key Schedule (Simplified)

HPKE's `KeySchedule` uses HKDF to set up encryption context:

```java
// KEM encapsulation produced a shared secret
byte[] kemSharedSecret = kemContext.getSharedSecret();

// Extract
byte[] prk = kdf.deriveData(HKDFParameterSpec.ofExtract()
    .addIKM(kemSharedSecret)
    .addSalt("HPKE-v1".getBytes())
    .extractOnly()
);

// Expand for encryption key
SecretKey encKey = kdf.deriveKey("AES",
    HKDFParameterSpec.expandOnly(
        new SecretKeySpec(prk, "Generic"),
        "hpke key".getBytes(), 
        32
    )
);

// Expand for nonce
byte[] baseNonce = kdf.deriveData(
    HKDFParameterSpec.expandOnly(
        new SecretKeySpec(prk, "Generic"),
        "hpke nonce".getBytes(),
        12
    )
);
```

HPKE's layered construction (KEM + KDF + AEAD) is straightforward with the KDF API. The upcoming `HPKE` class ([PR #18411](https://github.com/openjdk/jdk/pull/18411)) will encapsulate this, but under the hood it's calling `KDF.getInstance("HKDF-SHA256")`.

## Security Considerations

### Salt Management

Salts don't need to be secret, but they must be **unique per derivation** in scenarios where the same IKM is reused. Example: if you're deriving session keys from a long-term master key, use a fresh random salt each time. Otherwise, sessions derive identical keys (bad).

For protocols where both parties need to derive the same key, the salt must be shared. Typically it's sent in the clear alongside the encrypted data. Just make sure it's authenticated (e.g., covered by a MAC or AEAD).

Zero-length salts are acceptable—HKDF substitutes a zero-filled buffer. But random salts are better if you can afford the overhead.

### Info Parameter Discipline

Always include `info` when deriving multiple keys from the same IKM. Even if it's just the string `"key1"`, `"key2"`, `"key3"`. This ensures:
- Different purposes get uncorrelated keys
- Protocol versioning doesn't accidentally reuse keys
- Domain separation prevents cross-protocol attacks

TLS 1.3 got this right: every key has a unique label like `"c hs traffic"` (client handshake traffic) or `"s ap traffic"` (server application traffic). Even if an attacker could somehow manipulate one derivation, they can't pivot to keys for a different purpose.

### Output Length Limits

HKDF can produce up to 255 × hash length bytes. For SHA-256, that's 8160 bytes. If you need more, you're probably doing something wrong—derive an intermediate key and use it with a different KDF or a stream cipher.

Don't request arbitrary lengths "just in case." Derive exactly what you need. More output doesn't mean more security; it just means more material an attacker could potentially analyze.

### Key Zeroization

The JDK implementation zeros intermediate buffers, but your application code should too:

```java
byte[] derivedBytes = kdf.deriveData(...);
try {
    // Use derivedBytes
} finally {
    Arrays.fill(derivedBytes, (byte) 0);
}
```

Modern JVMs try to prevent optimizations that would remove "dead" zeroing, but it's not guaranteed. For maximum paranoia, use `SecretKey` objects instead of byte arrays—the JDK clears them more reliably.

### Provider Trust

KDF security depends on the underlying HMAC implementation. Using a certified PKCS#11 provider means your KDF operations happen on validated hardware. Using an untested third-party provider means you're trusting that vendor's crypto hygiene.

Java's provider architecture makes this pluggable, but don't blindly load random JARs off the internet and expect FIPS compliance.

## Migration and Adoption

### Refactoring Internal Code

The JDK itself is migrating to the KDF API. Three major refactorings in flight:

1. **TLS 1.3**: The `sun.security.ssl.HKDF` class is being replaced with `javax.crypto.KDF` calls. This affects handshake key derivation, traffic key updates, and exporter operations.

2. **DHKEM**: JEP 452 introduced `KEM` for key encapsulation. The Diffie-Hellman-based KEM (`DHKEM`) internally uses HKDF. It's moving from a private implementation to the public API.

3. **HPKE**: The forthcoming `HPKE` class (PR #18411) will use the KDF API exclusively. It supports multiple KDF algorithms (HKDF-SHA256, HKDF-SHA384, HKDF-SHA512) via the standard pluggability.

### Third-Party Providers

Security vendors can now ship KDF implementations as standard providers. Register your `KDFSpi` subclass:

```java
// In your Provider subclass
put("KDF.Argon2id", "com.example.Argon2KDF");
put("KDF.PBKDF2-HMAC-SHA512", "com.example.PBKDF2_SHA512");
```

Applications discover these via `KDF.getInstance("Argon2id")` without needing to know which provider supplies it.

### Application Adoption

If your code currently has ad-hoc HKDF:

**Before:**
```java
Mac hmac = Mac.getInstance("HmacSHA256");
hmac.init(new SecretKeySpec(salt, "HmacSHA256"));
byte[] prk = hmac.doFinal(ikm);

hmac.init(new SecretKeySpec(prk, "HmacSHA256"));
hmac.update(info);
hmac.update((byte) 1);
byte[] okm = hmac.doFinal();
```

**After:**
```java
KDF kdf = KDF.getInstance("HKDF-SHA256");
byte[] okm = kdf.deriveData(
    HKDFParameterSpec.ofExtract()
        .addIKM(ikm)
        .addSalt(salt)
        .thenExpand(info, 32)
);
```

The API version is more concise, less error-prone (no off-by-one in counter bytes), and opens the door to hardware acceleration.

### Compatibility

JEP 510 finalizes the API in JDK 25 after preview in JDK 24. If you target JDK 24, use `--enable-preview`. If you target JDK 25+, it's standard.

There are no breaking changes from the preview—the API is identical. The only tweak: `ScopedValue.orElse()` now rejects `null`, but that's unrelated (JEP 506).

## Conclusions

JEP 510 isn't glamorous, but it's foundational. Key derivation is everywhere in modern cryptography—key agreement protocols, password storage, session key generation, post-quantum hybrid schemes—and Java finally has a clean, extensible API for it.

The immediate win is HKDF standardization. Every library that needs RFC 5869 compliance can now use `javax.crypto.KDF` instead of rolling custom implementations. This consolidation improves security (one well-tested implementation instead of dozens), maintainability (JDK engineers can optimize the hot path), and hardware integration (PKCS#11 providers get first-class support).

The long-term win is post-quantum readiness. HPKE needs KDFs. Hybrid TLS needs KDFs. As ML-KEM becomes mandatory for government and enterprise systems, Java applications will increasingly rely on the building blocks provided by JEP 452 (KEM) and JEP 510 (KDF). Having these primitives in place before the quantum threat materializes is strategic.

Expect gradual adoption. Existing code using PBKDF2 via `SecretKeyFactory` doesn't need to migrate—that API isn't going away. But new code should use the KDF API, especially for protocol-level cryptography. Library authors should migrate internal HKDF implementations to the standard API to benefit from hardware acceleration and future optimizations.

The API's extensibility matters most. When Argon2 becomes a JDK-provided algorithm (likely JDK 26 or 27), applications just call `KDF.getInstance("Argon2id")`—no API changes needed. When novel KDFs emerge from NIST or academic research, third-party providers can plug them in seamlessly.

In a world racing toward quantum-safe cryptography, having standardized, performant, hardware-backed key derivation isn't optional. It's table stakes. JEP 510 delivers that.

## References

- [JEP 510: Key Derivation Function API](https://openjdk.org/jeps/510)
- [JEP 478: Key Derivation Function API (Preview)](https://openjdk.org/jeps/478)
- [RFC 5869: HKDF (HMAC-based Extract-and-Expand Key Derivation Function)](https://www.rfc-editor.org/rfc/rfc5869)
- [RFC 9180: Hybrid Public Key Encryption (HPKE)](https://www.rfc-editor.org/rfc/rfc9180)
- [RFC 9106: Argon2 Memory-Hard Function for Password Hashing and Proof-of-Work Applications](https://www.rfc-editor.org/rfc/rfc9106)
- [RFC 8446: The Transport Layer Security (TLS) Protocol Version 1.3](https://www.rfc-editor.org/rfc/rfc8446) (Section 7.1: Key Schedule)
- [JEP 452: Key Encapsulation Mechanism API](https://openjdk.org/jeps/452)
- [NIST Post-Quantum Cryptography Standardization](https://csrc.nist.gov/projects/post-quantum-cryptography)
- [PKCS #11 v3.1: Cryptographic Token Interface Standard](https://docs.oasis-open.org/pkcs11/pkcs11-spec/v3.1/os/pkcs11-spec-v3.1-os.html) (Section 5.39: Key Derivation Functions)
- [OpenJDK Source: KDF.java](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/javax/crypto/KDF.java)
- [OpenJDK Source: HKDFKeyDerivation.java](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/com/sun/crypto/provider/HKDFKeyDerivation.java)
- [OpenJDK PR #24393: Refactor TLS 1.3 to use KDF API](https://github.com/openjdk/jdk/pull/24393)
- [OpenJDK PR #18411: Implement HPKE (RFC 9180)](https://github.com/openjdk/jdk/pull/18411)

---

**Tags**: Java, JDK 25, Cryptography, Key Derivation, KDF, HKDF, Security, TLS, HPKE, Java Security, Encryption, Password Hashing, Cryptographic API

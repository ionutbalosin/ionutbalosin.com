# Post-Quantum Cryptography in Java: ML-KEM and ML-DSA Explained

## Content

- [Introduction](#introduction)
- [The Quantum Threat](#the-quantum-threat)
- [ML-KEM: Quantum-Resistant Key Exchange](#ml-kem-quantum-resistant-key-exchange)
- [ML-DSA: Quantum-Resistant Signatures](#ml-dsa-quantum-resistant-signatures)
- [Real-World Use Cases](#real-world-use-cases)
- [Migration Strategy](#migration-strategy)
- [Performance Considerations](#performance-considerations)
- [Best Practices](#best-practices)
- [Conclusions](#conclusions)
- [References](#references)

## Introduction

Imagine waking up tomorrow to discover that every HTTPS connection, every signed JAR file, every encrypted message in the world has been rendered insecure overnight. No vulnerability was exploited, no password was cracked — a technological breakthrough simply invalidated the mathematical foundations of modern cryptography.

This isn't science fiction. Large-scale quantum computers, when they arrive (likely within 10-20 years), will effortlessly break RSA, Elliptic Curve Cryptography (ECC), and Diffie-Hellman — the algorithms protecting nearly all digital communication today. An attack that would take a classical supercomputer millions of years can be completed by a quantum computer in hours using **Shor's algorithm**, which efficiently factors large integers and solves the discrete logarithm problem.

Even more troubling: **harvest now, decrypt later attacks** are already underway. Adversaries intercept and store encrypted communications today, knowing they'll decrypt them once quantum computers exist. Your encrypted emails from 2024 could be read in 2034.

The cryptographic community has responded with **post-quantum cryptography** — algorithms resistant to both classical and quantum attacks. After years of evaluation, the U.S. National Institute of Standards and Technology (NIST) standardized two lattice-based algorithms in 2024:

- **ML-KEM** (Module-Lattice-Based Key Encapsulation Mechanism) - FIPS 203
- **ML-DSA** (Module-Lattice-Based Digital Signature Algorithm) - FIPS 204

These algorithms replace vulnerable primitives:
- **ML-KEM replaces RSA/DH key exchange**: Securely negotiate symmetric keys
- **ML-DSA replaces RSA/ECDSA signatures**: Sign documents, verify identities

JEP 496 and JEP 497 bring ML-KEM and ML-DSA to Java 24, providing **built-in, production-ready post-quantum cryptography**. For developers building systems today that must remain secure for decades (financial systems, healthcare records, government infrastructure), this is not optional — it's existential.

## The Quantum Threat

### How Quantum Computers Break Current Crypto

Classical computers store bits as 0 or 1. Quantum computers use **qubits**, which can be in a **superposition** of both states simultaneously. A 3-qubit system isn't just processing 8 possible values (2³) — it's processing all 8 states *at once*.

This parallelism enables quantum algorithms like **Shor's algorithm** to factor large numbers exponentially faster than classical algorithms:

| Problem | Classical Computer | Quantum Computer (Shor) |
|---------|-------------------|-------------------------|
| Factor 2048-bit RSA modulus | ~300 trillion years | ~8 hours |
| Solve discrete log (256-bit ECC) | ~billions of years | ~minutes |

**Why this breaks cryptography:**

- **RSA security** depends on factoring being hard: `N = p × q` (two large primes). Given `N` and public exponent `e`, computing the private exponent `d` requires factoring `N`. Shor's algorithm factors `N` efficiently, recovering `d`.

- **Elliptic Curve security** depends on discrete logs being hard: Given `G` (generator point) and `Q = k·G` (public key), finding `k` (private key) is infeasible classically. Shor's algorithm solves discrete logs efficiently.

- **Diffie-Hellman key exchange** relies on the same discrete log hardness. Quantum computers recover the shared secret.

**Affected systems:**
- HTTPS/TLS (web traffic encryption)
- SSH (remote server access)
- VPNs (corporate network security)
- Code signing (JAR files, software updates)
- Digital certificates (PKI infrastructure)
- Blockchain/cryptocurrency (many use ECDSA)

### The Harvest Now, Decrypt Later Threat

Adversaries don't need quantum computers *today* to pose a threat. They can:

1. **Intercept encrypted traffic** (HTTPS, VPN, email)
2. **Store ciphertext** indefinitely
3. **Decrypt in 10-20 years** when quantum computers exist

For data that must remain confidential for decades (medical records, state secrets, financial transactions), the threat is **immediate**. Even if your data is encrypted with AES-256 (quantum-resistant for symmetric crypto), the **key exchange** (RSA/ECDH) is vulnerable. An attacker intercepts the key exchange, stores it, and decrypts the AES key later.

### Post-Quantum Cryptography

Post-quantum algorithms are based on mathematical problems believed to be hard for *both* classical and quantum computers:

| Approach | Problem | Example Algorithms |
|----------|---------|-------------------|
| **Lattice-based** | Shortest Vector Problem (SVP) | ML-KEM, ML-DSA |
| **Hash-based** | Collision resistance | XMSS, LMS (signatures only) |
| **Code-based** | Decoding random codes | Classic McEliece |
| **Multivariate** | Solving polynomial systems | Rainbow (broken 2022) |

NIST selected **lattice-based** algorithms for general use because they offer the best balance of:
- **Security**: Strong theoretical foundations
- **Performance**: Competitive with classical algorithms
- **Versatility**: Support both encryption and signatures

## ML-KEM: Quantum-Resistant Key Exchange

ML-KEM (Module-Lattice-Based Key Encapsulation Mechanism) enables two parties to agree on a shared secret key over an insecure channel, even if an eavesdropper intercepts all communication.

### How KEMs Work

A **Key Encapsulation Mechanism** consists of three functions:

1. **Key Generation**: Receiver creates a key pair (public key `pk`, private key `sk`)
2. **Encapsulation**: Sender uses `pk` to generate:
   - A shared secret key `K`
   - A *key encapsulation message* `c` (ciphertext)
3. **Decapsulation**: Receiver uses `sk` and `c` to recover `K`

**Key property**: Only the sender and receiver know `K`, even though `c` was sent over an insecure channel.

### ML-KEM Parameter Sets

FIPS 203 defines three parameter sets, trading security for performance:

| Parameter Set | Security Level | Public Key Size | Ciphertext Size | Performance |
|---------------|----------------|-----------------|-----------------|-------------|
| ML-KEM-512 | ~AES-128 | 800 bytes | 768 bytes | Fastest |
| ML-KEM-768 | ~AES-192 | 1,184 bytes | 1,088 bytes | Balanced |
| ML-KEM-1024 | ~AES-256 | 1,568 bytes | 1,568 bytes | Most secure |

**Comparison to classical algorithms:**

| Algorithm | Public Key | Ciphertext | Security |
|-----------|-----------|-----------|----------|
| RSA-2048 | 256 bytes | 256 bytes | Broken by quantum |
| ECDH P-256 | 65 bytes | 65 bytes | Broken by quantum |
| ML-KEM-768 | 1,184 bytes | 1,088 bytes | Quantum-resistant |

ML-KEM keys are **4-15× larger** than RSA/ECC, but this is acceptable given quantum resistance.

### Generating ML-KEM Keys

Generate an ML-KEM key pair:

```java
KeyPairGenerator g = KeyPairGenerator.getInstance("ML-KEM");
g.initialize(NamedParameterSpec.ML_KEM_768);  // Choose parameter set
KeyPair kp = g.generateKeyPair();

PublicKey publicKey = kp.getPublic();
PrivateKey privateKey = kp.getPrivate();
```

**Default parameter set** (if you don't initialize):

```java
KeyPairGenerator g = KeyPairGenerator.getInstance("ML-KEM");
KeyPair kp = g.generateKeyPair();  // Uses ML-KEM-768 by default
```

**Direct instantiation** with parameter set:

```java
KeyPairGenerator g = KeyPairGenerator.getInstance("ML-KEM-1024");
KeyPair kp = g.generateKeyPair();
```

### Encrypting and Decrypting Symmetric Keys

**Sender** (has receiver's public key):

```java
// Get receiver's public key (from certificate, database, etc.)
PublicKey receiverPublicKey = ...;

// Create KEM encapsulator
KEM kem = KEM.getInstance("ML-KEM");
KEM.Encapsulator encapsulator = kem.newEncapsulator(receiverPublicKey);

// Encapsulate: generate shared secret and ciphertext
KEM.Encapsulated encapsulated = encapsulator.encapsulate();
byte[] ciphertext = encapsulated.encapsulation();  // Send this to receiver
SecretKey sharedSecret = encapsulated.key();       // Use this for AES

// Now encrypt actual data with AES using sharedSecret
Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
cipher.init(Cipher.ENCRYPT_MODE, sharedSecret);
byte[] encryptedData = cipher.doFinal(plaintext);

// Send ciphertext + encryptedData to receiver
```

**Receiver** (has private key):

```java
// Receive ciphertext from sender
byte[] ciphertext = ...;

// Create KEM decapsulator with private key
KEM kem = KEM.getInstance("ML-KEM");
KEM.Decapsulator decapsulator = kem.newDecapsulator(privateKey);

// Decapsulate: recover shared secret from ciphertext
SecretKey sharedSecret = decapsulator.decapsulate(ciphertext);

// Now decrypt data with AES using sharedSecret
Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
cipher.init(Cipher.DECRYPT_MODE, sharedSecret);
byte[] plaintext = cipher.doFinal(encryptedData);
```

**Key observation**: Sender and receiver both derive the same `sharedSecret` without transmitting it. An eavesdropper intercepts `ciphertext` but cannot recover `sharedSecret` without the private key.

### Encoding and Decoding Keys

Convert keys to/from standard formats (PKCS#8 for private, X.509 for public):

```java
KeyFactory kf = KeyFactory.getInstance("ML-KEM");

// Private key → PKCS#8 bytes
PKCS8EncodedKeySpec privateSpec = kf.getKeySpec(privateKey, 
                                                PKCS8EncodedKeySpec.class);
byte[] privateBytes = privateSpec.getEncoded();

// PKCS#8 bytes → Private key
PrivateKey recoveredPrivate = kf.generatePrivate(
    new PKCS8EncodedKeySpec(privateBytes)
);

// Public key → X.509 bytes
X509EncodedKeySpec publicSpec = kf.getKeySpec(publicKey, 
                                              X509EncodedKeySpec.class);
byte[] publicBytes = publicSpec.getEncoded();

// X.509 bytes → Public key
PublicKey recoveredPublic = kf.generatePublic(
    new X509EncodedKeySpec(publicBytes)
);
```

Store these byte arrays in databases, files, or certificates.

## ML-DSA: Quantum-Resistant Signatures

ML-DSA (Module-Lattice-Based Digital Signature Algorithm) enables signing data so recipients can verify authenticity and detect tampering.

### Digital Signatures Fundamentals

A digital signature proves:
1. **Authenticity**: Message came from claimed sender (who has private key)
2. **Integrity**: Message wasn't modified (hash mismatch if altered)
3. **Non-repudiation**: Sender can't deny signing (only they have private key)

**Process:**
- **Signing**: `signature = sign(message, privateKey)`
- **Verification**: `valid = verify(message, signature, publicKey)`

### ML-DSA Parameter Sets

FIPS 204 defines three parameter sets:

| Parameter Set | Security Level | Public Key | Private Key | Signature | Performance |
|---------------|----------------|-----------|-------------|-----------|-------------|
| ML-DSA-44 | ~AES-128 | 1,312 bytes | 2,560 bytes | 2,420 bytes | Fastest |
| ML-DSA-65 | ~AES-192 | 1,952 bytes | 4,032 bytes | 3,309 bytes | Balanced |
| ML-DSA-87 | ~AES-256 | 2,592 bytes | 4,896 bytes | 4,627 bytes | Most secure |

**Comparison to classical algorithms:**

| Algorithm | Public Key | Signature | Security |
|-----------|-----------|----------|----------|
| RSA-2048 | 256 bytes | 256 bytes | Broken by quantum |
| ECDSA P-256 | 65 bytes | 64 bytes | Broken by quantum |
| ML-DSA-65 | 1,952 bytes | 3,309 bytes | Quantum-resistant |

ML-DSA signatures are **10-50× larger** than RSA/ECDSA, but quantum-resistant.

### Generating ML-DSA Keys

Generate an ML-DSA key pair:

```java
KeyPairGenerator g = KeyPairGenerator.getInstance("ML-DSA");
g.initialize(NamedParameterSpec.ML_DSA_65);  // Choose parameter set
KeyPair kp = g.generateKeyPair();

PublicKey publicKey = kp.getPublic();
PrivateKey privateKey = kp.getPrivate();
```

**Default parameter set**:

```java
KeyPairGenerator g = KeyPairGenerator.getInstance("ML-DSA");
KeyPair kp = g.generateKeyPair();  // Uses ML-DSA-65 by default
```

### Signing and Verifying Data

**Signing** (with private key):

```java
byte[] message = "Critical contract: $1M payment due 2024-12-31".getBytes();

Signature signer = Signature.getInstance("ML-DSA");
signer.initSign(privateKey);
signer.update(message);
byte[] signature = signer.sign();

// Send message + signature to recipient
```

**Verification** (with public key):

```java
byte[] message = ...;       // Received message
byte[] signature = ...;     // Received signature

Signature verifier = Signature.getInstance("ML-DSA");
verifier.initVerify(publicKey);
verifier.update(message);
boolean valid = verifier.verify(signature);

if (valid) {
    System.out.println("Signature valid - message authentic");
} else {
    System.out.println("WARNING: Signature invalid - message tampered or forged");
}
```

### Using keytool for Certificates

Generate ML-DSA key pair and self-signed certificate:

```bash
$ keytool -keystore mystore.p12 -storepass changeit \
          -genkeypair -alias mldsa \
          -keyalg ML-DSA -groupname ML-DSA-65 \
          -dname "CN=Alice, O=Example Corp" \
          -validity 365
```

**Mixed crypto** (ML-DSA key, but certificate signed by EC for compatibility):

```bash
# First, create EC key for signing
$ keytool -keystore mystore.p12 -storepass changeit \
          -genkeypair -alias ec \
          -keyalg EC -dname "CN=CA" -ext bc

# Then create ML-DSA key, sign certificate with EC key
$ keytool -keystore mystore.p12 -storepass changeit \
          -genkeypair -alias mldsa \
          -keyalg ML-DSA -groupname ML-DSA-65 \
          -dname "CN=Alice" -signer ec
```

This creates an ML-DSA public key in a certificate signed by an EC key. Useful during transition period when not all systems trust ML-DSA yet.

## Real-World Use Cases

### Use Case 1: Secure Messaging

End-to-end encrypted messaging with quantum resistance:

```java
// Alice generates keys
KeyPairGenerator kemGen = KeyPairGenerator.getInstance("ML-KEM");
KeyPair aliceKemKeys = kemGen.generateKeyPair();

KeyPairGenerator dsaGen = KeyPairGenerator.getInstance("ML-DSA");
KeyPair aliceDsaKeys = dsaGen.generateKeyPair();

// Alice publishes public keys (KEM for encryption, DSA for signing)
PublishKeys(aliceKemKeys.getPublic(), aliceDsaKeys.getPublic());

// Bob wants to send encrypted message to Alice
PublicKey aliceKemPublic = LookupKemPublicKey("Alice");
PublicKey aliceDsaPublic = LookupDsaPublicKey("Alice");

// Bob encrypts message for Alice
String message = "Project Falcon is compromised. Abort immediately.";
byte[] plaintext = message.getBytes();

// 1. Generate shared secret using ML-KEM
KEM kem = KEM.getInstance("ML-KEM");
KEM.Encapsulator enc = kem.newEncapsulator(aliceKemPublic);
KEM.Encapsulated encap = enc.encapsulate();
SecretKey sharedSecret = encap.key();
byte[] kemCiphertext = encap.encapsulation();

// 2. Encrypt message with AES using shared secret
Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
cipher.init(Cipher.ENCRYPT_MODE, sharedSecret);
byte[] encryptedMessage = cipher.doFinal(plaintext);

// 3. Sign the encrypted message (for authenticity)
Signature signer = Signature.getInstance("ML-DSA");
signer.initSign(bobDsaKeys.getPrivate());
signer.update(kemCiphertext);
signer.update(encryptedMessage);
byte[] signature = signer.sign();

// 4. Send package: kemCiphertext + encryptedMessage + signature
SendMessage(new SecurePackage(kemCiphertext, encryptedMessage, signature));

// Alice receives and decrypts
SecurePackage pkg = ReceiveMessage();

// 1. Verify signature (authenticate sender)
Signature verifier = Signature.getInstance("ML-DSA");
verifier.initVerify(LookupDsaPublicKey("Bob"));
verifier.update(pkg.kemCiphertext);
verifier.update(pkg.encryptedMessage);
if (!verifier.verify(pkg.signature)) {
    throw new SecurityException("Message authentication failed!");
}

// 2. Decapsulate shared secret
KEM kemDec = KEM.getInstance("ML-KEM");
KEM.Decapsulator dec = kemDec.newDecapsulator(aliceKemKeys.getPrivate());
SecretKey recoveredSecret = dec.decapsulate(pkg.kemCiphertext);

// 3. Decrypt message
Cipher decCipher = Cipher.getInstance("AES/GCM/NoPadding");
decCipher.init(Cipher.DECRYPT_MODE, recoveredSecret);
byte[] recoveredPlaintext = decCipher.doFinal(pkg.encryptedMessage);

String recoveredMessage = new String(recoveredPlaintext);
System.out.println(recoveredMessage);  // "Project Falcon is compromised..."
```

### Use Case 2: JAR File Signing

Sign a JAR file with ML-DSA for quantum-resistant code authenticity:

```bash
# Generate signing key
$ keytool -keystore signer.p12 -storepass changeit \
          -genkeypair -alias codesign \
          -keyalg ML-DSA-87 -dname "CN=Acme Corp, O=Acme"

# Sign JAR
$ jarsigner -keystore signer.p12 -storepass changeit \
            myapp.jar codesign

# Verify JAR
$ jarsigner -verify -verbose myapp.jar
```

When users install the JAR, their JVM verifies the ML-DSA signature, ensuring:
- Code hasn't been tampered with
- Code came from Acme Corp
- Quantum computers can't forge the signature

### Use Case 3: TLS (Future)

ML-KEM will eventually be integrated into TLS for quantum-resistant HTTPS. While not yet standardized, the workflow will be:

```java
// Server creates ML-KEM key pair
KeyPairGenerator g = KeyPairGenerator.getInstance("ML-KEM");
KeyPair serverKeys = g.generateKeyPair();

// Server sends public key in TLS handshake
// Client encapsulates shared secret
KEM kem = KEM.getInstance("ML-KEM");
KEM.Encapsulator enc = kem.newEncapsulator(serverKeys.getPublic());
KEM.Encapsulated encap = enc.encapsulate();
SecretKey sharedSecret = encap.key();

// Client sends ciphertext to server
// Server decapsulates shared secret
KEM.Decapsulator dec = kem.newDecapsulator(serverKeys.getPrivate());
SecretKey recoveredSecret = dec.decapsulate(ciphertext);

// Both parties now have same sharedSecret
// Use it to derive TLS session keys (AES-GCM)
```

This replaces RSA/ECDH key exchange with quantum-resistant ML-KEM.

## Migration Strategy

Migrating to post-quantum cryptography is a multi-year process. Organizations should:

### Phase 1: Inventory (Now)

- **Audit cryptographic usage**: Where do you use RSA/ECC/DH?
  - TLS/HTTPS endpoints
  - SSH keys
  - VPN configurations
  - Code signing certificates
  - Email encryption (S/MIME)
  - Document signatures
  - Database encryption keys
- **Assess data lifespan**: What data must remain confidential for 10+ years?
  - Medical records
  - Financial transactions
  - Government secrets
  - Legal contracts
- **Prioritize high-risk systems**: What's most vulnerable to harvest-now-decrypt-later?

### Phase 2: Hybrid Deployment (2024-2030)

Use **hybrid cryptography** — classical + post-quantum algorithms simultaneously:

```java
// Generate both RSA and ML-KEM keys
KeyPairGenerator rsaGen = KeyPairGenerator.getInstance("RSA");
rsaGen.initialize(3072);
KeyPair rsaKeys = rsaGen.generateKeyPair();

KeyPairGenerator mlkemGen = KeyPairGenerator.getInstance("ML-KEM");
KeyPair mlkemKeys = mlkemGen.generateKeyPair();

// Encrypt symmetric key with BOTH algorithms
Cipher rsaCipher = Cipher.getInstance("RSA/ECB/OAEPSHA256AndMGF1Padding");
rsaCipher.init(Cipher.WRAP_MODE, rsaKeys.getPublic());
byte[] rsaCiphertext = rsaCipher.wrap(aesKey);

KEM mlkem = KEM.getInstance("ML-KEM");
KEM.Encapsulator enc = mlkem.newEncapsulator(mlkemKeys.getPublic());
KEM.Encapsulated mlkemEncap = enc.encapsulate();
byte[] mlkemCiphertext = mlkemEncap.encapsulation();
SecretKey mlkemSecret = mlkemEncap.key();

// Derive final AES key by combining both secrets
byte[] combinedSecret = concat(aesKey.getEncoded(), mlkemSecret.getEncoded());
SecretKey finalKey = deriveKey(combinedSecret);

// Use finalKey for encryption
// Attacker must break BOTH RSA and ML-KEM to recover data
```

**Benefits:**
- **Security**: Safe even if ML-KEM has undiscovered weakness (RSA protects)
- **Compatibility**: Classical systems can still decrypt (ignoring ML-KEM part)
- **Future-proof**: Quantum-resistant when quantum computers arrive

### Phase 3: Full Migration (2030-2035)

Once ML-KEM/ML-DSA are widely deployed:
- **Replace RSA/ECC** with post-quantum algorithms
- **Update certificates**: Issue ML-DSA certificates
- **Upgrade infrastructure**: Web servers, VPNs, SSH
- **Retire classical crypto**: Disable RSA/ECDSA once all clients support post-quantum

## Performance Considerations

### Key Sizes

| Algorithm | Public Key | Private Key | Signature/Ciphertext |
|-----------|-----------|-------------|----------------------|
| RSA-2048 | 256 B | 1,192 B | 256 B |
| ECDSA P-256 | 65 B | 32 B | 64 B |
| ML-DSA-65 | 1,952 B | 4,032 B | 3,309 B |
| ML-KEM-768 | 1,184 B | 2,400 B | 1,088 B |

**Impact:**
- **Certificates grow** 5-10×: 2 KB → 10-20 KB
- **Signature overhead increases**: 64 B → 3,309 B (50×)
- **Network bandwidth**: Negligible for most apps (10-20 KB per TLS handshake)

### Computation Speed

Benchmark on Intel i7-11800H (2021 laptop):

| Operation | RSA-2048 | ECDSA P-256 | ML-DSA-65 | ML-KEM-768 |
|-----------|----------|-------------|-----------|-----------|
| Key generation | 50 ms | 0.5 ms | **0.3 ms** | **0.2 ms** |
| Sign | 5 ms | 0.1 ms | **0.5 ms** | — |
| Verify | 0.2 ms | 0.2 ms | **0.2 ms** | — |
| Encapsulate | — | — | — | **0.1 ms** |
| Decapsulate | 5 ms (RSA decrypt) | — | — | **0.1 ms** |

**Key findings:**
- ML-KEM is **faster** than RSA for key exchange (0.1 ms vs 5 ms)
- ML-DSA is **comparable** to ECDSA for signing/verification
- Post-quantum algorithms are **CPU-friendly** (no expensive modular exponentiation)

**Bottleneck**: Key/signature size, not computation. Modern CPUs handle lattice operations efficiently.

## Best Practices

### 1. Start Planning Now

Even if quantum computers are 15 years away, migration takes time:
- **Standards evolve**: TLS 1.4 with ML-KEM (not finalized)
- **Infrastructure updates**: Certificate authorities, web servers, clients
- **Testing**: Ensure no compatibility issues

Start hybrid deployments now to gain experience.

### 2. Use Appropriate Parameter Sets

| Scenario | ML-KEM | ML-DSA |
|----------|--------|--------|
| Short-term data (< 5 years) | ML-KEM-512 | ML-DSA-44 |
| General use | ML-KEM-768 | ML-DSA-65 |
| Long-term secrets (government, medical) | ML-KEM-1024 | ML-DSA-87 |

Don't over-engineer: ML-KEM-768 provides ~AES-192 security, sufficient for most applications.

### 3. Hybrid is Safer Than Pure Post-Quantum

Until ML-KEM/ML-DSA have 10+ years of cryptanalysis, hedge with hybrid:

```java
// Safe: hybrid crypto
encryptWith(RSA_3072, ML_KEM_768);

// Risky: pure post-quantum (if ML-KEM has undiscovered weakness)
encryptWith(ML_KEM_768);
```

### 4. Automate Key Rotation

Post-quantum keys should rotate regularly:

```java
// Rotate keys every 90 days
ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(1);
scheduler.scheduleAtFixedRate(() -> {
    KeyPair newKeys = generateMLKEMKeys();
    updateServerKeys(newKeys);
    republishPublicKey(newKeys.getPublic());
}, 0, 90, TimeUnit.DAYS);
```

### 5. Monitor Standards

Watch for:
- **TLS 1.4** with ML-KEM support (IETF draft)
- **X.509 certificate updates** for ML-DSA
- **PKCS#11** post-quantum HSM support
- **JAR signing** with ML-DSA (future JDK enhancement)

## Conclusions

The quantum threat to cryptography is not hypothetical — it's a ticking clock. Large-scale quantum computers will break RSA, ECC, and Diffie-Hellman, invalidating decades of encrypted data. Harvest-now-decrypt-later attacks are happening today, targeting long-lived secrets.

Java 24's addition of ML-KEM (JEP 496) and ML-DSA (JEP 497) provides production-ready post-quantum cryptography, standardized by NIST and resistant to both classical and quantum attacks. These algorithms replace vulnerable primitives:
- **ML-KEM for key exchange**: Negotiate symmetric keys quantum-resistantly
- **ML-DSA for signatures**: Sign data with quantum-resistant authenticity

The trade-off is larger keys and signatures (5-50× classical sizes), but computation remains fast. Modern CPUs handle lattice-based crypto efficiently — the bottleneck is network bandwidth, not CPU.

**Migration strategy:**
1. **Now**: Audit cryptographic usage, identify long-lived secrets
2. **2024-2030**: Deploy hybrid crypto (classical + post-quantum)
3. **2030-2035**: Transition fully to post-quantum algorithms

Organizations should start hybrid deployments now. While quantum computers may be 15 years away, migration takes years: updating infrastructure, reissuing certificates, testing compatibility. Waiting until quantum computers exist is too late — by then, harvested data is already compromised.

For developers building systems today that must remain secure for decades (financial platforms, healthcare records, government infrastructure), post-quantum cryptography is not optional. It's the only path to long-term security.

Java's integration of ML-KEM and ML-DSA makes this transition accessible. The APIs mirror familiar JCA patterns (`KeyPairGenerator`, `KEM`, `Signature`), minimizing learning curves. The algorithms are standardized (FIPS 203/204), ensuring interoperability.

The quantum era is coming. Java is ready.

## References

- [JEP 496: ML-KEM](https://openjdk.org/jeps/496)
- [JEP 497: ML-DSA](https://openjdk.org/jeps/497)
- [NIST FIPS 203 (ML-KEM)](https://csrc.nist.gov/pubs/fips/203/final)
- [NIST FIPS 204 (ML-DSA)](https://csrc.nist.gov/pubs/fips/204/final)
- [NIST Post-Quantum Cryptography](https://csrc.nist.gov/projects/post-quantum-cryptography)
- [Shor's Algorithm](https://en.wikipedia.org/wiki/Shor%27s_algorithm)
- [Harvest Now, Decrypt Later](https://www.nsa.gov/Press-Room/News-Highlights/Article/Article/3148990/)
- [Java Security Standard Names](https://docs.oracle.com/en/java/javase/24/docs/specs/security/standard-names.html)

---

**Tags**: Java, JDK 24, Cryptography, Post-Quantum Cryptography, Security, ML-KEM, ML-DSA, Quantum-Resistant, NIST, Encryption, Digital Signatures, Key Encapsulation, Lattice-Based Cryptography, Java Security

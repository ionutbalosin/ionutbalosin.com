# PEM Encodings in Java: A Standard API for Keys, Certificates, and CRLs

## Content

- [Introduction](#introduction)
- [The PEM Interoperability Gap](#the-pem-interoperability-gap)
- [Enter PEMEncoder and PEMDecoder](#enter-pemencoder-and-pemdecoder)
- [Technical Deep Dive](#technical-deep-dive)
- [Performance Analysis](#performance-analysis)
- [Practical Examples](#practical-examples)
- [Migration Considerations](#migration-considerations)
- [Conclusions](#conclusions)
- [References](#references)

## Introduction

🔒 This article covers the PEM API as it stands in JDK 26 (second preview) and JDK 27 (third preview): the `PEMEncoder` and `PEMDecoder` classes in `java.security`, the sealed `BinaryEncodable` hierarchy, the pass-through `PEM` class, and the additions to `javax.crypto.EncryptedPrivateKeyInfo`. It is written for Java developers who handle TLS material, signing keys, or certificate chains in their applications, and it assumes basic familiarity with `KeyFactory` and `CertificateFactory`.

Privacy-Enhanced Mail (PEM) is the textual container defined by RFC 7468 that wraps a Base64-encoded binary structure between a `-----BEGIN <label>-----` header and an `-----END <label>-----` footer. The label identifies the content (for example `PUBLIC KEY`, `PRIVATE KEY`, `CERTIFICATE`, `X509 CRL`), and the binary payload is an ASN.1 DER structure: PKCS#8 for private keys (RFC 5958), `SubjectPublicKeyInfo` for public keys, and X.509 for certificates and certificate revocation lists (RFC 5280). Although it was originally designed for e-mail, PEM is today the lingua franca of OpenSSL, OpenSSH, certificate authorities, Kubernetes secrets, and most configuration files that carry cryptographic material.

Despite this ubiquity, the Java Platform never offered a dedicated API for PEM. The gap was confirmed by the Java Cryptographic Extensions Survey in April 2022 and finally addressed by a preview API delivered in JDK 25 (JEP 470), refined in JDK 26 (JEP 524) and JDK 27 (JEP 538). The API has since been finalized in the current OpenJDK main line under JEP 542, which is why the sources cited below carry `@since 28`; apart from the removed preview annotations and some Javadoc wording, the code is the same as in the JDK 27 GA build.

## The PEM Interoperability Gap

Before this API, decoding a PEM-encoded private key in plain Java looked roughly like the code snapshot below. Every step is left to the developer: stripping the header and footer, removing whitespace, Base64-decoding, choosing the right `KeySpec` and, most annoyingly, knowing in advance which `KeyFactory` algorithm to use.

```java
String pem = Files.readString(Path.of("key.pem"));
String base64 = pem.replace("-----BEGIN PRIVATE KEY-----", "")
                   .replace("-----END PRIVATE KEY-----", "")
                   .replaceAll("\\s", "");
byte[] der = Base64.getDecoder().decode(base64);
PKCS8EncodedKeySpec spec = new PKCS8EncodedKeySpec(der);
// "EC" must be known in advance, or extracted from the DER by hand
PrivateKey key = KeyFactory.getInstance("EC").generatePrivate(spec);
```

The pain points are well known to anyone who has written this code more than once:

- **Fragile parsing**: Hand-written string manipulation does not handle leading data (for example a human-readable dump placed before the block), `\r\n` line endings, or mismatched header and footer labels.
- **Algorithm discovery**: A PKCS#8 structure embeds an algorithm identifier (OID), but the standard API gives no convenient way to read it. Developers either hard-code the algorithm or try several factories in sequence.
- **Encrypted private keys**: Decrypting an `ENCRYPTED PRIVATE KEY` requires `EncryptedPrivateKeyInfo`, `SecretKeyFactory`, `PBEKeySpec`, `Cipher`, and finally a `KeyFactory`. The JEP estimates this at over a dozen lines, and it is a frequent reason for adding a third-party library.
- **Asymmetric API surface**: `CertificateFactory` already accepts PEM input for certificates and CRLs, while `KeyFactory` does not. Encoding goes through `getEncoded()` plus `Base64.getMimeEncoder()`, with the header and footer again assembled by hand.

## Enter PEMEncoder and PEMDecoder

The JEP introduces one interface and three classes in `java.security`, plus a small number of additions to existing classes:

- **`BinaryEncodable`**: An empty, sealed marker interface identifying the cryptographic objects that have a standardized binary (DER) representation and can therefore travel through PEM. In JDK 25 and JDK 26 it was called `DEREncodable`.
- **`PEMEncoder`**: Converts a `BinaryEncodable` into PEM text, as `byte[]` (ISO-8859-1) or `String`. A password-configured copy, obtained via `withEncryption(char[])`, encrypts private key material into an `ENCRYPTED PRIVATE KEY`.
- **`PEMDecoder`**: Converts PEM text, from a `String` or an `InputStream`, back into a typed object. Copies configured via `withDecryption(char[])` decrypt encrypted private keys, and copies configured via `withFactoriesOf(Provider)` (named `withFactory` in JDK 25 and 26) obtain their `KeyFactory` and `CertificateFactory` instances from a specific provider.
- **`PEM`**: A `BinaryEncodable` holding a label, the raw Base64 content, and any leading data. It is the fallback for PEM types without a Java counterpart, such as PKCS#10 certification requests.
- **`EncryptedPrivateKeyInfo`**: Gains static `encrypt(...)` factory methods and `getKey(...)` / `getKeyPair(...)` decryption methods, so that non-default PBE algorithms and providers can be used.
- **`javax.crypto.CryptoException`** (JDK 27): An unchecked exception raised for encryption or decryption failures where checked `GeneralSecurityException` subclasses are not desired.

The design is deliberately similar to `java.util.Base64` and `java.util.HexFormat`: a static `of()` factory returns a shared immutable instance, `with*` methods return new configured instances, and both classes are thread-safe and reusable. The following table summarizes the mapping between PEM labels and Java types, as documented in the class-level Javadoc of [PEMEncoder.java](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/security/PEMEncoder.java) and [PEMDecoder.java](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/security/PEMDecoder.java):

| PEM label | Decoded as | Encoded from |
|---|---|---|
| `PUBLIC KEY` | `PublicKey` | `PublicKey`, `X509EncodedKeySpec` |
| `PRIVATE KEY` | `PrivateKey`, or `KeyPair` if a public key is embedded | `PrivateKey`, `KeyPair`, `PKCS8EncodedKeySpec` |
| `ENCRYPTED PRIVATE KEY` | `EncryptedPrivateKeyInfo`, or `PrivateKey` / `KeyPair` with `withDecryption` | `EncryptedPrivateKeyInfo`, or `PrivateKey` / `KeyPair` / `PKCS8EncodedKeySpec` with `withEncryption` |
| `CERTIFICATE` | `X509Certificate` | `X509Certificate` |
| `X509 CRL` | `X509CRL` | `X509CRL` |
| anything else | `PEM` | `PEM` |

## Technical Deep Dive

### The BinaryEncodable hierarchy

The interface is declared in [BinaryEncodable.java](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/security/BinaryEncodable.java) and its permitted subtypes are spread over `java.security`, `java.security.cert`, `java.security.spec`, and `javax.crypto`:

```java
public sealed interface BinaryEncodable permits AsymmetricKey, KeyPair,
    PKCS8EncodedKeySpec, X509EncodedKeySpec, EncryptedPrivateKeyInfo,
    X509Certificate, X509CRL, PEM, InternalBinaryEncodable {
}
```

`AsymmetricKey` is the common super-interface of `PublicKey` and `PrivateKey`, so every `RSAPublicKey`, `ECPrivateKey`, `EdECPrivateKey`, and so on is transitively a `BinaryEncodable`. The existing classes were made `non-sealed` so that third-party providers can keep subclassing them. An important note to make is the last permitted type, `sun.security.internal.InternalBinaryEncodable`: it is a non-public type added in JDK 27 to make the hierarchy deliberately non-exhaustive. A `switch` over a `BinaryEncodable` therefore always needs a `default` (or `case BinaryEncodable`) branch, which allows new subtypes to be added in future releases without breaking compiled switches.

### Parsing the encapsulation boundaries

All parsing is done by `sun.security.util.Pem.readPEM(InputStream)` in [Pem.java](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/sun/security/util/Pem.java). It is a byte-oriented state machine rather than a regular expression: it reads bytes until it has seen five hyphens followed by `B`, treats everything before that point as leading data, then reads the header up to the next `-----`, the Base64 body up to the footer, and finally the footer. The header and footer labels must match, otherwise an `IOException("Header and footer do not match")` is raised, which `PEMDecoder` surfaces as an `IllegalArgumentException`. The supported labels are plain constants:

```java
public static final String CERTIFICATE = "CERTIFICATE";
public static final String X509_CRL = "X509 CRL";
public static final String ENCRYPTED_PRIVATE_KEY = "ENCRYPTED PRIVATE KEY";
public static final String PRIVATE_KEY = "PRIVATE KEY";
public static final String RSA_PRIVATE_KEY = "RSA PRIVATE KEY";
public static final String PUBLIC_KEY = "PUBLIC KEY";
public static final String X509_CERTIFICATE = "X509 CERTIFICATE";
public static final String X_509_CERTIFICATE = "X.509 CERTIFICATE";
public static final String CRL = "CRL";
```

The legacy labels `X509 CERTIFICATE`, `X.509 CERTIFICATE`, and `CRL` are normalized to `CERTIFICATE` and `X509 CRL` by a private `typeConverter` before the `PEM` object is built. The result of `readPEM` is always a `PEM` instance; the Base64 body is kept as bytes and only decoded on demand through `PEM.decode()`, which uses `Base64.getMimeDecoder()` and therefore tolerates line breaks.

### From label to object

The heart of the decoder is the private `decode(PEM)` method in `PEMDecoder`, which switches on the label. The `PRIVATE KEY` branch shows how the algorithm is discovered without any hint from the caller:

```java
case Pem.PRIVATE_KEY -> {
    // ...
    byte[] encoding = pem.decode();
    try {
        p8key = new PKCS8Key(encoding);
        String algo = p8key.getAlgorithm();
        KeyFactory kf = getKeyFactory(algo);
        p8spec = new PKCS8EncodedKeySpec(encoding, algo);
        d = kf.generatePrivate(p8spec);

        // Look for a public key inside the pkcs8 encoding.
        if (p8key.getPubKeyEncoded() != null) {
            // Check if this is a OneAsymmetricKey encoding
            X509EncodedKeySpec spec = new X509EncodedKeySpec(
                p8key.getPubKeyEncoded(), algo);
            yield new KeyPair(getKeyFactory(algo).
                generatePublic(spec), (PrivateKey) d);
        } // ...
        else {
            yield d;
        }
    } finally {
        KeyUtil.clear(encoding, p8spec, p8key);
    }
}
```

`sun.security.pkcs.PKCS8Key` parses the outer `OneAsymmetricKey` SEQUENCE from RFC 5958: the version integer (0 for v1, 1 for v2), the `privateKeyAlgorithm` `AlgorithmIdentifier`, the private key OCTET STRING, optional attributes, and, for v2, the optional `[1] publicKey` BIT STRING. The algorithm name obtained from the OID (for example `EC`, `RSA`, `Ed25519`, `ML-DSA-65`) is then used to look up the `KeyFactory`, either from the default provider list or from the provider given to `withFactoriesOf`. Public keys follow the same idea through `KeyUtil.getAlgorithm(byte[])`, which walks the `SubjectPublicKeyInfo` DER structure to the embedded `AlgorithmIdentifier`.

It is worth mentioning that `PKCS8Key` also inspects SEC1-style EC private keys, which OpenSSL typically emits with the public point embedded in the ECPrivateKey structure. In that case `getPubKeyEncoded()` is non-null and the decoder returns a `KeyPair` instead of a `PrivateKey`. The encoder does the inverse: `PEMEncoder.encode(KeyPair)` calls `PKCS8Key.getEncoded(publicEncoding, privateEncoding)` to produce a v2 `OneAsymmetricKey` under the `PRIVATE KEY` label, so the pair round-trips as a single PEM block.

### Encryption defaults and immutability

`PEMEncoder.withEncryption(char[])` derives a PBE `SecretKey` eagerly in the private constructor, using `SecretKeyFactory.getInstance(Pem.DEFAULT_ALGO)`, and registers a `Cleaner` action to destroy that key when the encoder becomes unreachable. `Pem.DEFAULT_ALGO` is read once from the `jdk.epkcs8.defaultAlgorithm` security property, defined in [java.security](https://github.com/openjdk/jdk/blob/master/src/java.base/share/conf/security/java.security):

```text
# Default algorithm for PEMEncoder Encrypted PKCS#8
jdk.epkcs8.defaultAlgorithm=PBEWithHmacSHA256AndAES_128
```

This is a PBES2 scheme (RFC 8018): PBKDF2 with HMAC-SHA256 as the key derivation function and AES-128 as the cipher. The provider chooses the salt and iteration count; the resulting `AlgorithmIdentifier` and parameters are serialized into the `EncryptedPrivateKeyInfo` structure, which is why the JEP states that changing the default in a future release will not affect already encoded text.

On the decoder side, `withDecryption` stores a `PBEKeySpec`, and `withFactoriesOf` stores a `Provider`. Both methods return `new PEMDecoder(...)` carrying over the other field, so the two configurations compose in any order and the shared instance returned by `of()` is never mutated. Decryption itself goes through `Pem.decryptEncoding(EncryptedPrivateKeyInfo, PBEKeySpec)`, which selects the `SecretKeyFactory` by `ekpi.getAlgName()`, i.e. from the algorithm stored in the PEM text, not from the current default. Any `GeneralSecurityException` there is wrapped into an unchecked `CryptoException`.

## Performance Analysis

Neither JEP 524 nor JEP 538 publishes any measurements, and the JDK tree contains no JMH benchmark for this API, so no numbers can be quoted here. Qualitatively, the cost of a decode operation is dominated by the same work the manual approach already performed: a Base64 decode of the body, a DER parse of the `OneAsymmetricKey` or `SubjectPublicKeyInfo` structure, and the `KeyFactory.generatePrivate` / `generatePublic` call, which parses and validates the algorithm-specific key material. The PEM layer adds a single pass over the input bytes in `readPEM` and, for private keys, one extra `PKCS8Key` parse to discover the algorithm before the `KeyFactory` parses it again.

For encrypted private keys, the PBKDF2 derivation is intentionally expensive and will dominate everything else. The encoder performs it once, inside `withEncryption`, which is a good reason to create a configured encoder once and reuse it; the decoder performs it on every decryption, since the salt and iteration count come from the PEM text itself. Certificates and CRLs are delegated to `CertificateFactory`, whose cost is unchanged. In my humble opinion, the API is not a performance feature; its value lies in correctness and in the removal of a third-party dependency.

## Practical Examples

All examples target JDK 27 (`javac --release 27 --enable-preview`, `java --enable-preview`). For JDK 26, replace `BinaryEncodable` with `DEREncodable` and `withFactoriesOf` with `withFactory`.

### Example 1: decoding a public key and a certificate from strings

The `decode(String, Class)` overload returns the requested type directly and throws `ClassCastException` if the content does not match. Below is an example of decoding the EC public key from the JEP text and a certificate loaded from a Kubernetes-style secret.

```java
import java.security.PEMDecoder;
import java.security.cert.X509Certificate;
import java.security.interfaces.ECPublicKey;

public class DecodeExample {
    static final String EC_PUBLIC_KEY = """
        -----BEGIN PUBLIC KEY-----
        MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEi/kRGOL7wCPTN4KJ2ppeSt5UYB6u
        cPjjuKDtFTXbguOIFDdZ65O/8HTUqS/sVzRF+dg7H3/tkQ/36KdtuADbwQ==
        -----END PUBLIC KEY-----
        """;

    public static void main(String[] args) throws Exception {
        PEMDecoder decoder = PEMDecoder.of();

        ECPublicKey publicKey = decoder.decode(EC_PUBLIC_KEY, ECPublicKey.class);
        System.out.println(publicKey.getParams());

        String certPem = System.getenv("TLS_CRT");
        X509Certificate cert = decoder.decode(certPem, X509Certificate.class);
        System.out.println(cert.getSubjectX500Principal());
    }
}
```

### Example 2: encoding a key pair and reading it back

`PEMEncoder.encode(KeyPair)` produces a single `PRIVATE KEY` block in PKCS#8 v2 format with the public key embedded. The decoder recognizes the embedded public key and returns a `KeyPair`; asking for `PrivateKey.class` or `PublicKey.class` extracts the corresponding half.

```java
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.*;

public class KeyPairExample {
    public static void main(String[] args) throws Exception {
        KeyPair generated = KeyPairGenerator.getInstance("Ed25519").generateKeyPair();

        Path file = Path.of("signing-key.pem");
        Files.write(file, PEMEncoder.of().encode(generated));

        try (var in = Files.newInputStream(file)) {
            KeyPair restored = PEMDecoder.of().decode(in, KeyPair.class);
            System.out.println(restored.getPrivate().getAlgorithm());
        }

        PublicKey onlyPublic = PEMDecoder.of()
            .decode(Files.readString(file), PublicKey.class);
        System.out.println(onlyPublic.getFormat()); // X.509
    }
}
```

### Example 3: password-protected private keys

The code snapshot below encrypts with the default algorithm via `withEncryption`, then with an explicit PBES2 variant via `EncryptedPrivateKeyInfo.encrypt`. Decoding without a password yields an `EncryptedPrivateKeyInfo`, which can be decrypted later with `getKey`; decoding with `withDecryption` yields the key directly. A wrong password results in a `CryptoException`.

```java
import javax.crypto.EncryptedPrivateKeyInfo;
import java.security.*;

public class EncryptedKeyExample {
    public static void main(String[] args) throws Exception {
        char[] password = "correct horse battery staple".toCharArray();
        PrivateKey privateKey = KeyPairGenerator.getInstance("EC")
            .generateKeyPair().getPrivate();

        // Default: jdk.epkcs8.defaultAlgorithm (PBEWithHmacSHA256AndAES_128)
        String pem = PEMEncoder.of().withEncryption(password)
            .encodeToString(privateKey);

        // Explicit algorithm and provider-chosen parameters
        EncryptedPrivateKeyInfo epki = EncryptedPrivateKeyInfo.encrypt(
            privateKey, password, "PBEWithHmacSHA512AndAES_256", null, null);
        String strongerPem = PEMEncoder.of().encodeToString(epki);

        // Two ways to decrypt
        PrivateKey direct = PEMDecoder.of().withDecryption(password)
            .decode(pem, PrivateKey.class);
        EncryptedPrivateKeyInfo decoded = PEMDecoder.of()
            .decode(strongerPem, EncryptedPrivateKeyInfo.class);
        PrivateKey later = decoded.getKey(password);

        System.out.println(direct.getAlgorithm() + " " + later.getAlgorithm());
    }
}
```

### Example 4: handling unknown PEM types with the PEM class

A PKCS#10 certification request (`CERTIFICATE REQUEST`) has no representation in the Java Platform API. The decoder returns a `PEM` object for it, from which the raw DER bytes can be obtained with `decode()` and passed to whatever library processes CSRs. The same class can be constructed from a `byte[]` and re-encoded without validation.

```java
import java.security.BinaryEncodable;
import java.security.PEM;
import java.security.PEMDecoder;
import java.security.PEMEncoder;
import java.security.cert.X509Certificate;

public class UnknownTypeExample {
    static byte[] derOf(String pemText) {
        BinaryEncodable decoded = PEMDecoder.of().decode(pemText);
        return switch (decoded) {
            case X509Certificate cert -> cert.getPublicKey().getEncoded();
            case PEM pem when pem.type().equals("CERTIFICATE REQUEST") ->
                pem.decode(); // raw PKCS#10 DER
            case PEM pem -> throw new IllegalArgumentException(
                "Unhandled PEM type: " + pem.type());
            default -> throw new IllegalArgumentException(
                "Unexpected content: " + decoded.getClass().getName());
        };
    }

    static String wrap(byte[] base64Csr) {
        return PEMEncoder.of().encodeToString(
            new PEM("CERTIFICATE REQUEST", base64Csr));
    }
}
```

## Migration Considerations

### JDK versions and flags

The API lives in the `java.base` module, packages `java.security` and `javax.crypto`, so no `--add-modules` is required. It is a preview API in JDK 25, 26, and 27 and must be enabled explicitly: `javac --release <N> --enable-preview Main.java` and `java --enable-preview Main`, or `java --enable-preview Main.java` with the source launcher, or `jshell --enable-preview`. Preview code compiled against one release will not run on another, so a project that adopts the API on JDK 26 has to be recompiled for JDK 27. In the OpenJDK main line the preview annotations have already been removed (JEP 542), which means that code written against the JDK 27 shape should carry over to the final version with few or no changes.

### What changed from JEP 470 (JDK 25) to JEP 524 (JDK 26)

- **`PEMRecord` renamed to `PEM`**: The record also gained a `decode()` method returning the Base64-decoded bytes.
- **`encryptKey` renamed to `encrypt`**: The static methods of `EncryptedPrivateKeyInfo` now accept a `DEREncodable` instead of a `PrivateKey`, so `KeyPair` and `PKCS8EncodedKeySpec` instances can be encrypted as well.
- **`getKeyPair` added**: `EncryptedPrivateKeyInfo.getKeyPair(char[])` and `getKeyPair(Key, Provider)` decrypt a PKCS#8 v2 structure that carries a public key.
- **Exception alignment**: `getKey` now declares `NoSuchAlgorithmException` and `InvalidKeyException`, like the pre-existing `getKeySpec` methods, instead of the broader `GeneralSecurityException`.
- **Encryption of `KeyPair` and `PKCS8EncodedKeySpec`**: `PEMEncoder.withEncryption` accepts these types in addition to `PrivateKey`, and `PEMDecoder.withDecryption` returns a `KeyPair` when the decrypted content contains a public key.

### What changed from JEP 524 (JDK 26) to JEP 538 (JDK 27)

- **`DEREncodable` renamed to `BinaryEncodable`**: The interface is also made explicitly non-exhaustive via the non-public `InternalBinaryEncodable` permitted type, so switches over it require a `default` branch.
- **`PEM` is now a final class, not a record**: `content()` returns `byte[]` instead of `String`, and two constructors taking `byte[] base64Content` were added next to the `String` ones. Code that relied on record features (`equals`, deconstruction patterns) must be adjusted.
- **`withFactory` renamed to `withFactoriesOf`**: Behavior is unchanged; the name reflects that both `KeyFactory` and `CertificateFactory` come from the given `Provider`.
- **`getKey(Key, Provider)` and `getKeyPair(Key, Provider)` lose the `Provider` parameter**: They are now `getKey(Key)` and `getKeyPair(Key)`; use the five-argument `encrypt` overload if a provider must be pinned on the encryption side.
- **`CryptoException` introduced**: Encryption or decryption failures inside `PEMEncoder`, `PEMDecoder`, and `EncryptedPrivateKeyInfo.encrypt` surface as this unchecked `javax.crypto.CryptoException` instead of the `IllegalArgumentException` used in JDK 26.

### Pitfalls

- **`KeyPair` instead of `PrivateKey`**: As explained above, EC private keys that embed the public point are common, so `decode(pem)` returns a `KeyPair`. Code that does `instanceof PrivateKey` on the untyped result will fail; it is recommended to use `decode(pem, PrivateKey.class)` when only the private half is needed.
- **`decode(pem, BinaryEncodable.class)` is rejected**: The implementation throws `ClassCastException("BinaryEncodable is not a PEM type")`; use the untyped `decode(pem)` instead.
- **Legacy `RSA PRIVATE KEY` is read-only**: The decoder accepts unencrypted PKCS#1 RSA keys (`-----BEGIN RSA PRIVATE KEY-----`) through `RSAPrivateCrtKeyImpl.getKeySpec`, but the encoder always emits PKCS#8. Encrypted PKCS#1 keys with `Proc-Type`/`DEK-Info` headers are not supported.
- **Only one block per call**: `readPEM` stops at the first footer. A certificate chain must be decoded in a loop over the same `InputStream`, one block per `decode` call; `CertificateFactory.generateCertificates` remains the simpler option for chains.
- **`getKeyPair` on a key without a public half**: The implementation throws `InvalidKeyException("This encoding does not contain a public key")`, although the JEP text mentions `IllegalArgumentException`. Catch the checked exception.
- **Password hygiene**: Both `withEncryption` and `withDecryption` clone the `char[]`; the caller remains responsible for zeroing the original array.

## Conclusions

The PEM API closes a long-standing gap in the JCA: a PEM file produced by OpenSSL, a certificate authority, or a Kubernetes secret can be turned into a `PrivateKey`, `X509Certificate`, or `KeyPair` with a single method call, and the algorithm is discovered from the DER content rather than guessed by the caller. Encrypted PKCS#8 keys are handled with `withEncryption` and `withDecryption` using a configurable PBES2 default.

A few concrete takeaways:

- **Prefer the typed overload**: `decode(text, PrivateKey.class)` avoids the `KeyPair`-versus-`PrivateKey` surprise with EC keys and gives a `ClassCastException` early when the input is not what was expected.
- **Keep `default` branches**: `BinaryEncodable` is intentionally non-exhaustive; pattern-matching switches on decoded objects must handle future subtypes.
- **Configure once, reuse**: A `PEMEncoder` configured with a password derives its PBE key at construction time; create it once per password and share it across threads.
- **Track the renames**: `DEREncodable` → `BinaryEncodable`, `withFactory` → `withFactoriesOf`, `encryptKey` → `encrypt`, and the `PEM` record becoming a class are mechanical but mandatory changes between JDK 25, 26, and 27.

Adoption recommendation: use the API in JDK 27 for new code that reads or writes PEM, behind `--enable-preview`, in tooling, tests, and internal services where the preview constraint is acceptable. For libraries that must compile across several JDK versions, keep the manual approach or an abstraction layer until the finalized API is the minimum baseline.

## References

- [JEP 524: PEM Encodings of Cryptographic Objects (Second Preview)](https://openjdk.org/jeps/524)
- [JEP 538: PEM Encodings of Cryptographic Objects (Third Preview)](https://openjdk.org/jeps/538)
- [JEP 470: PEM Encodings of Cryptographic Objects (Preview)](https://openjdk.org/jeps/470)
- [JEP 542: PEM Encodings of Cryptographic Objects](https://openjdk.org/jeps/542)
- [OpenJDK Source: BinaryEncodable.java](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/security/BinaryEncodable.java)
- [OpenJDK Source: PEMEncoder.java](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/security/PEMEncoder.java)
- [OpenJDK Source: PEMDecoder.java](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/security/PEMDecoder.java)
- [OpenJDK Source: PEM.java](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/security/PEM.java)
- [OpenJDK Source: EncryptedPrivateKeyInfo.java](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/javax/crypto/EncryptedPrivateKeyInfo.java)
- [OpenJDK Source: CryptoException.java](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/javax/crypto/CryptoException.java)
- [OpenJDK Source: sun/security/util/Pem.java](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/sun/security/util/Pem.java)
- [OpenJDK Source: sun/security/pkcs/PKCS8Key.java](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/sun/security/pkcs/PKCS8Key.java)
- [OpenJDK Source: sun/security/util/KeyUtil.java](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/sun/security/util/KeyUtil.java)
- [OpenJDK Source: java.security configuration file](https://github.com/openjdk/jdk/blob/master/src/java.base/share/conf/security/java.security)
- [RFC 7468: Textual Encodings of PKIX, PKCS, and CMS Structures](https://www.rfc-editor.org/rfc/rfc7468)
- [RFC 5958: Asymmetric Key Packages](https://www.rfc-editor.org/rfc/rfc5958)
- [RFC 5280: Internet X.509 Public Key Infrastructure Certificate and CRL Profile](https://www.rfc-editor.org/rfc/rfc5280)
- [RFC 8018: PKCS #5: Password-Based Cryptography Specification Version 2.1](https://www.rfc-editor.org/rfc/rfc8018)
- [RFC 1421: Privacy Enhancement for Internet Electronic Mail](https://www.rfc-editor.org/rfc/rfc1421)

---

**Tags**: Java, JDK 26, JDK 27, PEM, Cryptography, PKCS#8, X.509, Certificates, Private Keys, Java Security, JCA, Preview Features, OpenSSL Interoperability

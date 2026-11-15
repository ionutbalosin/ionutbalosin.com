# Post-Quantum Hybrid Key Exchange in Java TLS 1.3: X25519 Meets ML-KEM

## Content

- [Introduction](#introduction)
- [The Harvest Now, Decrypt Later Problem](#the-harvest-now-decrypt-later-problem)
- [Enter Hybrid Key Exchange](#enter-hybrid-key-exchange)
- [Technical Deep Dive](#technical-deep-dive)
- [Performance Analysis](#performance-analysis)
- [Practical Examples](#practical-examples)
- [Migration Considerations](#migration-considerations)
- [Conclusions](#conclusions)
- [References](#references)

## Introduction

🔒 This article covers the post-quantum hybrid key exchange that JDK 27 adds to its TLS 1.3 implementation (JSSE): how it fits into the handshake, how the JDK implements it internally, and what a developer or operator has to know to verify, restrict, or disable it. It targets Java developers with a basic understanding of TLS; no prior exposure to post-quantum cryptography is required.

Starting with JDK 27, the TLS 1.3 client and server support three hybrid key exchange schemes that combine a traditional Elliptic-Curve Diffie-Hellman Ephemeral (ECDHE) exchange with the quantum-resistant Module-Lattice-Based Key Encapsulation Mechanism (ML-KEM) standardized by NIST in FIPS 203. The schemes are `X25519MLKEM768`, `SecP256r1MLKEM768`, and `SecP384r1MLKEM1024`, with the names and code points registered with IANA and specified in RFC 10024. The first one is enabled by default and placed at the front of the client's preference list, so any application using `javax.net.ssl` (and, transitively, `java.net.http.HttpClient`) gets quantum-resistant key exchange without code changes, provided that the peer supports it as well.

The feature builds on the `javax.crypto.KEM` API from JDK 21 (JEP 452) and the ML-KEM implementation from JDK 24 (JEP 496). It is worth mentioning that only TLS 1.3 is affected, and that the JDK deliberately does not offer pure (non-hybrid) ML-KEM groups in this release.

## The Harvest Now, Decrypt Later Problem

Every TLS 1.3 connection starts with a key exchange that produces a shared secret from which all session keys are derived. Today this exchange is almost universally (EC)DHE: the client sends an ephemeral public key in the `key_share` extension of its `ClientHello`, the server replies with its own in the `ServerHello`, and both sides compute the same shared secret. The security of this construction rests on the elliptic-curve discrete logarithm problem, which a sufficiently large quantum computer running Shor's algorithm would solve efficiently.

Such a quantum computer does not exist yet. Nevertheless, the threat is already relevant because of what the JEP calls the "harvest now, decrypt later" attack: an adversary records encrypted traffic today, stores it, and decrypts it once a capable quantum computer becomes available. Any data whose confidentiality must hold for more than a few years (medical records, financial transactions, long-lived credentials) is exposed right now, regardless of how strong the AES session cipher is. Therefore, the urgency is not about when quantum computers arrive, but about how long the data transmitted today has to stay secret.

Switching to a post-quantum key exchange alone is not without risk either. ML-KEM is a comparatively young algorithm that has not had the decades of cryptanalysis elliptic curves have had; a newly discovered classical weakness would leave a pure ML-KEM connection with no protection at all. This is the dilemma the IETF TLS Working Group addressed with the hybrid framework of RFC 9954: combine a traditional algorithm with a post-quantum one so that the connection remains secure as long as at least one of the two is unbroken.

## Enter Hybrid Key Exchange

A hybrid key exchange in TLS 1.3 is simply a new "named group" whose key share is the concatenation of two independent key shares, and whose shared secret is the concatenation of two independent shared secrets. No change to the handshake message flow is required, which is the main reason this approach could be deployed quickly across the industry.

The three groups implemented by JEP 527 and their IANA code points, as declared in [`NamedGroup.java`](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/sun/security/ssl/NamedGroup.java), are:

```java
X25519MLKEM768(0x11ec, "X25519MLKEM768",
        NamedGroupSpec.NAMED_GROUP_KEM,
        ProtocolVersion.PROTOCOLS_OF_13,
        Hybrid.X25519_MLKEM768,
        HybridProvider.PROVIDER),

SECP256R1MLKEM768(0x11eb, "SecP256r1MLKEM768",
        NamedGroupSpec.NAMED_GROUP_KEM,
        ProtocolVersion.PROTOCOLS_OF_13,
        Hybrid.SECP256R1_MLKEM768,
        HybridProvider.PROVIDER),

SECP384R1MLKEM1024(0x11ed, "SecP384r1MLKEM1024",
        NamedGroupSpec.NAMED_GROUP_KEM,
        ProtocolVersion.PROTOCOLS_OF_13,
        Hybrid.SECP384R1_MLKEM1024,
        HybridProvider.PROVIDER),
```

Source: [NamedGroup.java](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/sun/security/ssl/NamedGroup.java)

A few observations about this declaration:

- **Code points**: 0x11EC (4588), 0x11EB (4587), and 0x11ED (4589) match the IANA "TLS Supported Groups" registry entries made by RFC 10024.
- **A new group type**: `NamedGroupSpec.NAMED_GROUP_KEM` is a new category next to `NAMED_GROUP_ECDHE`, `NAMED_GROUP_FFDHE`, and `NAMED_GROUP_XDH`, and it drives a different handshake code path, described below.
- **TLS 1.3 only**: `ProtocolVersion.PROTOCOLS_OF_13` restricts them to TLS 1.3; a client that also enables TLS 1.2 still advertises them, but they can only be negotiated under TLS 1.3.
- **An internal provider**: `HybridProvider.PROVIDER` is a private JCA provider that is never installed in the system provider list; JSSE loads it internally.

### What is enabled by default

The default preference list, taken from the `SupportedGroups` inner class of the same file, places the hybrid group first:

```java
private static final NamedGroup[] defaultGroups = new NamedGroup[]{
        // Hybrid key agreement
        X25519MLKEM768,

        // Primary XDH (RFC 7748) curves
        X25519,

        // Primary NIST Suite B curves
        SECP256_R1,
        SECP384_R1,
        SECP521_R1,

        // Secondary XDH curves
        X448,

        // FFDHE (RFC 7919)
        FFDHE_2048,
        FFDHE_3072,
        FFDHE_4096
};
```

Source: [NamedGroup.java](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/sun/security/ssl/NamedGroup.java)

This is exactly the list quoted in the JEP. `SecP256r1MLKEM768` and `SecP384r1MLKEM1024` are implemented but not enabled by default; they have to be selected explicitly through `jdk.tls.namedGroups` or `SSLParameters::setNamedGroups`. According to the JEP, `X25519MLKEM768` is the fastest of the three hybrids and the one most TLS clients currently enable by default.

An important note to make is that the `NamedGroup` enum also contains entries for the pure ML-KEM code points (`MLKEM512`, `MLKEM768`, `MLKEM1024`, 0x0200 to 0x0202), but they are declared with a `null` parameter specification, which makes their `isAvailable` flag `false`. They cannot be negotiated in JDK 27, consistent with the stated non-goal.

## Technical Deep Dive

### How a KEM replaces Diffie-Hellman in the handshake

Diffie-Hellman is symmetric in shape: both parties generate a key pair, exchange public keys, and each combines its private key with the other's public key. A Key Encapsulation Mechanism (KEM) is asymmetric: one party (the receiver) generates a key pair and publishes the encapsulation key; the other party (the sender) runs `encapsulate` against that key, which produces a ciphertext plus a fresh shared secret; the receiver then runs `decapsulate` on the ciphertext to recover the same secret.

Mapped onto TLS 1.3, the client is the receiver and the server is the sender. The client puts its encapsulation key in the `ClientHello` `key_share`, and the server puts the KEM ciphertext in the `ServerHello` `key_share`. From the outside the message flow is identical to ECDHE, but the server's `key_share` is no longer a public key. This asymmetry is visible in [`KEMKeyExchange.java`](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/sun/security/ssl/KEMKeyExchange.java), where the role of each side is encoded in two distinct possession classes:

```java
@Override
public SSLPossession createPossession(
        NamedGroup ng, boolean isClient, SecureRandom random) {
    return isClient
            ? new KEMKeyExchange.KEMReceiverPossession(ng, random)
            : new KEMKeyExchange.KEMSenderPossession(ng, random);
}
```

Source: [NamedGroup.java](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/sun/security/ssl/NamedGroup.java), `KEMScheme`

`KEMReceiverPossession` generates the (hybrid) key pair in its constructor and encodes the public part as the raw bytes of the key share. `KEMSenderPossession` holds no key pair at all; it only stores the `SecureRandom` and, later, the shared secret produced by encapsulation. The server-side logic lives in `SHKeyShareProducer` in [`KeyShareExtension.java`](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/sun/security/ssl/KeyShareExtension.java):

```java
if (pos instanceof KEMKeyExchange.KEMSenderPossession xp) {
    if (cd instanceof KEMKeyExchange.KEMCredentials kcred
            && ng.equals(kcred.namedGroup)) {
        String name = ((NamedParameterSpec)
                ng.keAlgParamSpec).getName();
        KAKeyDerivation handshakeKD = new KAKeyDerivation(
                name, ng, shc, null, null,
                kcred.getKeyShare());
        var encaped = handshakeKD.encapsulate(
                "TlsHandshakeSecret", xp.getRandom());
        xp.setKey(encaped.key());
        keyShare = new KeyShareEntry(ng.id,
                encaped.encapsulation());
    }
} else {
    keyShare = new KeyShareEntry(ng.id, pos.encode());
}
```

Source: [KeyShareExtension.java](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/sun/security/ssl/KeyShareExtension.java)

This is a subtle change in the TLS state machine. With ECDHE, the server derives the shared secret after it has produced the `ServerHello`. With a KEM, the server must derive the handshake secret at the moment it produces the `key_share` extension, because the ciphertext and the secret come out of the same `encapsulate()` call. On the client side, `KAKeyDerivation::t13DeriveKey` checks whether a `keyshare` byte array is present and, if so, runs `KEM.newDecapsulator(localPrivateKey).decapsulate(...)` instead of a `KeyAgreement`.

### The hybrid combiner

The combination of the two algorithms is implemented in [`Hybrid.java`](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/sun/security/ssl/Hybrid.java), which provides a `KeyPairGenerator`, a `KeyFactory`, and a `KEM` engine for each hybrid group, all parameterised with a "left" and a "right" algorithm. The traditional ECDHE/X25519 side is wrapped as a KEM by [`DHasKEM.java`](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/sun/security/ssl/DHasKEM.java), so that both halves expose the same `javax.crypto.KEMSpi` interface:

```java
private static KEM getKEM(String name) throws NoSuchAlgorithmException {
    if (name.startsWith("secp") || name.equals("X25519")) {
        return KEM.getInstance("DH", HybridProvider.PROVIDER);
    } else {
        return KEM.getInstance("ML-KEM");
    }
}
```

Source: [Hybrid.java](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/sun/security/ssl/Hybrid.java)

`DHasKEM` treats the sender's ephemeral public key as the "ciphertext" and the Diffie-Hellman output as the "shared secret", and it performs the all-zero shared secret check for X25519/X448 required by RFC 8446 section 7.4.2. Encapsulation and decapsulation in the hybrid are then plain concatenations:

```java
@Override
public KEM.Encapsulated engineEncapsulate(int from, int to,
        String algorithm) {
    // ...
    var left  = le.encapsulate();
    var right = re.encapsulate();
    return new KEM.Encapsulated(
            new SecretKeyImpl(left.key(), right.key()),
            concat(left.encapsulation(), right.encapsulation()),
            null);
}

@Override
public SecretKey engineDecapsulate(byte[] encapsulation, int from,
        int to, String algorithm) throws DecapsulateException {
    // ... length checks ...
    var left = Arrays.copyOf(encapsulation, ld.encapsulationSize());
    var right = Arrays.copyOfRange(encapsulation,
            ld.encapsulationSize(), encapsulation.length);
    return new SecretKeyImpl(
            ld.decapsulate(left),
            rd.decapsulate(right)
    );
}
```

Source: [Hybrid.java](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/sun/security/ssl/Hybrid.java)

The order of the two halves is not arbitrary. [`HybridProvider.java`](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/sun/security/ssl/HybridProvider.java) registers `X25519MLKEM768` with `left = "ML-KEM-768"` and `right = "X25519"`, while the two NIST-curve groups have the EC curve on the left and ML-KEM on the right. This follows RFC 10024 exactly, and the RFC explains the reasoning: NIST SP 800-56C allows HKDF with two shared secrets as long as the first one comes from an approved scheme, so the FIPS-certifiable component is placed first.

The hybrid shared secret is never flattened into a single byte array inside the JDK. `Hybrid.SecretKeyImpl` is a record holding the two `SecretKey` halves, and [`KAKeyDerivation.java`](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/sun/security/ssl/KAKeyDerivation.java) feeds both into HKDF-Extract as consecutive input keying material, which is equivalent to the concatenation prescribed by the RFC:

```java
var spec = HKDFParameterSpec.ofExtract().addSalt(saltSecret);
if (sharedSecret instanceof Hybrid.SecretKeyImpl hsk) {
    spec = spec.addIKM(hsk.k1()).addIKM(hsk.k2());
} else {
    spec = spec.addIKM(sharedSecret);
}
return hkdf.deriveKey(label, spec.extractOnly());
```

Source: [KAKeyDerivation.java](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/sun/security/ssl/KAKeyDerivation.java)

From here on, the TLS 1.3 key schedule of RFC 8446 section 7.1 is unchanged. Peer validation also follows RFC 10024: in `KAKeyDerivation::encapsulate`, an ML-KEM encapsulation key that fails the FIPS 203 section 7.2 check or an all-zero X25519 secret is mapped to a fatal `illegal_parameter` alert, any other cryptographic failure becomes `internal_error`, and a ciphertext of the wrong length is rejected by `Hybrid.KEMImpl::engineDecapsulate` with a `DecapsulateException`, again converted into `illegal_parameter`.

### Which key shares the client actually sends

The `CHKeyShareProducer` in `KeyShareExtension.java` walks the enabled named groups in preference order and generates a key share for the first group of each `NamedGroupSpec` category, stopping after two categories. With the default list this yields one `NAMED_GROUP_KEM` share (`X25519MLKEM768`) and one `NAMED_GROUP_XDH` share (`x25519`), which is what the JEP states and what the JDK test `test/jdk/javax/net/ssl/TLSv13/ClientHelloKeyShares.java` asserts (code points 4588 and 29). Consequently, even if two hybrid groups are enabled, only the first one gets a key share in the initial `ClientHello`; the second can still be negotiated, but only through a `HelloRetryRequest` round trip.

On the server side, `CHKeyShareConsumer` keeps the client's key shares that are enabled locally, in the order they were sent, and `SHKeyShareProducer` takes the first usable one. In other words, the JDK server honours the client's preference among the shares the client actually offered.

## Performance Analysis

JEP 527 does not publish any throughput or latency measurements, and I will not invent any. The only qualitative statement the JEP makes is that `X25519MLKEM768` is the fastest of the three hybrid groups. The sizes below, however, are fixed by the specifications and can be verified in the JDK sources.

The ML-KEM ciphertext size is computed in [`ML_KEM.java`](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/com/sun/crypto/provider/ML_KEM.java) as `(k * du + dv) * 32`, which for ML-KEM-768 (k = 3, du = 10, dv = 4) gives 1,088 bytes and for ML-KEM-1024 (k = 4, du = 11, dv = 5) gives 1,568 bytes. The encapsulation key lengths (1,184 bytes for ML-KEM-768, 1,568 bytes for ML-KEM-1024) are defined in FIPS 203 and hard-coded in `Hybrid.KeyFactoryImpl::leftPublicLength` together with the 65-byte and 97-byte uncompressed EC points. Putting the halves together, as RFC 10024 does:

| Named group | Client key share | Server key share | Shared secret |
|---|---|---|---|
| x25519 (today's default) | 32 bytes | 32 bytes | 32 bytes |
| X25519MLKEM768 | 1,184 + 32 = 1,216 bytes | 1,088 + 32 = 1,120 bytes | 32 + 32 = 64 bytes |
| SecP256r1MLKEM768 | 65 + 1,184 = 1,249 bytes | 65 + 1,088 = 1,153 bytes | 32 + 32 = 64 bytes |
| SecP384r1MLKEM1024 | 97 + 1,568 = 1,665 bytes | 97 + 1,568 = 1,665 bytes | 48 + 32 = 80 bytes |

The practical consequences are mostly about bandwidth and packetisation rather than CPU:

- **A larger ClientHello**: with the default configuration the client sends both a 1,216-byte hybrid share and a 32-byte `x25519` share, so the `key_share` extension alone grows from 32 bytes to roughly 1.25 KB. A `ClientHello` of this size typically no longer fits in a single TCP segment on a standard Ethernet MTU, and middleboxes that assume a small, single-segment `ClientHello` can misbehave. The `ServerHello` grows by about 1.1 KB as well.
- **Extra computation**: each full handshake now runs an ML-KEM key generation and decapsulation on the client and an ML-KEM encapsulation on the server, in addition to the X25519 operations. The JDK tree ships two JMH benchmarks for measuring the actual cost: `test/micro/org/openjdk/bench/javax/crypto/full/KEMBench.java` (with `ML-KEM-768` and the three hybrid group names as parameters) and `test/micro/org/openjdk/bench/java/security/SSLHandshake.java` (with `TLSv1.3-X25519MLKEM768`, `TLSv1.3-SecP256r1MLKEM768`, and `TLSv1.3-SecP384r1MLKEM1024` alongside the classical groups). It is recommended to run these before drawing conclusions for a specific workload.
- **Session resumption does not avoid the cost**: the JDK only offers the `psk_dhe_ke` mode in its `psk_key_exchange_modes` extension (see `PskKeyExchangeModesExtension.java`), so a resumed TLS 1.3 handshake still carries a fresh `key_share` and performs the hybrid exchange again.

Rule of thumb: for a typical service the dominant cost of a TLS handshake remains the round trips and the certificate chain, so the hybrid overhead is generally acceptable, but connection-heavy workloads with very short-lived connections should measure it.

## Practical Examples

### Example 1: Verifying the negotiated group with HttpClient

The simplest way to confirm that a hybrid group was negotiated is to enable the JSSE handshake debugging and inspect the `key_share` extension printed for the `ServerHello`. The `-Djavax.net.debug=ssl:handshake` option prints every handshake message, including the named group of each key share.

```java
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

public class HybridTlsClient {

    public static void main(String[] args) throws Exception {
        // Equivalent to -Djavax.net.debug=ssl:handshake on the command line
        System.setProperty("javax.net.debug", "ssl:handshake");

        HttpClient client = HttpClient.newHttpClient();
        HttpRequest request = HttpRequest.newBuilder(
                URI.create("https://" + args[0] + "/")).build();

        HttpResponse<Void> response =
                client.send(request, HttpResponse.BodyHandlers.discarding());

        response.sslSession().ifPresent(session ->
                System.out.println(session.getProtocol() + " / "
                        + session.getCipherSuite()));
    }
}
```

With the default configuration, the log of the produced `ClientHello` contains two `key_share` entries, `"named group": X25519MLKEM768` followed by `"named group": x25519`, and the consumed `ServerHello` contains exactly one, which is the group the server selected. It is worth mentioning that JDK 27 has no public API to query the negotiated group on an `SSLSession`; the JDK 28 sources add `ExtendedSSLSession::getNamedGroup` (annotated `@since 28`), which will make this check programmatic.

### Example 2: Restricting a client to specific named groups

`SSLParameters::setNamedGroups` (available since JDK 20) overrides the default list for a single socket or engine without touching the global system property. The example below, adapted from the JEP, enables two hybrid groups and two traditional fallbacks:

```java
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLParameters;
import javax.net.ssl.SSLSocket;

public class RestrictedGroupsClient {

    public static void main(String[] args) throws Exception {
        SSLSocket socket = (SSLSocket) SSLContext.getDefault()
                .getSocketFactory().createSocket(args[0], 443);

        SSLParameters params = socket.getSSLParameters();
        params.setProtocols(new String[] {"TLSv1.3"});
        params.setNamedGroups(new String[] {
                "X25519MLKEM768", "SecP256r1MLKEM768", "x25519", "secp256r1"
        });
        socket.setSSLParameters(params);

        socket.startHandshake();
        System.out.println("Negotiated " + socket.getSession().getProtocol()
                + " with " + socket.getSession().getCipherSuite());
        socket.close();
    }
}
```

Following the key share selection logic described earlier, this client sends key shares only for `X25519MLKEM768` and `x25519`; the other two groups can still be negotiated through a `HelloRetryRequest`.

### Example 3: Disabling hybrids for compatibility testing

For troubleshooting a peer or a middlebox that does not cope with the larger `ClientHello`, the system property `jdk.tls.namedGroups` replaces the default list process-wide. The value is a comma-separated list in preference order; unknown or unavailable names are ignored, and an exception is thrown if nothing usable is left.

```shell
# Classical groups only, hybrid disabled
java -Djdk.tls.namedGroups="x25519,secp256r1,secp384r1" \
     -Djavax.net.debug=ssl:handshake HybridTlsClient example.org

# Hybrid only, to prove that a peer really supports it
java -Djdk.tls.namedGroups="X25519MLKEM768" HybridTlsClient example.org

# Show the effective TLS defaults of this JDK, including named groups
java -XshowSettings:security:tls -version
```

Of course, the property is read once, when the `NamedGroup.SupportedGroups` class is initialized, so it has to be set on the command line or before any JSSE class is touched.

### Example 4: A TLS 1.3 server preferring the NIST-curve hybrid

The same `SSLParameters` API applies on the server side. The snapshot below configures an `SSLServerSocket` to accept `SecP256r1MLKEM768` (the FIPS-oriented variant) first, with `X25519MLKEM768` and `secp256r1` as fallbacks. The key store is expected to be provided through the standard `javax.net.ssl.keyStore` and `javax.net.ssl.keyStorePassword` properties.

```java
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLParameters;
import javax.net.ssl.SSLServerSocket;
import javax.net.ssl.SSLSocket;

public class HybridTlsServer {

    public static void main(String[] args) throws Exception {
        SSLServerSocket serverSocket = (SSLServerSocket) SSLContext.getDefault()
                .getServerSocketFactory().createServerSocket(8443);

        SSLParameters params = serverSocket.getSSLParameters();
        params.setProtocols(new String[] {"TLSv1.3"});
        params.setNamedGroups(new String[] {
                "SecP256r1MLKEM768", "X25519MLKEM768", "secp256r1"
        });
        serverSocket.setSSLParameters(params);

        try (SSLSocket client = (SSLSocket) serverSocket.accept()) {
            client.startHandshake();
            System.out.println("Client connected using "
                    + client.getSession().getCipherSuite());
        }
    }
}
```

Since the JDK server picks the first key share offered by the client that is also enabled locally, a default JDK 27 client connecting to this server negotiates `X25519MLKEM768`, not `SecP256r1MLKEM768`, because the client never offered a share for the latter.

## Migration Considerations

- **JDK version and flags**: the feature is final in JDK 27 and requires no `--enable-preview`, no `--add-modules`, and no extra provider. Everything lives in `java.base`, in the `sun.security.ssl` package and the `SunJCE` ML-KEM implementation.
- **No code changes for the default case**: applications that do not call `SSLParameters::setNamedGroups` and do not set `jdk.tls.namedGroups` start offering `X25519MLKEM768` automatically. Applications that already pin a list of named groups are not affected until they add a hybrid name to that list.
- **Interoperability**: a peer that does not recognize code point 0x11EC ignores that key share and selects `x25519` (or another group) from the same `ClientHello`, with no extra round trip, because the JDK sends a classical share too. The JEP does not name specific servers or browsers; it states only that interoperability testing is performed against other TLS implementations that support hybrid schemes. If a legacy middlebox fails on the larger `ClientHello`, set `jdk.tls.namedGroups` to a classical list for that deployment, or exclude the hybrid group per socket via `SSLParameters`.
- **Third-party providers**: the hybrid implementation obtains its ML-KEM half through `KEM.getInstance("ML-KEM")`, so a third-party JCA provider registered ahead of `SunJCE` that implements ML-KEM will be used; fall-back paths from RAW to X.509 key encodings exist for providers that do not support `KeyFactory::translateKey` on raw keys.
- **The hybrid KEM is not a public API**: the `HybridAndDHAsKEM` provider is internal and never installed, so `KEM.getInstance("X25519MLKEM768")` fails from application code. A hybrid KEM outside TLS has to be composed by the application from `javax.crypto.KEM` with `ML-KEM` and an ECDH `KeyAgreement`.
- **Security configuration**: the hybrid groups are subject to the same algorithm constraints machinery as any other named group (`NamedGroup::isPermitted`), so they can be disabled centrally through `jdk.tls.disabledAlgorithms` in `java.security` if a policy requires it.

## Conclusions

The hybrid key exchange in JDK 27 closes the most urgent post-quantum gap for Java applications, the confidentiality of data in transit against future decryption, with zero code changes for the majority of deployments. A few concrete takeaways:

- **Upgrade and verify, rather than configure**: on JDK 27 the right first step is to run the existing application with `-Djavax.net.debug=ssl:handshake` against its real peers and confirm that `X25519MLKEM768` is negotiated where the peer supports it, and that the fallback to `x25519` works where it does not.
- **Pin named groups deliberately**: any configuration that already sets `jdk.tls.namedGroups` or `SSLParameters::setNamedGroups` silently opts out of the hybrid default; those lists should be revisited and the hybrid group added at the front.
- **Budget for the extra bytes, not the extra CPU**: the measurable change in the handshake is roughly 1.2 KB more in each direction; measure the CPU cost with the JDK's own `SSLHandshake` and `KEMBench` micro-benchmarks before assuming it matters.
- **Choose the NIST-curve hybrids only when a policy demands it**: `SecP256r1MLKEM768` and `SecP384r1MLKEM1024` exist for FIPS-oriented environments; for everything else the default is the interoperable choice.

In my humble opinion, the design is a good example of the JDK's incremental approach to post-quantum cryptography: JEP 452 delivered the KEM abstraction, JEP 496 delivered ML-KEM, and JEP 527 wires both into TLS without changing a single public API. It is recommended to adopt JDK 27 for any service that terminates or initiates TLS and whose data has a confidentiality lifetime measured in years.

## References

- [JEP 527: Post-Quantum Hybrid Key Exchange for TLS 1.3](https://openjdk.org/jeps/527)
- [JEP 452: Key Encapsulation Mechanism API](https://openjdk.org/jeps/452)
- [JEP 496: Quantum-Resistant Module-Lattice-Based Key Encapsulation Mechanism](https://openjdk.org/jeps/496)
- [JEP 497: Quantum-Resistant Module-Lattice-Based Digital Signature Algorithm](https://openjdk.org/jeps/497)
- [OpenJDK Source: NamedGroup.java](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/sun/security/ssl/NamedGroup.java)
- [OpenJDK Source: Hybrid.java](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/sun/security/ssl/Hybrid.java)
- [OpenJDK Source: HybridProvider.java](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/sun/security/ssl/HybridProvider.java)
- [OpenJDK Source: DHasKEM.java](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/sun/security/ssl/DHasKEM.java)
- [OpenJDK Source: KEMKeyExchange.java](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/sun/security/ssl/KEMKeyExchange.java)
- [OpenJDK Source: KeyShareExtension.java](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/sun/security/ssl/KeyShareExtension.java)
- [OpenJDK Source: KAKeyDerivation.java](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/sun/security/ssl/KAKeyDerivation.java)
- [OpenJDK Source: ML_KEM.java](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/com/sun/crypto/provider/ML_KEM.java)
- [OpenJDK Benchmark: KEMBench.java](https://github.com/openjdk/jdk/blob/master/test/micro/org/openjdk/bench/javax/crypto/full/KEMBench.java)
- [OpenJDK Benchmark: SSLHandshake.java](https://github.com/openjdk/jdk/blob/master/test/micro/org/openjdk/bench/java/security/SSLHandshake.java)
- [RFC 10024: Post-Quantum Traditional (PQ/T) Hybrid Key Agreement Mechanisms for TLS 1.3](https://www.rfc-editor.org/rfc/rfc10024)
- [RFC 9954: Hybrid Key Exchange in TLS 1.3](https://www.rfc-editor.org/rfc/rfc9954)
- [RFC 8446: The Transport Layer Security (TLS) Protocol Version 1.3](https://www.rfc-editor.org/rfc/rfc8446)
- [NIST FIPS 203: Module-Lattice-Based Key-Encapsulation Mechanism Standard](https://csrc.nist.gov/pubs/fips/203/final)
- [IANA: TLS Supported Groups registry](https://www.iana.org/assignments/tls-parameters/tls-parameters.xhtml#tls-parameters-8)

---

**Tags**: Java, JDK 27, TLS 1.3, JSSE, Post-Quantum Cryptography, ML-KEM, X25519MLKEM768, Hybrid Key Exchange, Key Encapsulation Mechanism, FIPS 203, Security, javax.net.ssl

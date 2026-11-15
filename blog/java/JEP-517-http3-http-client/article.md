# HTTP/3 in the Java HTTP Client: QUIC-Based Requests Without Head-of-Line Blocking

## Content

- [Introduction](#introduction)
- [The Limits of HTTP/2 over TCP](#the-limits-of-http2-over-tcp)
- [Enter HTTP/3 in the HTTP Client API](#enter-http3-in-the-http-client-api)
- [Technical Deep Dive](#technical-deep-dive)
- [Performance Analysis](#performance-analysis)
- [Practical Examples](#practical-examples)
- [Migration Considerations](#migration-considerations)
- [Conclusions](#conclusions)
- [References](#references)

## Introduction

🌐 This article covers the HTTP/3 support added to the `java.net.http.HttpClient` API in JDK 26 by JEP 517. It is addressed to Java developers who already use the HTTP Client API (introduced by JEP 321 in JDK 11) and want to understand what changes when a request is carried over HTTP/3, how the client decides which protocol version to use, and how the QUIC transport is implemented inside the JDK.

HTTP/3 (RFC 9114) is the successor of HTTP/2, standardized by the IETF in 2022. The main difference compared to its predecessors is the transport layer: instead of TCP, HTTP/3 runs on top of QUIC (RFC 9000), a multiplexed and encrypted transport built on UDP datagrams, with TLS 1.3 integrated directly into the handshake (RFC 9001). According to the JEP, HTTP/3 is already supported by most web browsers and deployed on about a third of all web sites.

The design goal of the JEP is to keep the API changes minimal. Application code that is agnostic to the protocol version continues to work unchanged, HTTP/2 remains the default, and HTTP/3 is strictly opt-in. The JEP explicitly lists as non-goals a public QUIC API, support for third-party secure-socket providers, a server-side HTTP/3 implementation, and any update to the legacy `java.net.URL` protocol handler, which remains HTTP/1.1 only.

## The Limits of HTTP/2 over TCP

HTTP/2 solved request multiplexing at the application layer: many concurrent streams share one TCP connection, and HPACK compresses the headers. Nevertheless, TCP delivers bytes strictly in order. When a single TCP segment is lost, every HTTP/2 stream on that connection has to wait until the segment is retransmitted, even if the lost bytes belonged to only one of them. This is called transport-level head-of-line (HOL) blocking, and it becomes visible mainly on networks with high packet loss, such as mobile links.

A second cost is connection setup. A secure HTTP/2 connection requires a TCP three-way handshake followed by a TLS handshake, performed sequentially. Additionally, a TCP connection is identified by the source and destination address tuple, so a client that changes network loses all its connections.

QUIC addresses these points at the transport level. Each QUIC stream is delivered independently, so a lost datagram only stalls the stream whose data it carried. The cryptographic handshake is part of the transport handshake, so a new connection is usable after one round trip (1-RTT), and the protocol allows resumed connections to send data in the first flight (0-RTT). Connections are identified by connection IDs rather than by addresses, which allows a connection to survive a change of client address. The JEP summarizes the expected benefits as potentially faster handshakes, avoidance of head-of-line blocking, and a more reliable transport in environments with high packet loss.

## Enter HTTP/3 in the HTTP Client API

From the API perspective, the changes are small. The `HttpClient.Version` enum gains a third constant, `HTTP_3`, and a request is sent over HTTP/3 by selecting that version either on the client or on an individual request:

```java
var client = HttpClient.newBuilder()
        .version(HttpClient.Version.HTTP_3)
        .build();

var request = HttpRequest.newBuilder(URI.create("https://openjdk.org/"))
        .version(HttpClient.Version.HTTP_3)
        .GET().build();
```

The request is then sent with the usual `send()` or `sendAsync()` methods. If the target server does not support HTTP/3, by default the request is transparently downgraded to HTTP/2 or HTTP/1.1.

The second API addition is the sealed interface `java.net.http.HttpOption<T>`, together with `HttpRequest.Builder.setOption(HttpOption<T>, T)` and `HttpRequest.getOption(HttpOption<T>)`. Options are typed key-value hints that an `HttpClient` implementation may use, ignore, or reject. The only option defined in JDK 26 is `HttpOption.H3_DISCOVERY`, whose value is one of the `Http3DiscoveryMode` constants:

- **`ANY`** (the default when no option is set): If no connection to the origin exists yet, the client may attempt both an HTTP/3 connection over QUIC and an HTTP/2 (or HTTP/1.1) connection over TLS/TCP and use the first that succeeds. Previously received Alternative Services (RFC 7838) information is used if available; otherwise a direct QUIC connection to the host and port of the request URI is attempted.
- **`ALT_SVC`**: Requests are sent over HTTP/1.1 or HTTP/2 until the server advertises an `h3` endpoint, typically in an `Alt-Svc` response header or an HTTP/2 `ALTSVC` frame; subsequent requests then switch to HTTP/3. No blind QUIC attempt is ever made.
- **`HTTP_3_URI_ONLY`**: The client only attempts an HTTP/3 connection at the authority of the request URI, without Alternative Services and without fallback. If the server does not answer over QUIC, the request fails.

An important note to make is that the option has no effect unless `HTTP_3` is selected as the preferred version on either the client or the request. In case of a redirect, the option is carried over to the new request.

Two new exception types complete the picture. `UnsupportedProtocolVersionException` is thrown when the client cannot support HTTP/3, for example when `HttpClient.Builder.build()` is called with `HTTP_3` as the preferred version but the configured `SSLContext` is not compatible with QUIC. `StreamLimitException` is raised when a multiplexed connection (HTTP/2 or HTTP/3) has exhausted its stream budget. Finally, `HttpResponse.PushPromiseHandler` gains an `applyPushPromise` overload and a `notifyAdditionalPromise` method that receive an HTTP/3 `PushId`, because in HTTP/3 one server push may be referenced from several client-initiated streams on the same connection.

## Technical Deep Dive

The implementation lives almost entirely in the `java.net.http` module, with the TLS part in `java.base`. All of it is pure Java; no native QUIC library is involved.

### Protocol selection and fallback

When a client is built, `HttpClientImpl` checks whether the configured `SSLContext` can be used with QUIC and whether `TLSv1.3` is among the enabled protocols. Only then is an `Http3ClientImpl` created. The code snapshot below is from [`src/java.net.http/share/classes/jdk/internal/net/http/HttpClientImpl.java`](https://github.com/openjdk/jdk/blob/master/src/java.net.http/share/classes/jdk/internal/net/http/HttpClientImpl.java):

```java
final boolean sslCtxSupportedForH3 = isQuicCompatible(sslContext);
if (version == Version.HTTP_3 && !sslCtxSupportedForH3) {
    throw new UncheckedIOException(new UnsupportedProtocolVersionException(
            "HTTP3 is not supported"));
}
// ...
// HTTP/3 MUST use TLS version 1.3 or higher
hasRequiredH3TLS = Arrays.asList(sslProtocols).contains("TLSv1.3");
// ...
boolean h3Supported = sslCtxSupportedForH3 && hasRequiredH3TLS;
// ...
client3 = h3Supported ? new Http3ClientImpl(this) : null;
```

The per-request decision is taken in `ExchangeImpl.get()` in [`src/java.net.http/share/classes/jdk/internal/net/http/ExchangeImpl.java`](https://github.com/openjdk/jdk/blob/master/src/java.net.http/share/classes/jdk/internal/net/http/ExchangeImpl.java). A request whose URI scheme is not `https`, or for which a proxy is selected, is never sent over HTTP/3; with `HTTP_3_URI_ONLY` such a request fails with `UnsupportedProtocolVersionException`, otherwise it is downgraded. For a secure, non-proxied request, `attemptHttp3Exchange()` implements the strategies described in the JEP. The comment in the source explains the difference between setting the version on the request and on the client:

```java
// If HTTP/3 is not specified explicitly on the request,
// we will start both an HTTP/2 and an HTTP/3 connection at the
// same time, and use the one that complete first. If HTTP/3 is
// specified on the request, we will give priority to HTTP/3 ond
// only start the HTTP/2 connection if the HTTP/3 connection fails,
// or doesn't succeed in the imparted timeout. The timeout can be
// specified with the property "jdk.httpclient.http3.maxDirectConnectionTimeout".
// If unspecified it defaults to 2750ms.
```

The parallel attempt (called "happy eyeball" in the code) is only started when `Http3ClientImpl.mayAttemptDirectConnection()` returns `true`:

```java
public boolean mayAttemptDirectConnection(HttpRequestImpl request) {
    var config = request.http3Discovery();
    return switch (config) {
        // never attempt direct connection with ALT_SVC
        case Http3DiscoveryMode.ALT_SVC -> false;
        // always attempt direct connection with HTTP_3_ONLY, unless
        // it was attempted before and failed
        case Http3DiscoveryMode.HTTP_3_URI_ONLY ->
                !hasNoH3(request.uri().getRawAuthority());
        // otherwise, attempt direct connection only if we have no
        // alt service and it wasn't attempted and failed before
        default -> lookupAltSvc(request).isEmpty()
                && !hasNoH3(request.uri().getRawAuthority());
    };
}
```

Source: [`src/java.net.http/share/classes/jdk/internal/net/http/Http3ClientImpl.java`](https://github.com/openjdk/jdk/blob/master/src/java.net.http/share/classes/jdk/internal/net/http/Http3ClientImpl.java)

The `noH3` set is a per-client negative cache: when a direct QUIC connection receives no reply to its first INITIAL packet within `jdk.httpclient.http3.maxDirectConnectionTimeout` (default 2 × 1375 ms, computed in `Http3ClientProperties`), the authority is recorded as not supporting HTTP/3 and later requests go straight to HTTP/2. Conversely, a successful direct connection registers an unadvertised `h3` entry in the `AltServicesRegistry`, so that later requests reuse it without racing.

Advertised Alternative Services are parsed by `AltSvcProcessor` from the `alt-svc` header or the HTTP/2 `ALTSVC` frame, following RFC 7838: advertisements from insecure origins, from `421 Misdirected Request` responses, or for a different origin than the connection's are ignored, and a new header value replaces all cached entries for that origin.

### QUIC in pure Java on top of DatagramChannel

The QUIC transport is implemented under [`src/java.net.http/share/classes/jdk/internal/net/http/quic/`](https://github.com/openjdk/jdk/tree/master/src/java.net.http/share/classes/jdk/internal/net/http/quic). The central class is `QuicEndpoint`, which encapsulates a `java.nio.channels.DatagramChannel`. It reads all available datagrams into a queue and dispatches each packet to the matching `QuicConnectionImpl` by connection ID; packets matching neither a connection nor a stateless reset token are discarded. Two polling strategies exist, selected by the internal property `jdk.internal.httpclient.quic.useNioSelector`: a non-blocking channel registered with an NIO `Selector`, or a blocking channel polled by virtual threads. The virtual-thread variant is the default except on Windows, where the selector is used to avoid a known WEPoll deadlock (JDK-8334574).

The channel is created with `IP_DONTFRAGMENT` set where the platform supports it, because QUIC requires unfragmented datagrams. The JEP states that Path MTU Discovery (RFC 8899) is not implemented in this first version; the client uses the configurable `jdk.httpclient.quic.defaultMTU` and advertises `jdk.httpclient.quic.maxUdpPayloadSize` to the peer, both constrained to the RFC 9000 range of 1200 to 65527 bytes.

`QuicConnectionImpl` is the per-connection state machine: it manages the packet number spaces (Initial, Handshake, Application), the loss detection and probe timeouts of RFC 9002, the local and peer connection ID managers, transport parameters, and stream multiplexing in the `quic/streams` package. Two congestion controllers are available, CUBIC (default) and Reno, chosen through `jdk.internal.httpclient.quic.congestionController`. QUIC v1 (RFC 9000) and v2 (RFC 9369) are both supported, with v1 preferred.

### TLS 1.3 integration with SunJSSE

QUIC does not use TLS records; it only consumes the TLS handshake messages and derives packet protection keys from the TLS secrets. The JDK therefore adds an internal `jdk.internal.net.quic.QuicTLSEngine` interface in `java.base`, exported only to `java.net.http`, and implements it in `sun.security.ssl.QuicTLSEngineImpl`. This is also the reason behind the non-goal regarding third-party security providers: `QuicTLSContext.isQuicCompatible()` requires an `SSLContext` backed by the SunJSSE `SSLContextImpl` with `TLSv1.3` supported. The code snapshot below is from [`src/java.base/share/classes/jdk/internal/net/quic/QuicTLSContext.java`](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/jdk/internal/net/quic/QuicTLSContext.java):

```java
public static boolean isQuicCompatible(final SSLContext sslContext) {
    boolean parametersSupported = isQuicCompatible(sslContext.getSupportedSSLParameters());
    if (!parametersSupported) {
        return false;
    }
    // ...
    final Object underlyingImpl = CONTEXT_SPI.get(sslContext);
    if (!(underlyingImpl instanceof SSLContextImpl ssci)) {
        return false;
    }
    return ssci.isUsableWithQuic();
}
```

It is worth mentioning that although the `KeySpace` enum defines a `ZERO_RTT` level, `QuicTLSEngineImpl.keysAvailable()` always returns `false` for it, and `PacketSpaceManager` carries the comment "currently we don't support 0-RTT". Therefore, the handshake of this first implementation is always 1-RTT, and early data is not sent.

### HTTP/3 framing, QPACK and streams

On top of a QUIC connection, `Http3Connection` opens the unidirectional control stream, sends the `SETTINGS` and `MAX_PUSH_ID` frames, and creates the QPACK encoder and decoder stream pairs. Each request/response exchange is an `Http3ExchangeImpl` bound to one bidirectional QUIC stream opened through `openNewLocalBidiStream()`. HTTP/3 frames are implemented under `http3/frames`, and header compression follows RFC 9204 in the `qpack` package. Only one ALPN value, `h3`, is offered during the TLS handshake.

HTTP/3 connections have their own pool, `Http3ConnectionPool`, keyed by origin. By default (`jdk.httpclient.http3.waitForPendingConnect=true`), concurrent requests to the same host wait for the first handshake to complete instead of opening parallel QUIC connections. Idle connections are closed after `jdk.httpclient.keepalive.timeout.h3` seconds, which falls back to the HTTP/2 setting and then to the general `jdk.httpclient.keepalive.timeout` (default 30).

## Performance Analysis

The JEP does not publish any benchmark numbers, and I did not find a JMH benchmark for the HTTP/3 client in the JDK tree. The expected effects therefore have to be reasoned qualitatively.

- **Handshake round trips**: A fresh HTTPS connection over TCP needs a TCP handshake and then a TLS 1.3 handshake. QUIC performs both in one exchange, so a fresh HTTP/3 connection is usable after a single round trip. Because 0-RTT is not implemented in JDK 26, resumed connections do not get the additional saving that QUIC allows.
- **Head-of-line blocking**: A lost datagram only delays the request whose bytes it carried. This matters mainly on lossy networks; on a low-loss data centre link the difference is generally small.
- **CPU cost**: The implementation processes individual UDP datagrams in Java, including packet protection and loss detection, instead of delegating segmentation and retransmission to the kernel TCP stack. A higher per-byte CPU cost than with HTTP/2 should be expected; the JDK does not quantify it.
- **Discovery overhead**: With the default `ANY` mode and no prior knowledge of the server, the client may open both a QUIC and a TCP connection for the first request and discard one of them. The JEP lists this explicitly as a trade-off of the parallel approach.

Rule of thumb: measure your own workload before switching; for high-latency or lossy client-side networks the transport benefits are likely to dominate, while for short server-to-server calls over reliable networks HTTP/2 remains a sound default.

## Practical Examples

All examples compile against JDK 26 without additional flags. The feature is final, not a preview, so no `--enable-preview` is required.

### Example 1: Requesting HTTP/3 and verifying the negotiated version

```java
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

public class Http3Minimal {
    public static void main(String[] args) throws Exception {
        try (HttpClient client = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_3)
                .build()) {
            HttpRequest request = HttpRequest.newBuilder(URI.create("https://openjdk.org/"))
                    .GET()
                    .build();
            HttpResponse<String> response =
                    client.send(request, HttpResponse.BodyHandlers.ofString());
            System.out.println("Status  : " + response.statusCode());
            System.out.println("Version : " + response.version());
        }
    }
}
```

`HttpResponse.version()` is the only reliable way to know which protocol was actually used, because the client may have downgraded transparently. A first request to a server not previously seen may print `HTTP_2` under the default `ANY` mode if the TCP connection wins the race; later requests to the same origin print `HTTP_3` once an `h3` endpoint has been registered. In a quick test I ran with JDK 26 against two public HTTP/3-enabled sites, the first request was indeed answered over `HTTP_2` and the second over `HTTP_3`.

### Example 2: Controlling discovery per request

```java
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpOption;
import java.net.http.HttpOption.Http3DiscoveryMode;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.List;

public class Http3Discovery {
    public static void main(String[] args) throws Exception {
        try (HttpClient client = HttpClient.newHttpClient()) {
            URI uri = URI.create("https://openjdk.org/");

            // Conservative: start on HTTP/2, switch only after an Alt-Svc advertisement
            HttpRequest viaAltSvc = HttpRequest.newBuilder(uri)
                    .version(HttpClient.Version.HTTP_3)
                    .setOption(HttpOption.H3_DISCOVERY, Http3DiscoveryMode.ALT_SVC)
                    .build();

            // Strict: fail if the server does not answer over QUIC at this authority
            HttpRequest strict = HttpRequest.newBuilder(uri)
                    .version(HttpClient.Version.HTTP_3)
                    .setOption(HttpOption.H3_DISCOVERY, Http3DiscoveryMode.HTTP_3_URI_ONLY)
                    .build();

            for (HttpRequest request : List.of(viaAltSvc, strict)) {
                HttpResponse<Void> response =
                        client.send(request, HttpResponse.BodyHandlers.discarding());
                System.out.println(request.getOption(HttpOption.H3_DISCOVERY).orElseThrow()
                        + " -> " + response.version());
            }
        }
    }
}
```

The client here is created with `newHttpClient()`, so its default version is HTTP/2, and HTTP/3 is enabled solely by the request-level `version(HTTP_3)`. The `strict` request throws an `IOException` if the origin does not run QUIC on the URI port, which is the intended behavior of `HTTP_3_URI_ONLY`.

### Example 3: Fallback-aware client with diagnostics

```java
import java.io.UncheckedIOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.UnsupportedProtocolVersionException;
import java.time.Duration;

public class Http3WithFallback {
    static HttpClient newClient() {
        try {
            return HttpClient.newBuilder()
                    .version(HttpClient.Version.HTTP_3)
                    .connectTimeout(Duration.ofSeconds(5))
                    .build();
        } catch (UncheckedIOException e) {
            if (e.getCause() instanceof UnsupportedProtocolVersionException) {
                // e.g. a non-SunJSSE SSLContext or TLSv1.3 disabled: stay on HTTP/2
                return HttpClient.newBuilder().version(HttpClient.Version.HTTP_2).build();
            }
            throw e;
        }
    }

    public static void main(String[] args) throws Exception {
        try (HttpClient client = newClient()) {
            HttpRequest request = HttpRequest.newBuilder(URI.create("https://openjdk.org/"))
                    .timeout(Duration.ofSeconds(10))
                    .build();
            for (int i = 0; i < 3; i++) {
                HttpResponse<Void> response =
                        client.send(request, HttpResponse.BodyHandlers.discarding());
                System.out.printf("request %d: %s %s%n", i, response.statusCode(), response.version());
            }
        }
    }
}
```

Running this with `-Djdk.httpclient.HttpClient.log=http3,quic:control:retransmit` prints the version selection and the QUIC packet flow through the `jdk.httpclient.HttpClient` platform logger, which the `java.net.http` module documentation recommends as a starting point for debugging.

For local testing, the JDK does not ship a public HTTP/3 server. The test tree contains a test-only `jdk.httpclient.test.lib.http3.Http3TestServer` under [`test/jdk/java/net/httpclient/lib/jdk/httpclient/test/lib/http3/`](https://github.com/openjdk/jdk/tree/master/test/jdk/java/net/httpclient/lib/jdk/httpclient/test/lib/http3), built on a `QuicServer` from the sibling `quic/` package. The client tests under [`test/jdk/java/net/httpclient/http3/`](https://github.com/openjdk/jdk/tree/master/test/jdk/java/net/httpclient/http3) (for example `GetHTTP3Test.java`) show how the JDK exercises the discovery modes against it. The JEP also lists the interoperability targets: Netty, quic-go, quiche, Neqo, and nghttp3.

## Migration Considerations

- **JDK version and flags**: HTTP/3 support is available from JDK 26 as a final feature of the `java.net.http` module. No `--enable-preview` or `--add-modules` flag is needed.
- **Default behavior is unchanged**: Existing code keeps using HTTP/2 with HTTP/1.1 fallback. Nothing is sent over QUIC unless `Version.HTTP_3` is selected on the client or the request.
- **TLS requirements**: HTTP/3 requires an `SSLContext` from the default SunJSSE provider with `TLSv1.3` enabled. Building a client with `version(HTTP_3)` and an incompatible context fails with `UnsupportedProtocolVersionException` wrapped in `UncheckedIOException`.
- **Only `https`, no proxies**: Plain `http` URIs and proxied requests are never sent over HTTP/3. With `HTTP_3_URI_ONLY` they fail; otherwise they are downgraded.
- **UDP must be reachable**: QUIC uses UDP, typically on port 443. Corporate firewalls, container network policies, and cloud security groups frequently allow only TCP. The default `ANY` mode still works thanks to the race with TCP, but every first request to a new origin pays for a QUIC attempt that times out after `jdk.httpclient.http3.maxDirectConnectionTimeout` (default 2750 ms); the authority is then remembered as not supporting HTTP/3 for the lifetime of the client. `ALT_SVC` avoids the blind attempt entirely.
- **Connection reuse**: `Http3ClientImpl` keeps a dedicated pool, independent of the HTTP/1.1 and HTTP/2 pools. When the server's QUIC stream limit is exhausted, the client waits up to `jdk.httpclient.http3.maxStreamLimitTimeout` for more credit before raising `StreamLimitException`.
- **Not yet supported**: 0-RTT early data, Path MTU Discovery, and HTTP/3 through proxies are not part of this first implementation. The JEP lists possible future enhancements, including HTTP/3-specific exception types and builder-level discovery configuration.
- **Tuning**: The QPACK dynamic table is disabled on the decoder side by default (`jdk.httpclient.qpack.decoderMaxTableCapacity=0`) and limited to 4096 bytes on the encoder side (`jdk.httpclient.qpack.encoderTableCapacityLimit`). Further `jdk.httpclient.quic.*` properties exist in `Http3ClientProperties`, `QuicEndpoint`, and `QuicConnectionImpl`, but most are undocumented implementation details that may change.

## Conclusions

HTTP/3 in the Java HTTP Client is a conservative addition: one enum constant, one option interface, two exceptions, and an otherwise unchanged programming model. The complexity sits in the internal QUIC, QPACK, and HTTP/3 packages implemented in pure Java on top of `DatagramChannel`, with TLS 1.3 served by an internal extension of SunJSSE.

A few concrete takeaways:

- **Opt in deliberately and verify**: Set `Version.HTTP_3` and always check `HttpResponse.version()` in integration tests; a downgrade to HTTP/2 is silent by design.
- **Choose the discovery mode according to the environment**: `ALT_SVC` is the safest choice for internet targets behind unknown firewalls, `HTTP_3_URI_ONLY` is appropriate for services you control and know to run QUIC, and `ANY` is a reasonable default when UDP egress is known to be open.
- **Keep expectations realistic for JDK 26**: Without 0-RTT and Path MTU Discovery, and with a user-space transport, the benefit is the removal of transport-level head-of-line blocking and one fewer handshake round trip, not a universal latency win.

In my humble opinion, the feature is ready to be evaluated in client-side applications that talk to HTTP/3-enabled CDNs or public APIs, especially over mobile or high-latency links. For server-to-server traffic within a data centre, I would stay on HTTP/2 until a measurable benefit is demonstrated for the specific workload.

## References

- [JEP 517: HTTP/3 for the HTTP Client API](https://openjdk.org/jeps/517)
- [JEP 321: HTTP Client (Standard)](https://openjdk.org/jeps/321)
- [OpenJDK: `java/net/http/HttpOption.java`](https://github.com/openjdk/jdk/blob/master/src/java.net.http/share/classes/java/net/http/HttpOption.java)
- [OpenJDK: `java/net/http/HttpClient.java`](https://github.com/openjdk/jdk/blob/master/src/java.net.http/share/classes/java/net/http/HttpClient.java)
- [OpenJDK: `java/net/http/HttpRequest.java`](https://github.com/openjdk/jdk/blob/master/src/java.net.http/share/classes/java/net/http/HttpRequest.java)
- [OpenJDK: `jdk/internal/net/http/HttpClientImpl.java`](https://github.com/openjdk/jdk/blob/master/src/java.net.http/share/classes/jdk/internal/net/http/HttpClientImpl.java)
- [OpenJDK: `jdk/internal/net/http/ExchangeImpl.java`](https://github.com/openjdk/jdk/blob/master/src/java.net.http/share/classes/jdk/internal/net/http/ExchangeImpl.java)
- [OpenJDK: `jdk/internal/net/http/Http3ClientImpl.java`](https://github.com/openjdk/jdk/blob/master/src/java.net.http/share/classes/jdk/internal/net/http/Http3ClientImpl.java)
- [OpenJDK: `jdk/internal/net/http/Http3ClientProperties.java`](https://github.com/openjdk/jdk/blob/master/src/java.net.http/share/classes/jdk/internal/net/http/Http3ClientProperties.java)
- [OpenJDK: `jdk/internal/net/http/Http3Connection.java`](https://github.com/openjdk/jdk/blob/master/src/java.net.http/share/classes/jdk/internal/net/http/Http3Connection.java)
- [OpenJDK: `jdk/internal/net/http/HttpQuicConnection.java`](https://github.com/openjdk/jdk/blob/master/src/java.net.http/share/classes/jdk/internal/net/http/HttpQuicConnection.java)
- [OpenJDK: `jdk/internal/net/http/AltSvcProcessor.java`](https://github.com/openjdk/jdk/blob/master/src/java.net.http/share/classes/jdk/internal/net/http/AltSvcProcessor.java)
- [OpenJDK: `jdk/internal/net/http/quic/QuicEndpoint.java`](https://github.com/openjdk/jdk/blob/master/src/java.net.http/share/classes/jdk/internal/net/http/quic/QuicEndpoint.java)
- [OpenJDK: `jdk/internal/net/http/quic/QuicConnectionImpl.java`](https://github.com/openjdk/jdk/blob/master/src/java.net.http/share/classes/jdk/internal/net/http/quic/QuicConnectionImpl.java)
- [OpenJDK: `jdk/internal/net/quic/QuicTLSContext.java`](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/jdk/internal/net/quic/QuicTLSContext.java)
- [OpenJDK: `sun/security/ssl/QuicTLSEngineImpl.java`](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/sun/security/ssl/QuicTLSEngineImpl.java)
- [OpenJDK: `java.net.http/module-info.java` (system properties)](https://github.com/openjdk/jdk/blob/master/src/java.net.http/share/classes/module-info.java)
- [OpenJDK tests: `test/jdk/java/net/httpclient/http3/`](https://github.com/openjdk/jdk/tree/master/test/jdk/java/net/httpclient/http3)
- [RFC 9114: HTTP/3](https://www.rfc-editor.org/rfc/rfc9114)
- [RFC 9000: QUIC: A UDP-Based Multiplexed and Secure Transport](https://www.rfc-editor.org/rfc/rfc9000)
- [RFC 9001: Using TLS to Secure QUIC](https://www.rfc-editor.org/rfc/rfc9001)
- [RFC 9002: QUIC Loss Detection and Congestion Control](https://www.rfc-editor.org/rfc/rfc9002)
- [RFC 9204: QPACK: Field Compression for HTTP/3](https://www.rfc-editor.org/rfc/rfc9204)
- [RFC 7838: HTTP Alternative Services](https://www.rfc-editor.org/rfc/rfc7838)
- [RFC 9369: QUIC Version 2](https://www.rfc-editor.org/rfc/rfc9369)

---

**Tags**: Java, JDK 26, HTTP/3, QUIC, HTTP Client, java.net.http, TLS 1.3, QPACK, Alt-Svc, Networking, UDP, Head-of-Line Blocking

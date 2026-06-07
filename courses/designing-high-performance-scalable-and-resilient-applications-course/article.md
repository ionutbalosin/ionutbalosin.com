# Designing High-Performance, Scalable, and Resilient Applications — Including AI-Powered Systems

## Description

Designing applications that are fast, scalable, and resilient is hard. Designing them when one of the components is a non-deterministic, billed-per-token LLM is harder. This course gives your engineers the metrics, tactics, patterns, and architectural styles to design high-performance, scalable, and resilient applications — including modern systems that embed AI components.

By the end of this course, candidates will have gained profound knowledge on designing and implementing high-performance, scalable, and resilient applications.

**Key concepts covered in this course**

- Different metrics are used to quantify performance, scalability, and resilience, such as response time, latency, throughput, percentiles, availability, etc.
- Various metrics employed to quantify performance, scalability, and resilience, including response time, latency, throughput, percentiles, availability.
- Architectural tactics and patterns that bolster high-performance, scalability, and resiliency, such as synchronous vs. asynchronous communication, polling, webhook, queue/topic, WebSocket, gRPC, GraphQL, server-sent events, data push vs. data pull, caching, retry mechanisms, circuit breakers, bulkheads, back pressure, throttling, and others.
- Modern architectural styles that may be employed in designing high-performance, scalable, and resilient applications, along with their respective advantages and disadvantages, such as microservices, event-driven architecture, reactive systems, serverless architectures.
- Networking components used to complement these architectural styles, such as API Gateways, load balancers, service discovery mechanisms, and content delivery networks.
- How the same quality attributes (performance, scalability, resilience) apply to systems that embed AI components, and the new dimensions they introduce: non-determinism, token cost as a runtime concern, hallucinations, latency budgets for external LLM calls, and prompt injection as a new attack surface.
- *Optional: advanced high-performance development techniques such as NUMA, large pages, C-states, CPU Governors, RamFS/TmpFS, SSD I/O Scheduler, Kernel TCP Buffers, etc.*

## What You Will Learn

By the end of this course, your engineers will be able to:

- Quantify performance, scalability, and resilience using the right metrics (response time, latency, throughput, percentiles, availability).
- Choose the right communication style — sync vs. async, polling, webhook, queue/topic, WebSocket, gRPC, GraphQL, server-sent events — for each interaction in the system.
- Apply caching, retry, circuit breaker, bulkhead, back pressure, and throttling where they actually help (and avoid them where they don't).
- Scale the data layer with read replicas, sharding, CDC, and search indexes.
- Compose API gateways, load balancers, service discovery, and CDNs into a coherent runtime topology.
- Pick — and justify with trade-offs — an architectural style: microservices, event-driven, serverless (BaaS/FaaS), or reactive.
- Design systems that embed AI components without losing control over cost, latency, accuracy, and trust boundaries.

## Agenda

**Architectural concepts. Quality attributes metrics**

- Modern Applications Capabilities
  - Elasticity
  - Performance
  - Resiliency
  - Modularity
- Quality attributes metrics
  - Response Time
  - Latency
  - Throughput
  - Availability

**Architectural Tactics**

- Synchronous vs Asynchronous
  - Polling
  - Webhook
  - Queue/Topic
  - WebSocket
  - gRPC
  - GraphQL
  - Server-Sent Events (SSE)
- Data Push vs. Data Pull
- Caching
  - Fetching strategies
  - Eviction Policies
  - Cache distribution (local/embedded vs. distributed)

**Architectural Patterns**

- Resilience Patterns
  - Retry
  - Circuit Breaker
  - Bulkhead
  - Back Pressure
  - Throttling
- Database Scalability Patterns
  - Database Read Replicas
  - Sharding
  - Change Data Capture
  - Search Index

**Networking Assets**

- API Gateway
- Load Balancer
- Service Discovery
- Content Delivery Network

**Architectural Styles**

- Microservices
  - Pros and cons, when to use, problems they might (or not) solve
  - Design principles
  - API Management
  - Backend-for-Frontend
  - Data Management (e.g., shared-nothing approach)
- Event Driven Architectures
  - Event structure and schema
  - Event vs. command
  - Event Carried State Transfer
- Serverless Architectures
  - Back-end as a Service (BaaS)
  - Function as a Service (FaaS)
  - How to use a FaaS to retry failed messages
- Reactive Systems
  - Design Principles
  - Reactive Programming vs. Reactive Systems

**Designing Systems with AI Components**

- Non-determinism as a quality attribute
- Token cost and latency budgets for LLM calls
- Hallucinations and trust boundaries
- Prompt injection as a new attack surface
- The Agentic Mesh

*Advanced development, and hardware optimisations techniques **(this is optional, only if there is a specific interest, but the overall course duration might be extended)***

- *Native Compilation*
- *Asynchronous Logging*
- *Marshaling / Unmarshaling (i.e., binary data format)*
- *Non-Uniform-Memory-Access (NUMA)*
- *Large Pages*
- *RamFS & TmpFS*
- *CPU C-States*
- *CPU Governors*
- *Memory Management: Swap*
- *Network IO: Kernel TCP buffers*

## Duration

- 16 hours

## Target Audience

- software developers
- technical leaders
- software/solution architects
- test engineers
- business analysts with a technical background or passionate about technology

## GitHub Repository

This [GitHub repository](https://github.com/ionutbalosin/ecommerce-app) supplements the course with practical examples, code snippets, and additional materials to enhance your learning experience.

## Attendees’ Feedback

“*Excellent course content helping me to understand a lot of things, from a very high level and abstract to a very deep and technical perspective.*”

“*I recommend this course if you want to get in touch with real technical topics. The trainer clearly explained to them, even for less technical people.*”

“*The trainer was very well prepared. He answered all of our questions, even if they were not really the subject of the training.*”

“*I liked more the advanced part about how to tune an application, outside of the programming language, to get better performance.*”

“*Interesting and informative course, presented by a trainer who knows a lot of stuff. I got a lot of ideas and techniques that I can use to build more efficient applications in my daily job.*”

## Delivery Format

- Available **online** (live, instructor-led) and **on-site** at your company location.
- Delivered **exclusively for companies, teams, or organized groups**.
- Hands-on workshops and exercises are adapted to your team's real-world scenarios.
- Individual (single-person) enrolment is not available at this time.

---

## Tags

high-performance, scalability, resilience, distributed-systems, microservices, event-driven-architecture, reactive-systems, serverless, baas, faas, api-gateway, load-balancing, service-discovery, cdn, circuit-breaker, bulkhead, back-pressure, throttling, retry, caching, semantic-caching, read-replicas, sharding, cdc, search-index, grpc, graphql, websocket, server-sent-events, webhook, polling, ai-systems, llm-systems, ai-components, agentic-mesh, token-cost, llm-latency, hallucinations, non-determinism, prompt-injection, corporate-training, on-site-training, online-training, instructor-led-training

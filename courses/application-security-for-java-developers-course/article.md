# Application Security for Java Developers Course

## Description

Most Java applications today are one prompt-injected log line or one over-permissive AI agent away from a breach. *Application Security for Java Developers* turns security from an afterthought into a first-class quality attribute — covering both the classic OWASP threat landscape and the new attack surface introduced by AI-augmented development and AI-powered systems.

In today’s rapidly evolving digital landscape, security is not just an optional consideration – it is a necessity. Every Java developer must incorporate security by design, ensuring that every line of code contributes to the overall security posture of the application. This is a comprehensive course crafted to transform how you approach coding, equipping you with the essential skills and knowledge to make security a first-class quality attribute in your software development process.

This course dives deep into the core principles of security, unraveling the complexities of designing robust, secure applications. You will explore a wide array of security concepts, from foundational principles to advanced security mechanisms and techniques. By the end of this course, you will have a profound understanding of security principles and practices, empowering you to implement them effectively in your Java projects.

## What You Will Learn

Throughout this course, you will master the essential security design principles such as least privilege and defense in depth, and learn how to apply them in real-world scenarios. You’ll delve into Java process security, covering critical topics like input validation, security logging, and managing CSP and CORS. The course also offers a thorough understanding of modern authentication and authorization mechanisms, including OAuth 2.0, and securing APIs and microservices with token introspection and JWKS. Additionally, you’ll gain practical skills to mitigate common attacks like SQL injection and XSS, and explore comprehensive security testing methods such as SAST, DAST, and SCA.

The course also covers the security implications of AI-augmented development and AI-powered systems: how AI agents inherit your permissions during development, how external content (issues, PRs, dependencies, web pages, MCP/tool output) becomes a new injection vector, and how to design trust boundaries around LLM components running in production.

## Agenda

**Security Design Principles**

- Least privilege
- Defense in depth
- Fail securely
- Compartmentalization

**Authentication and Authorization**

- OpenID Connect
- OAuth 2.0 Grant Types
  - Password Flow
  - Client Credentials Flow
  - Implicit Flow
  - Authorization Code Flow
  - Authorization Code Flow with Proof Key for Code Exchange (PKCE)
- Identify, Access, and Refresh Tokens

**API and Microservices Security**

- Token introspection
- JSON Web Key Set (JWKS)
- Role-Based Access Control (RBAC)

**Understanding the Topmost Common Attacks**

- SQL injection
- Prompt injection
- Cross-Site Scripting (XSS)
- Cross Site Request Forgery (CSRF)

**Best Practices to Mitigate Java Process Security Attacks**

- Secure Resource Access via UUIDs
- Input data validation and sanitization
- Handling input files from external sources
- Security logging best practices
- Content Security Policy (CSP)
- Cross-Origin Resource Sharing (CORS)
- HTTP security headers (e.g., Strict-Transport-Security, X-XSS-Protection, X-Frame-Options)
- Java deserialization

**Security Testing**

- Software Composition Analysis (SCA)
- Static Application Security Testing (SAST)
- Dynamic Application Security Testing (DAST)
- AI-specific evaluation: red-teaming for prompt injection, safety evals, guardrail testing

**Security in AI-Augmented Development and AI-Powered Applications**

- Prompt injection in depth — beyond SQL and XSS
- Untrusted content as an injection vector (issues, PRs, dependencies, web pages, MCP/tool output)
- MCP and tool permissions in the threat model
- Human-in-the-loop for destructive or high-impact actions
- Sandboxed AI development environments and credential hygiene

## Duration

- 14 hours

## Target Audience

- Java developers of all levels who are committed to writing secure code
- Technical leaders
- Software architects

## GitHub Repository

This [GitHub repository](https://github.com/ionutbalosin/java-application-security-practices) supplements the course with practical examples, code snippets, and additional materials to enhance your learning experience.

## Delivery Format

- Available **online** (live, instructor-led) and **on-site** at your company location.
- Delivered **exclusively for companies, teams, or organized groups**.
- Hands-on workshops and exercises are adapted to your team's real-world scenarios.
- Individual (single-person) enrolment is not available at this time.

---

## Tags

application-security, java-security, secure-coding, security-by-design, defense-in-depth, least-privilege, threat-modeling, owasp, owasp-top-10, sql-injection, xss, csrf, java-deserialization, input-validation, oauth-2, openid-connect, jwt, jwks, pkce, rbac, token-introspection, sast, dast, sca, software-composition-analysis, csp, cors, http-security-headers, ai-security, llm-security, prompt-injection, mcp-security, agentic-security, ai-augmented-development, corporate-training, on-site-training, online-training, instructor-led-training

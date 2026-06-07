# Taming AI Assistants: Practical Advice for Software Teams

## Content

- [Introduction](#introduction)
- [The Challenge](#the-challenge)
  - [Four Critical Gaps](#four-critical-gaps)
  - [The Solution](#the-solution)
- [Phase 1: Specification-Driven Development](#phase-1-specification-driven-development)
  - [Why Specifications Are Critical](#why-specifications-are-critical)
  - [Requirements Exploration with AI](#requirements-exploration-with-ai)
  - [Architectural Decision Records (ADRs) - AI Guard Rails](#architectural-decision-records-adrs---ai-guard-rails)
  - [Test Specifications First](#test-specifications-first)
  - [Specification Best Practices](#specification-best-practices)
- [Phase 2: Skills and Guardrails - Structured AI Context](#phase-2-skills-and-guardrails---structured-ai-context)
  - [What Are Skills?](#what-are-skills)
  - [Skill Structure](#skill-structure)
  - [Starting Small: Representative Skills](#starting-small-representative-skills)
  - [Skills Are Not Deterministically Invoked](#skills-are-not-deterministically-invoked)
  - [Enforcing Skills: Three-Layer Defense](#enforcing-skills-three-layer-defense)
  - [The Context Window Capacity Problem](#the-context-window-capacity-problem)
  - [Security: AI Agents Can Access Everything You Can](#security-ai-agents-can-access-everything-you-can)
  - [Security Checklist](#security-checklist)
- [Phase 3: Incremental Development - Small, Verifiable Steps](#phase-3-incremental-development---small-verifiable-steps)
  - [The Incremental Development Principle](#the-incremental-development-principle)
  - [The Red-Green Principle](#the-red-green-principle)
  - [CI/CD Integration](#cicd-integration)
  - [Anti-Patterns to Avoid](#anti-patterns-to-avoid)
  - [Strategic Investment: Reusable AI Infrastructure](#strategic-investment-reusable-ai-infrastructure)
- [AI Adoption Maturity: The Hidden Metric](#ai-adoption-maturity-the-hidden-metric)
- [Conclusions](#conclusions)
- [References](#references)

## Introduction

> After almost a year of using AI assistants daily on real production code (Java backends, Python scripts, AWS specific scripts, JVM performance work, conference prep), and watching how teams around me succeed or fail at adoption, I've put together some guides I wish I had when I started.

AI-powered coding assistants like GitHub Copilot, Claude, and GPT-5 have changed software development fundamentally — and incredibly fast. But success isn't about typing less code; it's about how you feed context, validate output, and keep the human in the loop.

**The key insight:** AI assistants are amplifiers. They amplify good practices (clear requirements, small changes, comprehensive testing) and bad practices (unclear specs, large batch changes) equally. The fundamental engineering principle still applies: garbage in, garbage out. AI just makes the feedback loop faster.

This article presents some guidelines that can potentially improve productivity while maintaining code quality. They are organized in three phases:
- Phase 1: Specification-driven development with AI
- Phase 2: Create reusable skills and guardrails  
- Phase 3: Develop incrementally with continuous validation

These guidelines also address two cross-cutting concerns that often get treated as afterthoughts: **security** (AI agents can read and act on everything you can) and **token economics** (the bill scales with adoption in ways that could surprise finance teams).

## The Challenge

Modern AI models have large context windows. Think of it as "conversation memory" where everything in the session is kept available to the model. Rough orders of magnitude, as of May 2026:
- Claude Sonnet 4: ~200K tokens (1M in extended beta)
- Claude Opus 4: ~200K tokens
- Gemini 2.5 Pro: ~1M–2M tokens
- GitHub Copilot Chat: depends on the selected model (typically 128K+ for GPT-4o / GPT-5 / Claude)

These numbers keep moving, so don't anchor on them. The point is that even a "huge" context fills up faster than you think once you load a real codebase plus skills, ADRs, and chat history.

**Context window** means your conversation's working memory. Each new conversation starts with empty context.

But large context alone isn't enough. Effective context needs relevance and structure. Without proper structure, identifying relevant code among hundreds of thousands of lines becomes the primary challenge.

### Four Critical Gaps

1. **Context Gap:** Without structure, AI might ignore existing patterns, violate security requirements, or break architectural decisions.

A practical warning about context capacity: as the conversation grows and approaches the model's context limit, reasoning tends to degrade and hallucinations become more frequent. When you notice this happening, restart the conversation with a fresh context.

Why? The attention mechanism has a recency bias. It tends to focus on the most recent messages and on the initial context, while details from the middle of a long conversation are more easily lost. Example: you define "use pattern X for feature Y" early in a long session. Many messages later, the AI forgets this constraint and generates code violating pattern X.

2. **Verification Gap:** AI-generated code can compile and pass tests but contain subtle runtime bugs. Generated code might implement basic functionality correctly but miss critical non-functional requirements like performance optimization, proper error handling, resource cleanup, or edge case coverage.

3. **Knowledge Silo Gap:** Developers keeping multi-week conversations with AI create team knowledge silos. When someone references "that decision we discussed," other team members are lost.

Solution: Document AI-driven decisions in shared project memory (`.ai/` folder with skills and session summaries) or in pull request descriptions. Treat AI conversations like pair programming and capture key decisions for the team.

4. **Cost Gap:** AI usage is billed by tokens, not by seats, as in traditional per-seat licensing. Once a team rolls out AI broadly, costs scale with how much context every developer pushes into every prompt and how many automated loops run in the background. Without governance, the bill can outrun the productivity gain (see the Uber case study later in this article).

### The Solution

Three-phase structured approach:
1. Specification-Driven Development: Capture requirements, constraints, verification criteria
2. Skills: Encode architectural decisions, security and compliance constraints, and company-wide IT policies as reusable context
3. Small, Feedback-Guided Incremental Development: Small, verifiable changes with solid automation

## Phase 1: Specification-Driven Development

### Why Specifications Are Critical

AI assistants need context explicitly. A well-crafted specification provides:
1. Input specification: What to build
2. Constraints: What to avoid  
3. Verification criteria: How to validate

There's a common misconception about AI and specifications. Many people believe that AI will somehow make specifications better or that we need "better specs for AI." But here's the reality: **AI doesn't change the nature of business requirements at all**. If you had crappy requirements from business before AI, why would you have better specifications with AI? The technology changed, but **the human factor didn't**.

The real problem isn't the AI. It's the humans defining what needs to be built. AI can help expand specifications, but the initial quality of requirements still depends on humans understanding the business problem, asking the right questions, and validating assumptions. AI cannot fix unclear business goals, missing stakeholder alignment, or incomplete domain knowledge.

AI is useful for *exploring* requirements once a human has framed the real problem: enumerating edge cases, stress-testing assumptions, drafting acceptance criteria. It is not useful for *deciding* what the business actually needs. Use AI as a thinking partner on top of clear intent, not as a substitute for it.

The human factor remains the crucial element in the specification phase. AI is a tool, not a replacement for clear thinking and good communication.

### Requirements Exploration with AI

**Prompt Strategy: Problem-First, Not Solution-First**

Don't say: *"I want you to implement [feature] with [technology]"*
Do say: *"I need [capability]. What are the possible options to implement this, and how should I approach it?"*

This "brainstorm mode" lets AI leverage its vast training to suggest approaches you might not have considered. Stating your desired solution upfront ("answer injection") artificially limits the scope of AI recommendations.

### Architectural Decision Records (ADRs) - AI Guard Rails

ADRs are not just documentation. They are **active guard rails** that keep AI solutions aligned with project decisions.

Why ADRs Matter More Than Ever for AI Development:
- Generic and reusable: once created, they apply across all features, projects, departments, etc.
- Consistency: AI is more likely to stay aligned with architectural decisions when they're explicitly in its context
- Compliance pressure: AI is less likely to violate constraints that are explicitly documented in its context
- Brainstorming boundaries: when exploring solutions, AI narrows suggestions toward compliant options

**Experimental Pattern: MCP (Model Context Protocol) Server for ADRs**

MCP is an open protocol introduced by Anthropic that lets AI clients (Claude Desktop, Claude Code, and a growing number of IDE integrations) connect to external "context servers" — small processes that expose documents, tools, or data to the model in a structured way.

Applied to ADRs, the idea is straightforward:

1. Store ADRs in a versioned, shared repository (the same one your team already reviews).
2. Run an MCP server that reads that repository and exposes ADRs as a resource (a few community implementations already exist; some teams write a thin in-house one).
3. Configure the AI client to connect to that server, so ADRs become available on demand instead of being pasted into every prompt.
4. The AI can then reference current ADRs while brainstorming or implementing, and you avoid drift between "what the doc says" and "what the AI was told last time."

Create ADRs early and update them as architectural understanding evolves. AI that references current ADRs generates compliant code from the first iteration, not the third revision.

Caveats to be honest about: The model can still ignore an ADR it just read. Treat MCP-served ADRs as a way to keep context fresh and centralized, not as a guarantee. The enforcement still belongs in pre-commit hooks and CI (see Phase 2).

One security caveat worth flagging here: If you run an MCP server on your machine, it runs with your permissions and can expose unnecessary data or tools to the model. Additionally, be aware of what each external MCP server you connect to actually does, especially third-party ones — they are a real attack surface, not just a convenience layer. We come back to this in the security section.

### Test Specifications First

Tests and test data are your validation foundation. Before writing a single line of implementation code, define comprehensive tests with solid, representative datasets.

**Test Data Requirements:**

1. Valid datasets: Represent real, comprehensive production scenarios
2. Edge cases: Boundary conditions, empty inputs, maximum values
3. Invalid inputs: Test error handling and validation logic
4. Performance datasets: Large volumes to validate scalability
5. Security test cases: Injection attempts, malformed data, authentication bypasses

Prepare test datasets before asking AI to implement features. When AI generates code, run it against your prepared data immediately. If tests fail, the data reveals exactly what AI misunderstood.

### Specification Best Practices

1. Iterative refinement: High-level ideas → AI expansion → human review
2. Constraint-first: Define what NOT to do
3. Verification-driven: Measurable acceptance criteria
4. Human validation checkpoint: AI generates specifications from prompts, but humans must read and validate before implementation

**Human-in-the-Loop Validation**

Even though AI explores requirements and generates detailed specifications from your prompts, never skip human validation:

- Read every AI-generated requirement: AI might misinterpret your intent
- Validate domain logic: AI lacks business context, so verify assumptions are correct
- Check completeness: Did AI miss critical edge cases or non-functional requirements?
- Watch for selective implementation: Even with detailed specifications, AI sometimes ignores certain aspects or requirements, implementing only parts of what was specified
- Approve explicitly: Only after human validation should specifications be passed to AI for implementation

> The wrong way: User prompt → AI generates spec → AI implements → human discovers wrong feature built

> The correct way: User prompt → AI generates spec → Human validates and corrects → AI implements correct feature

The validation step is **non-negotiable**. AI-generated specifications are drafts, not final requirements.

## Phase 2: Skills and Guardrails - Structured AI Context

### What Are Skills?

Skills are reusable, project-specific instruction sets that teach AI assistants about your codebase's patterns, conventions, and constraints. Think of them as "pre-loaded context" that persists across all AI interactions.

### Skill Structure

A well-designed skill has four components:

| Component | Purpose | Details |
|-----------|---------|---------|
| **Context (What)** | Define problem domain | What problem does this skill address?<br>Which part of the system does it apply to? |
| **Patterns (How)** | Document correct approaches | Correct methods and approaches<br>Sequence and order of operations<br>Decision criteria for different scenarios |
| **Constraints (What NOT to do)** | Define boundaries | Prohibited practices and anti-patterns<br>Security and performance boundaries<br>Validation requirements |
| **Verification (How to validate)** | Validation checklist | Review checklist for AI-generated code<br>Testing requirements<br>Compliance validation steps |

### Starting Small: Representative Skills

Don't create 20 skills on day one. Start with 3-5 focused skills covering different perspectives:

1. Development Patterns: Core technical patterns and architectural decisions (e.g., error handling, logging, resource management)
2. Requirements Quality: What makes a good specification from product perspective (completeness, clarity, acceptance criteria)
3. Test Coverage: Testing strategies, edge cases, and data requirements (QA perspective)
4. Security Guardrails: Common vulnerabilities to avoid (injection, authentication, secrets management)
5. Code Review Standards: What to verify before approval (patterns compliance, test coverage, security)

Start minimal, expand based on actual pain points. Each new production incident or recurring review comment is a candidate for a new skill.

### Skills Are Not Deterministically Invoked

Even with well-defined skills, LLMs don't consistently follow them. The same prompt can produce different results across runs: patterns are honored once and ignored the next time.

Why? LLMs use probabilistic sampling. Temperature settings, context window pressure, and model updates all affect adherence. In practice, expect a non-trivial rate of skill non-compliance, which is why automated enforcement matters more than the skill text itself.

### Enforcing Skills: Three-Layer Defense

Since AI behavior is non-deterministic, automate enforcement:

- Layer 1: Pre-commit Hooks
- Layer 2: CI/CD Pipeline Checks
- Layer 3: Runtime Validation

Layer all three for deterministic enforcement of non-deterministic AI behavior.

### The Context Window Capacity Problem

Your context window is finite. Like a human loading a new skill, every new piece of context pushes something else toward the edge of attention. When you load:
- Multiple skill files
- Multiple ADRs, MCP servers fetching data from different sources
- Current code base
- Conversation history

... you're approaching capacity limits. This is why:

1. Keep context window memory files small and focused
2. Use sub-agents with focused contexts for specialized tasks
3. Restart conversations before the context becomes saturated
4. Split skills by domain (frontend/, backend/, database/)

Different contexts for different tasks assigned to different agents. Don't ask the same agent to do architectural design AND detailed implementation. Flush the context between major phases.

### Security: AI Agents Can Access Everything You Can

AI assistants can read all files you have access to, including:
- Cloud provider credentials
- SSH private keys
- Environment secrets and configuration files
- Command history with embedded credentials
- Personal documents and system files

> Run AI in an isolated environment with limited access, potentially only to project code.

**Approach 1: Containers**
- AI runs in isolated container with restricted filesystem access
- Mount only project directory with necessary permissions
- Explicitly exclude sensitive directories
- AI cannot read secrets outside project scope

**Approach 2: Virtual Machines**
- Dedicated VM for AI-assisted development
- No sensitive files stored in development environment
- Transfer code only, never credentials

**Awareness: Untrusted Content as an Injection Vector**

AI agents don't only read your code. They also ingest issue trackers, pull request descriptions, third-party dependencies, web pages, documentation, and output from MCP servers and tools. Any of that content can contain instructions targeted at the model rather than at you (the classic example is hidden text inside a document or an issue saying "ignore previous instructions and do X").

The practical takeaway is not to memorize attack patterns, but to internalize one principle: **treat any external text the agent consumes as untrusted input**, the same way you would treat user input on a public web form. This matters more as agents gain tool-calling and shell access.

**Awareness: Tool and MCP Permissions Are Part of Your Threat Model**

Every tool, function, or MCP server you wire into your agent expands what the model can do on your behalf. A generic "execute any shell command" or "run arbitrary SQL" tool is convenient and dangerous — once the context is poisoned (see above), the agent can be steered into using it. Prefer narrowly scoped tools, audit the MCP servers you connect (especially third-party ones), and require explicit human confirmation for destructive or high-impact actions.

### Security Checklist

| **DOs** | **DON'Ts** |
|---------|------------|
| Isolate AI in containers/VMs | Run AI with full filesystem access |
| Mount only necessary directories | Give AI sudo/root privileges |
| Never paste credentials in prompts | Store secrets in code |
| Use environment variables | Delegate architectural or security decisions entirely to AI |
| Audit MCP servers and tools wired into the agent | Connect third-party MCP servers without reviewing their scope |
| Scope agent tools narrowly; require confirmation for destructive actions | Expose generic "execute anything" tools (shell, SQL, cloud) to the agent |
| Treat external content (issues, PRs, docs, web pages, tool output) as untrusted input | Assume content read by the agent is safe just because it lives in your repo or inbox |
| Conduct regular security audits | Skip rigorous human review of security-sensitive code |

## Phase 3: Incremental Development - Small, Verifiable Steps

### The Incremental Development Principle

Core principle: Make the smallest possible change that delivers value and is independently verifiable with immediate feedback loops.

Here's a critical warning. **Letting AI generate code for multiple features at once or in automated loops leads to hallucinations and bugs**. Without immediate validation after each small change, errors compound and become harder to detect. AI loses context coherence across large batch operations, producing code that compiles but violates requirements or introduces subtle logic errors.

> One small task → AI generates → Validate immediately → Next task. Never batch multiple features without validation checkpoints.

### The Red-Green Principle

When implementing features or fixing bugs, use the two-word pattern: "Red Green"

This instructs AI to follow test-driven development:
1. RED: Write a failing test that captures the requirement or bug
2. GREEN: Write minimal code to make it pass
3. Refactor: Clean up while keeping tests green

Why it works: The failing test proves you're solving the real issue before AI generates implementation code.

### CI/CD Integration

Automate validation in your continuous integration pipeline:
- Tests: unit, integration, and performance tests
- Coverage: minimum code coverage thresholds
- Security: dependency scans and secret detection
- Skills compliance: automated checks for the patterns and constraints your skills document (lint rules, custom AST checks, conventional commit checks, etc.)

Every pull request is validated before merge, catching issues early.

### Anti-Patterns to Avoid

**Big Bang Refactoring**: "Refactor entire system" leads to thousands of changed lines that are impossible to review. Break into smaller tasks instead.

**Big Bang Development**: "Implement 5 features at once" makes AI hallucinate, compounds errors, and becomes impossible to debug. Do one feature, validate, then next feature with immediate feedback loops.

**Context-Free Generation**: "Generate [feature] service" produces generic code that violates your patterns. Include skills, guardrails, and context from earlier sessions.

**Blind Trust in AI Tests**: Asking the AI to generate tests at the end of development tends to produce tests that confirm the wrong implementation. Use AI-generated tests as a starting point, but humans need to review them and add the critical cases the AI missed.

**Blind Production Trust**: Assuming AI-generated code and tests are production-ready is dangerous. Treat AI output as a first draft and always review before deploying to production.

**Line-by-Line Review Obsession**: Reviewing every single line of AI-generated code obsessively is not efficient. Understanding the structure, flow, and the main logic is sufficient.

**Regression by Deletion**: AI can accidentally delete or modify existing working functionality when implementing new features. This happens when AI lacks full context about existing code or doesn't understand dependencies between components. Always verify that existing functionality remains intact after AI changes.

### Strategic Investment: Reusable AI Infrastructure

Beyond individual tasks, **invest in guardrails** that scale across your organization:

- Company-wide ADRs: security policies, data privacy regulations, compliance requirements, and approved cloud providers — anything that applies across the entire organization or multiple departments.
- Reusable blueprints: backend service templates, frontend component libraries, infrastructure patterns, and deployment procedures shared across projects.
- Cross-project patterns: performance benchmarks, error handling standards, logging conventions, and API design principles.

**Why this matters:** Once created, these guardrails protect all AI-generated code, not just one project. A security ADR created today prevents vulnerabilities in many projects later. A performance pattern documented once guides AI decisions across all teams.

## AI Adoption Maturity: The Hidden Metric

Token usage tells you two different stories depending on the phase your team is in.

In the **learning phase**, token burn is a feature, not a bug. Exploring prompts, trying different models, building skills and ADRs, running experiments — all of this consumes tokens, and that's how teams figure out what actually works for them. Companies serious about AI typically give teams generous quotas during this phase so people aren't afraid to experiment.

In the **rollout phase**, the same behavior becomes a financial risk. What was cheap experimentation for ten engineers becomes a significant line item for a thousand. Without governance, broad rollout multiplies the cost of every inefficient prompt, every redundant context dump, every automated loop.

The mistake teams make is treating these two phases the same way. Either they cap usage too early and kill the learning, or they leave the tap open after rollout and get surprised by the bill.

**Strategic Response:** Implement token efficiency mechanisms before broad rollout:
- Use context compression and memory management
- Leverage skills and ADRs to reduce repetitive context
- Monitor token consumption with real-time alerts and per-engineer caps
- Build automation to minimize human-in-the-loop token burn

**The Uber Case Study:** In May 2026, Uber publicly disclosed it had exhausted its entire 2026 AI budget by April, just four months in, after rolling Claude Code out across thousands of engineers. The root cause, as reported, was a combination of broad rollout, heavy per-engineer usage, and internal leaderboards that incentivized maximum token consumption without governance or spending caps. (See the Forbes coverage in the references — verify the numbers there before quoting any specific figure.)

**The Threat:** Without efficiency mechanisms and governance, token budgets can be consumed in days or weeks once usage scales. Token billing doesn't behave like traditional per-seat licensing. Finance teams need visibility and control before organization-wide rollout.

## Conclusions

AI-assisted development doesn't replace software engineering discipline; it amplifies it, for better and for worse. Teams that invest in structured context, incremental validation, and reusable guardrails get real productivity gains. Teams that skip those foundations ship wrong implementations faster.

This is why AI forces us to be more organized, structured, and precise. Clearer specs, sharper constraints, explicit acceptance criteria — that discipline is what turns the amplifier in your favor instead of against you.

If there are only a few things to take away from this article:

1. Context beats cleverness. Specifications, ADRs, and skills are what keep AI output aligned with your system. Without them, you're just rolling dice on each prompt.

2. Small steps with automated verification. Incremental changes plus pre-commit hooks, CI checks, and tests turn non-deterministic AI behavior into a process you can actually trust.

3. Treat AI as a privileged user that also reads untrusted content. It can read what you can read and act with your permissions, and it ingests external text (issues, PRs, dependencies, web pages, tool and MCP output) that may carry instructions aimed at the model. Isolate it, restrict what it sees, scope its tools narrowly, and never paste credentials into prompts.

4. Watch the token economics. Without governance and efficiency mechanisms, budgets disappear quickly once AI is rolled out at scale. Monitor consumption and reuse context (skills, ADRs) instead of re-typing it into every conversation.

The rest is engineering as usual: clear requirements, small changes, good tests, honest reviews. AI just makes all of that more visible, faster.

## References

1. Janakiram MSV, [Uber Burns Its 2026 AI Budget In Four Months On Claude Code](https://www.forbes.com/sites/janakirammsv/2026/05/17/uber-burns-its-2026-ai-budget-in-four-months-on-claude-code/), Forbes, May 2026.

## Tags

ai, ai-assistants, github-copilot, claude, claude-code, gpt-5, llm, generative-ai, ai-coding, ai-engineering, prompt-engineering, context-engineering, mcp, model-context-protocol, adr, architectural-decision-records, skills, guardrails, spec-driven-development, test-driven-development, tdd, red-green, software-engineering, software-architecture, code-quality, code-review, ci-cd, pre-commit-hooks, devops, security, ai-security, prompt-injection, threat-model, sandboxing, containers, token-economics, ai-cost, ai-governance, ai-adoption, developer-productivity, best-practices, anti-patterns, practical-advice

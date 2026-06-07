# Software Architecture in the AI Era: What Doesn't Change, What Does

## Content

- [Introduction](#introduction)
- [The Two Faces of AI in Architecture](#the-two-faces-of-ai-in-architecture)
- [What Doesn't Change](#what-doesnt-change)
  - [Architecture Is About Capabilities, Not Behaviour](#architecture-is-about-capabilities-not-behaviour)
  - [The Architect's Real Job](#the-architects-real-job)
  - [Understanding Is the Hard Part](#understanding-is-the-hard-part)
  - [Macro Patterns Stay, Micro Patterns Dilute](#macro-patterns-stay-micro-patterns-dilute)
- [Don't Trust Its Answers, Trust Its Questions](#dont-trust-its-answers-trust-its-questions)
  - [Why AI Is Not Always Good at Architectural Decisions](#why-ai-is-not-always-good-at-architectural-decisions)
  - [AI Defaults to Complexity](#ai-defaults-to-complexity)
  - [AI Converges Toward the Mean](#ai-converges-toward-the-mean)
  - [Use AI as a Thinking Buddy for Gap Analysis](#use-ai-as-a-thinking-buddy-for-gap-analysis)
- [What Changes: The New Architectural Capabilities](#what-changes-the-new-architectural-capabilities)
  - [From Determinism to Non-Determinism](#from-determinism-to-non-determinism)
  - [Reproducibility of the SDLC Itself](#reproducibility-of-the-sdlc-itself)
  - [Cost Becomes a Runtime Concern](#cost-becomes-a-runtime-concern)
  - [Accuracy and Hallucinations](#accuracy-and-hallucinations)
  - [Trust Boundaries and the New Attack Surface](#trust-boundaries-and-the-new-attack-surface)
- [The PoC-to-Production Chasm](#the-poc-to-production-chasm)
- [The Agentic Mesh](#the-agentic-mesh)
- [Where AI Actually Helps the Architect](#where-ai-actually-helps-the-architect)
  - [Diagrams Generated from the Code](#diagrams-generated-from-the-code)
  - [Querying Legacy and Large Codebases](#querying-legacy-and-large-codebases)
  - [Fitness Functions as Fast Feedback](#fitness-functions-as-fast-feedback)
  - [AI Compensates the Architect's Technical Depth](#ai-compensates-the-architects-technical-depth)
- [Conclusions](#conclusions)
- [Final Thoughts](#final-thoughts)
- [References](#references)

## Introduction

> 📚 This article discusses how software architecture practice is affected by the rise of AI: both as a tool that supports the architect, and as a component that runs inside the systems we design. It is based on my observations of designing and reviewing systems that either embed AI or rely on AI tooling during construction.

In the previous article, [Taming AI Assistants: Practical Advice for Software Teams](https://ionutbalosin.com/2026/05/taming-ai-assistants-practical-advice-for-software-teams), the focus was on how individuals and teams should *code* with AI. This article zooms out one level and looks at how we *design systems* in a world where AI sits on both sides of the architect's desk — as a tool that helps us think, and as a component that ends up running inside the products we ship.

AI is an amplifier. It amplifies good architecture by closing feedback loops faster, but it also amplifies poor architecture by hiding complexity, defaulting to over-engineered solutions, and introducing probabilistic behaviour into systems that were never designed for it.

The job of the architect is to keep that amplifier pointing in the right direction.

## The Two Faces of AI in Architecture

AI appears in an architect's work in two distinct ways, and the two have very little in common:

1. **AI as a tool for the architect.** Generating diagrams, drafting ADRs, exploring trade-offs, summarising legacy codebases, writing fitness function code, and so on. The output is consumed by humans, and mistakes should be caught in review.

2. **AI as a component inside the system.** Running in production, handling user input, making decisions, generating content, calling tools, and invoking other AIs. The output is consumed by the system itself or by end users, and mistakes surface as incidents (e.g., mistakenly deleting production database records), lawsuits, or unhappy customers.

These two faces require different mental models, different governance, and different sets of trade-offs.

## What Doesn't Change

Before talking about what's new, it helps to be honest about what isn't.

### Architecture Is About Capabilities, Not Behaviour

Design is about behaviour, architecture is about capabilities. Behaviour can emerge over time.

_Example:_ Incrementally, a team can ship a roller skate, then a bicycle, then a car, refining the design as it learns. Capabilities cannot emerge in the same way. A roller skate scaled up is not a car, and a single-tenant CRUD application that has evolved gradually does not turn into a platform serving 200,000 concurrent users.

This matters because AI is, by construction, very good at producing behaviour and not that good at implementing capabilities. When an LLM is asked to *implement a checkout endpoint*, it will produce working behaviour quickly and with reasonable quality. But prompted to *design a checkout system that scales to ten million transactions per day with sub-100ms p99 latency and graceful degradation when the payment provider is down*, it will still produce code that looks reasonable, but the *capabilities* will be accidental at best.

This is also why *vibe coding* is acceptable for prototypes but could become a threat for production systems. Vibe coding optimises for behaviour. The non-functional properties — security, scalability, elasticity, observability, cost predictability — are exactly what AI is poor at producing without explicit prompting. They are also exactly what an architect is paid to think about.

### The Architect's Real Job

The fundamentals haven't changed much in the AI era:
- Understanding the problem deeply enough to ask the right questions
- Mapping that problem onto a set of trade-offs between competing capabilities
- Choosing the **most suitable solution** given the constraints
- Communicating that solution to humans — developers, product, stakeholders, operations

AI cannot do any of this on behalf of the architect. It can help with parts of the process and make them faster, and it can act as a thinking buddy that explores possible options alongside the architect. Nevertheless, the architectural decisions themselves should not be dictated by the LLM. The moment they are outsourced to the LLM, the activity is no longer architecture — it is dictation.

### Understanding Is the Hard Part

The bulk of architectural work has never been writing things down. The dominant cost has always been *understanding* — understanding the problem, the domain, the stakeholders, the constraints, and the failure modes. Arguably, this is the part of the role that AI accelerates the least, because no amount of generated text replaces the act of building a mental model of a system that does not yet exist.

This matters because AI is genuinely fast at producing artefacts — diagrams, ADRs, specifications, pattern-driven implementations. People often mistake the speed of producing artefacts for the speed of producing understanding. They are not the same thing. An ADR generated in seconds by AI and an ADR understood by the architect are two different deliverables, even when the text is identical.

The practical consequence is that the feedback loop the architect should be optimising is not *time to first diagram* or *time to first PoC*, but *time to shared understanding* across the people who will build and operate the system. AI helps with both. The latter is still a human activity.

### Macro Patterns Stay, Micro Patterns Dilute

Not all technical knowledge ages the same way in the AI era. Macro-level patterns — integration patterns, distributed system patterns, consistency and availability trade-offs, sync vs async communication, choreography vs orchestration, saga, CQRS, event sourcing, outbox, strangler, BFF, and so on — remain firmly in the architect's domain. They describe how independent systems collaborate, where the boundaries of consistency lie, and which failure modes are acceptable.

What clearly dilutes is the micro layer. Gang of Four patterns and the broader catalogue of OOP idioms — visitor, decorator, factory hierarchies, etc. — used to be a meaningful part of a senior engineer's mental toolkit. In a world where code is increasingly generated, refactored, and restructured by AI on demand, the value of memorising these patterns drops. The model applies them when appropriate and replaces them when a simpler structure fits better. 

Depth at the macro level becomes more valuable; depth at the micro level becomes commoditised.

## Don't Trust Its Answers, Trust Its Questions

### Why AI Is Not Always Good at Architectural Decisions

To understand why, it helps to recall how LLMs work. They are statistical matching machines. When asked *how do I configure Kubernetes ingress for path-based routing*, there is a large corpus of nearly identical solutions available on the internet, and the model returns a high-confidence answer that is usually correct.

When asked *should we use Kubernetes here*, the model is trying to match against a problem that has never been solved before in exactly this shape — the specific domain, the team's experience, the operational maturity, the existing infrastructure, the compliance requirements, the budget, the timeline. No corpus contains the right answer for *that* combination, because *that* combination is unique.

It is worth mentioning that a growing practice in larger companies is to feed the LLM with internal context: existing ADRs, Confluence pages, internal policies and regulations, and other relevant artefacts produced in-house. Once that context is in place, the LLM has a much better grasp of the local constraints and can produce architectural recommendations that are noticeably closer to the actual situation.

Otherwise — without that context — the model returns its answer with the same level of confidence it had for the ingress question.

Nevertheless, that same context comes with a trap of its own. If existing ADRs prescribe only microservices as an architectural pattern and Java with Spring and Angular as the technology stack, the LLM will keep recommending microservices using Java with Spring and Angular for every new initiative, even when better alternatives might fit. ADRs used as guardrails ossify if they are not revisited regularly — and keeping that loop alive is itself part of the architect's job.

> 🔥 AI is useful when the problem has been solved multiple times, or when the model has been provided with rich, regularly maintained context (existing constraints, ADRs, company decisions, and so on). It becomes dangerous when the problem has been solved zero times and not enough context is provided — and, in practice, the hardest architectural problems sit in that category.

### AI Defaults to Complexity

There is another subtler issue. When AI does produce an architectural recommendation, it tends to drift toward complexity. Not because complexity is correct, but because the training corpus is dominated by enterprise vendor solutions, hyperscaler reference architectures, and consultancy whitepapers — none of which optimise for *the simplest thing that could possibly work*.

It is therefore the architect's responsibility to push back. The default output is rarely the right answer. The right answer is usually two or three layers simpler, and it has to be requested explicitly.

### AI Converges Toward the Mean

Closely related to the complexity bias is a more uncomfortable property: LLMs produce, by construction, statistically average answers. The model has been trained on a vast corpus, and its output reflects the central tendency of that corpus. For well-solved problems this is exactly what is wanted, because *average* in those areas is often good enough. For anything that is supposed to differentiate a product or a system, *average* is precisely the wrong target.

A practical heuristic that works in my experience: if an LLM, given a reasonable description of the problem, can independently propose the architecture being considered, that architecture is unlikely to constitute a meaningful differentiator. The real differentiator of a system — what makes it stand out in a market where everyone has access to the same tools — usually comes from decisions the LLM would not have proposed on its own — decisions made deliberately by the architect.

This does not make AI less useful. It clarifies where it is useful: as an accelerator for the commoditised parts of the system, and as a probe for identifying which parts are actually differentiated. A useful observation, in the spirit of Moravec's paradox, is that anything an AI can easily produce is unlikely to remain economically valuable for long — since anyone else with the same tools can produce it too. This means the parts of the system worth investing the most architectural attention in are precisely the ones the model would not have written on its own.

### Use AI as a Thinking Buddy for Gap Analysis

Where AI is genuinely useful in architectural work is in generating questions and broadening the horizon of thinking by surfacing alternatives — some good, some bad.

If the model is asked for ten pieces of advice on a design, many of them will be obvious or incorrect. However, a few of them might surface a risk that was not considered, a failure mode that was missed, or a trade-off that was assumed away. That is the real value. The model has been exposed to more architecture documents than any single human will read in a lifetime, and it can act as an on-demand checklist generator.

A concrete practice that works in my experience:
- Draft the design or ADR first, without AI input.
- Then provide it to the model and ask: *what is missing, what failure modes have not been addressed, what assumptions have not been validated, and what would a hostile reviewer point out?*
- Treat the response as a list of questions to investigate, not as a set of answers to accept.

This inverts the default flow. Instead of *AI proposes, human reviews*, the flow becomes *human proposes, AI critiques*. The architectural responsibility remains with the architect.

## What Changes: The New Architectural Capabilities

When AI becomes a component inside the system you're designing, a set of classical architecture capabilities gains new dimensions, and a few new ones appear.

### From Determinism to Non-Determinism

For decades, software engineering assumed deterministic computation: given the same input, the same output is produced. AI breaks this assumption. Temperature, sampling strategy, and even the model version can all cause the same prompt to produce different responses.

This is not a defect. The non-determinism is what makes the model creative — and useful. The architectural implication is that systems built around AI components must be designed to tolerate variability rather than assume it away.

### Reproducibility of the SDLC Itself

The non-determinism discussed above is usually framed as a runtime concern — the model behaves differently from one call to the next in production. There is, however, a less obvious consequence: the *construction* of the system itself becomes non-deterministic when AI agents participate in writing, reviewing, and testing the code.

In practice, running the same plan against several agents — or even several runs of the same agent, with identical starting code and prompts — produces meaningfully different results: different file structures, different abstractions, different test coverage, and sometimes different interpretations of the same requirement. This is not a defect of any particular tool; it is intrinsic to how these systems operate.

The architectural implication is that reproducibility shifts from being a property of the *binary* (same source, same build, same artefact) to being a property of the *specification*. The source of truth has to move upstream — into specifications, fitness functions, and tests that are themselves deterministic and reviewable — because the code that satisfies them will increasingly be a regenerable artefact rather than a hand-crafted one.

### Cost Becomes a Runtime Concern

Classical capabilities — performance, scalability, availability — all had cost implications, but cost was largely a capacity-planning concern handled at deployment time. With AI components, cost becomes a runtime variable that scales with actual consumption. It is worth mentioning that the industry is also shifting from *per-seat* licensing — a fixed, predictable cost per user — to *per-token* (or *per-request*) pricing, which has direct architectural consequences: cost has to be observed, attributed, and capped at runtime rather than negotiated once a year.

A few aspects worth highlighting:
- Frontier models are no longer cheap. Early per-token pricing was kept low while providers competed for adoption; in 2026 the trend is clearly upward, especially for reasoning models and long-context windows.
- Adding guardrails, evals, and self-correction doubles or triples the token bill per request.
- Caching helps, but only certain patterns are cacheable, and cache invalidation in AI systems is a discipline in its own right.

Reasoning models sharpen this problem considerably. Behind a single user question, a modern reasoning model can emit thousands of internal *thinking* tokens before producing the final answer — tokens that are billed but never visible to the user. The bill per request stops being linear in *the question asked* and becomes a function of *how hard the model decided to think*. Token observability is no longer an operational checkbox; it is an architectural capability — without it, cost can spike exponentially without any visible change in user behaviour.

### Accuracy and Hallucinations

Hallucinations are not a defect — they are the same mechanism that makes the model useful. They can be reduced, grounded in retrieved context, constrained by output schemas, and verified by evaluators. They cannot be eliminated.

This forces a new architectural question: **what does the system do when the AI is wrong?** The relevant word here is *when*, not *if*. A few possible answers are:
- Provide a deterministic fallback path that is always available.
- Display confidence indicators to users and let them verify the output.
- Pass the output through a second model that performs a check.
- Constrain the output format so that an incorrect response is at least syntactically valid.
- Make the AI's contribution advisory rather than authoritative.

Every AI-touched feature requires an explicit *wrong answer* design. Treating the model as a non-deterministic, privileged dependency under someone else's control means guardrails, evals, and observability are not features added later — they exist from day one or they do not exist at all.

### Trust Boundaries and the New Attack Surface

In traditional architecture, security boundaries are deterministic: input is sanitised at the gateway, tokens are validated, authorisation is enforced at the data layer, and the execution path past those checks is predictable.

AI components break this model. When an LLM sits inside the execution path — especially in an agentic system where models invoke tools, query databases, and trigger workflows — the user's input is no longer just data. It becomes part of the instruction stream that drives tool calls. *Prompt injection*, in this context, is the agentic-era equivalent of code injection: an attacker who controls a piece of the prompt can steer which tools the agent decides to invoke, with which arguments, and against which systems of record.

The architectural consequence is that perimeter security is no longer sufficient. A few principles worth observing:
- Never give an AI component direct, unmediated write access to a system of record. Every tool invocation should pass through a deterministic authorisation layer that the model cannot bypass.
- Treat the model's output as untrusted by default, especially when that output is fed into other tools, parsed as commands, or rendered in interfaces that could execute it.
- Assume that any context the model has seen — system prompts, retrieved documents, prior turns — can be exfiltrated through a sufficiently crafted input.
- Treat markdown-based instructions to agents (rules in `AGENTS.md`, `CLAUDE.md`, system prompts) as advisory only. The model follows them most of the time and ignores them the rest.

Security in AI-touched systems shifts from *validating inputs at the gate* to *isolating data flows between models, tools, and systems of record*. As with guardrails and evals, this discipline exists from day one or it does not exist at all.

## The PoC-to-Production Chasm

This is, in my humble opinion, the single most expensive lesson teams learn in AI projects.

Every AI feature has an attractive demo. A prompt, an API call, a response. A few minutes of work, product is satisfied, and the feature is declared ready to ship.

The actual production path is considerably more complex. Management is often trapped by the *mirage of simplicity* after seeing a polished prototype, and the architect's role is to set proper expectations from the start — before commitments are made on timelines or budgets that assume the demo and the system are the same thing.

> ⚠️ The AI-generated PoC is not the system. The PoC is roughly 5% of the system. The remaining 95% is what an architect is paid to design.

A related observation is that AI also creates a new category of code that does not fit cleanly into either the *PoC* or the *production system* bucket: **disposable scaffolding**. This includes one-off scripts, internal developer tools, ad-hoc evaluators, throwaway prototypes, and exploratory data pipelines. A significant share of the code produced by an AI-assisted team falls into this category. It is useful, it accelerates learning, and it should not be held to the same architectural standards as production code — but it should not be confused with it either.

It is also worth noting where inside that 95% the AI tends to struggle the most. The classical *90/10* rule of software engineering — the first 90% of a system takes 90% of the time, and the last 10% takes the other 90% — applies with renewed force in AI-assisted projects. AI accelerates the first 90% considerably, where the problem is well-understood and the patterns are common. The remaining 10% — the non-idiomatic edge cases, the platform-specific quirks, the integration with legacy systems, the performance corners — is precisely where the model reverts to the mean and starts working against the team. This is where the architect's involvement matters the most, because the team that misjudges this distribution will commit to deadlines based on the speed of the first 90% and discover the second 90% only after the demo has already been shown to leadership.

## The Agentic Mesh

For systems where AI is a cross-cutting concern, the Agentic Mesh is, in my humble opinion, the most coherent pattern available today.

It is worth recalling the Data Mesh pattern: instead of routing all analytics through a central warehouse, each domain owns its operational data *and* publishes an analytical data product, connected to a global analytical fabric. The operational and analytical architectures coexist, loosely coupled.

The same idea applies to AI. Each domain service has an **AI sidecar** that contains its own RAG store, its own guardrails, its own evals, its own prompt templates, and its own scoped credentials. Shared resources — large foundation models, global eval infrastructure, organisational policy guardrails — sit in a central control plane and are consumed by the sidecars.

The result is three overlaid architectures:
- The **operational** architecture (services, APIs, databases).
- The **analytical** architecture (data products, warehouses, BI).
- The **AI** architecture (sidecars, guardrails, evals, models).

![Agentic Mesh.svg](https://raw.githubusercontent.com/ionutbalosin/ionutbalosin.com/main/blog/architecture/software-architecture-in-the-ai-era-what-doesnt-change-what-does/Agentic_Mesh.svg)

*Agentic Mesh, minimal view: the trio (service, data product, AI sidecar) is owned and repeated per domain; the analytical fabric and the AI control plane are shared across domains.*

They are loosely coupled, individually evolvable, and have clear ownership boundaries. This pattern is still maturing in 2026, but it avoids the two failure modes seen most often in practice: a giant central AI monolith on one side, and a chaos of per-team improvisations on the other.

## Where AI Actually Helps the Architect

The discussion so far has been mostly cautious about AI in the architect's role. There are, however, a few areas where the value is clear and consistent.

### Diagrams Generated from the Code

Architectural diagrams have historically suffered from one persistent problem: they go out of date the moment they are drawn. Boxes and arrows on a wiki page describe a system that existed six months ago, not the one currently in production. With AI, that gap closes significantly. The model can ingest the codebase and produce component diagrams, sequence diagrams, and dependency graphs that reflect the actual structure of the system at the moment the question is asked.

An important note to make is that this works well *inside* a single system, where the source of truth is the code itself. What does not work reliably is *inter-system communication* — the moment the diagram has to cross repository, team, or organisational boundaries, the AI lacks the context to reconstruct it on its own. That gap is precisely where the architect's role remains essential: maintaining the cross-system view that no single codebase exposes.

### Querying Legacy and Large Codebases

Understanding a large or legacy codebase used to be one of the most expensive activities in an architect's work, and it depended heavily on senior engineers who carried the system's history in their heads. With AI, this changed fundamentally. The legacy source code can be fed to the model and queried directly; the answers come back in seconds or minutes.

This does not remove the need for experienced engineers, but it removes the single point of failure that comes from having knowledge only in individual heads. It also makes onboarding into unfamiliar systems significantly faster, which is one of the most underrated wins of AI in architectural work.

### Fitness Functions as Fast Feedback

An architectural fitness function is any mechanism that provides an objective check on an architecture characteristic — cyclic dependency tests, layer-violation tests, runtime latency budgets, chaos engineering experiments. The essence of agility in architecture is not the absence of architecture; it is *fast feedback when the architecture changes*.

This is where AI delivers one of its most consistent wins. The constraint is written once in a near-English ADR and the LLM translates it into concrete test code for each platform in the stack. The ADR remains the source of truth; the test code is generated, regenerable, and consistent across platforms. The task aligns exactly with what LLMs are best at: turning a precise specification into idiomatic code in a well-known framework.

### AI Compensates the Architect's Technical Depth

The architect's classical contribution has always been breadth, judgement, communication, and the cross-system view, rather than the deepest possible mastery of any single technology or programming language. With AI in the loop, the architect's leverage grows significantly. The depth that used to require years of hands-on coding to acquire — language idioms, framework specifics, low-level implementation details — can now be delegated to the model.

In practice, an architect with strong communication skills, a broad understanding of the systems involved, and AI as a depth amplifier can produce significantly more, and at higher quality, than the same architect could in the pre-AI era.

## Conclusions

AI does not replace software architecture — the classical patterns still apply, and will continue to.

What changes is the discipline required to keep AI-touched systems honest. Specifications need to be sharper, because the AI will fill in any vagueness with confidently incorrect output. Tests need to assert capabilities and not only behaviour, because the AI is good at producing plausible behaviour without the underlying capabilities. Cost needs to be observable in real time, because token bills do not behave like server bills. Security needs to be enforced through deterministic guardrails around the model, because the model itself cannot be trusted to defend the perimeter it sits inside.

This is the same point made in the previous article on AI assistants for coding, one level higher: AI is an amplifier. It amplifies architectural discipline, and it also amplifies architectural sloppiness — at a speed and scale that previous tools did not match. The teams that will benefit most from AI in the next few years are not the ones experimenting hardest with new models; they are the ones whose architectural fundamentals were already strong and who are now closing the feedback loops faster than their competitors.

## Final Thoughts

If only a few items are retained from this article, the following are the most important:

1. **What doesn't change.** Architecture is still about capabilities, not behaviour; understanding the problem is still the hard part; the architectural decisions still belong to the architect.
2. **Separate the two faces.** AI-as-tool and AI-as-component are different problems with different governance.
3. **Trust its questions, not its answers.** Use AI for gap analysis. Push back on its default tendency toward complexity. The decisions remain with the architect.
4. **Plan for the chasm.** A PoC is roughly 5% of the system. The remaining 95% — guardrails, evals, observability, fallbacks, and trust boundaries — is what an architect is paid to design.
5. **Treat AI as a cross-cutting concern, not a feature.** The Agentic Mesh — per-domain sidecars with shared models, guardrails, and evals in a central control plane — avoids both the central-AI-monolith and the per-team-improvisation failure modes.

The remainder is engineering as usual, with the feedback loops running faster and the stakes raised by one order of magnitude.

## References

1. Alessio Bucaioni et al., [Artificial Intelligence for Software Architecture: Literature Review and the Road Ahead](https://arxiv.org/abs/2504.04334), arXiv:2504.04334, April 2025.
2. Mike Loukides, [Software Architecture in an AI World](https://www.oreilly.com/radar/software-architecture-in-an-ai-world/), O'Reilly Radar, July 2024.
3. Neal Ford and Mark Richards, [*Fundamentals of Software Architecture*](https://www.oreilly.com/library/view/fundamentals-of-software/9781492043447/) and [*Software Architecture: The Hard Parts*](https://www.oreilly.com/library/view/software-architecture-the/9781492086888/), O'Reilly.
4. Neal Ford, Rebecca Parsons, and Patrick Kua, [*Building Evolutionary Architectures*](https://www.oreilly.com/library/view/building-evolutionary-architectures/9781492097532/), O'Reilly.
5. Zhamak Dehghani, [Data Mesh Principles and Logical Architecture](https://martinfowler.com/articles/data-mesh-principles.html), martinfowler.com.
6. Hans Moravec, *Mind Children: The Future of Robot and Human Intelligence*, Harvard University Press, 1988 — origin of Moravec's paradox.
7. Ionut Balosin, [Taming AI Assistants: Practical Advice for Software Teams](https://ionutbalosin.com/2026/05/taming-ai-assistants-practical-advice-for-software-teams), May 2026.

## Tags

software-architecture, ai, llm, generative-ai, ai-engineering, ai-assistants, system-design, distributed-systems, microservices, agentic-ai, agents, agentic-mesh, data-mesh, sidecar-pattern, rag, guardrails, evals, hallucinations, non-determinism, reproducibility, prompt-engineering, context-engineering, architectural-decision-records, adr, fitness-functions, evolutionary-architecture, capabilities-vs-behaviour, vibe-coding, poc-to-production, observability, ai-governance, ai-security, prompt-injection, threat-model, token-economics, ai-cost, ai-adoption, software-engineering, best-practices, anti-patterns, practical-advice

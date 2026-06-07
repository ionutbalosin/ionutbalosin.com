# ionutbalosin.com

This repository contains the full content of [ionutbalosin.com](https://ionutbalosin.com) —
the personal site of Ionut Balosin. It bundles together everything published on the site:

- **Technical articles** — deep, evidence-based pieces on the JVM, software architecture,
  AI/LLM engineering, JVM energy consumption, and application security, aimed at
  experienced engineers and architects who want to understand *how things actually work*.
- **Courses** — descriptions and agendas of the training courses I deliver
  (Java performance tuning, software architecture, application security,
  high-performance scalable and resilient applications, corporate training catalog).
- **Talks** — index of conference talks with slides and recordings.
- **Welcome** — the site's welcome / about page.

Every technical article is opinionated where it matters, grounded in benchmarks,
profiling data, source-code citations, and primary references (JEPs, RFCs, vendor docs).

## Writing Philosophy

- **Depth over breadth** — one topic, covered thoroughly, beats five shallow surveys.
- **Evidence over claims** — benchmarks, profiling data, assembly, source-code citations.
- **Show, don't just tell** — code that compiles, numbers from real measurements, diagrams when they help.
- **Production-grounded** — examples and trade-offs that hold up in real systems, not toy demos.
- **Honest trade-offs** — every technique has a cost; name it.

## Voice & Tone

- **Audience**: upper-intermediate to advanced engineers and architects.
- **Register**: professional, measured, slightly formal. Authoritative without being
  condescending. Not casual / conversational — the reference articles read like a
  competent engineer explaining a topic to a colleague, not like a blog post chasing
  engagement.
- **Sentences**: mostly medium-length declarative. Avoid the short-punchy-line
  rhythm of polished American tech writing.
- **Paragraphs**: 2–5 sentences.
- **Voice**: first person sparingly (*"In my humble opinion…"*, *"I have included…"*),
  mostly direct and active. Mild hedging (*"generally"*, *"typically"*) is welcome
  — it matches the authentic tone.
- **Concreteness**: prefer specific numbers, file paths, JEP/RFC IDs, and version tags over vague claims.
- **No AI tells**: no "In this article, we will explore…", no "It is important to note…",
  no formulaic transitions, no padded conclusions. Write like a human who has done the work.
- **Language**: articles are written in **English**.
- **Non-native English, on purpose**: Ionut Balosin is **not a native English speaker**,
  and the writing should feel like it. The target is clear, technically precise English
  that reads naturally from a fluent non-native engineer — measured, slightly formal,
  occasionally a little verbose, but always direct. Not polished, idiom-heavy American
  English; not the over-smoothed cadence that screams "edited by an LLM".

  > ⚠️ **Reference articles** (these represent the authentic voice and should be used
  > as stylistic models for all new writing):
  > - [Core Application Security for Java Developers](https://ionutbalosin.com/2025/03/core-application-security-for-java-developers/)
  > - [Security Application Testing for Java Developers](https://ionutbalosin.com/2025/03/security-application-testing-for-java-developers/)
  > - [Analyzing JVM Energy Consumption for JDK 21: An Empirical Study](https://ionutbalosin.com/2024/03/analyzing-jvm-energy-consumption-for-jdk-21-an-empirical-study/)
  > - [JVM Performance Comparison for JDK 21](https://ionutbalosin.com/2024/02/jvm-performance-comparison-for-jdk-21/)
  >

  **Signature phrasings of the authentic voice** (these recur and are part of the voice):
  - *"An important note to make is that..."*
  - *"It is worth mentioning that..."*
  - *"Below is an example of..."* / *"The code snapshot below..."* (note: *snapshot*, not *snippet*)
  - *"A few examples are:"* / *"A few examples of..."*
  - *"In my humble opinion, ..."*
  - *"Of course, ..."* / *"Nevertheless, ..."* / *"Therefore, ..."* / *"Furthermore, ..."* / *"Additionally, ..."*
  - *"It is crucial to..."* / *"It is recommended to..."*
  - *"Rule of thumb: ..."*
  - *"very thankful"* (instead of *grateful*) — yes, slightly old-fashioned, this is authentic.

  **Concretely, avoid**:
  - Colloquial American idioms: *"shines"*, *"let's talk about"*, *"sometimes you
    need surgery, not statistics"*, *"the ball is in your court"*, *"until you need precision"*.
  - One-word punchy lines used for rhetorical effect: *"Done."*, *"Easy."*, *"Nope."*.
  - Rhetorical questions as section openers: *"Why Java?"*, *"Why the performance gain?"*.
  - Excessive contractions in technical statements; prefer *"do not"*, *"cannot"*,
    *"will not"* most of the time.
  - Aggressively short paragraphs used for dramatic pacing.

  **Prefer**:
  - Direct, declarative sentences. State the fact, then explain it.
  - Medium-length paragraphs (2–5 sentences).
  - Bullet lists with **bold lead-in phrases** for definitions and enumerations:
    `**Whitelisting**: Allows only valid, predefined input values.`
  - Hedge where appropriate (*"generally"*, *"typically"*, *"in most cases"*) rather
    than over-asserting.
  - Plain technical vocabulary. *"This is slow because…"* instead of *"This is where
    things get hairy."*

- **Match the structure of the reference articles, not a rigid template**:
  the table of contents IS the structure. For practical/topical articles, H2
  sections are the topics themselves (no forced Problem → Solution → Deep Dive
  spine). For empirical/benchmark articles, the canonical outline is Content →
  Introduction → Methodology → Results → Conclusions → Final Thoughts →
  Acknowledgements → References. Either is acceptable; pick the one that fits.

## Universal Quality Standards

Every article — regardless of category — should:

- ✅ Open with a short scope statement: what the article covers, who it is for,
  and how it fits in (single paragraph, often with an emoji prefix like 🔒 / 📚 / ⚠️).
- ✅ Back every performance claim with a measurement or a citation.
- ✅ Include at least one runnable / inspectable artifact (code, command, config).
- ✅ Acknowledge limitations and counter-cases.
- ✅ End with a useful takeaway, not a recap.
- ✅ Cite primary sources (JEPs, RFCs, papers, vendor docs) — not blogs about blogs.

Each category adds its own depth-specific checklist (assembly for JVM, ADRs for
architecture, eval traces for AI, flame graphs for performance). See the per-category
README for those.

## Repository Layout

Articles live under [blog/](blog/), organised by category. Standalone pages
(`courses/`, `talks/`, `welcome/`) sit at the repository root.

Each article lives in its own **self-contained folder** ("page bundle"):
the Markdown file sits next to the original sources, assets, and any
supporting material it needs.

```
ionutbalosin.com/
├── blog/
│   └── <category>/
│       ├── README.md               # Category-specific scope, structure, conventions
│       └── <article-slug>/
│           ├── article.md          # The article (Markdown)
│           ├── sources/            # Original inputs (HTML, transcripts, PDFs, ...)
│           ├── assets/             # Images, diagrams (optional)
│           └── code/               # Code snippets, benchmarks (optional)
├── courses/                        # Course descriptions and agendas
├── talks/                          # Conference talks index and slides
└── welcome/                        # Site welcome page
```

**Workflow for a new article**:

1. Pick the right category folder under `blog/`. If none fits, create a new one with its own README.
2. Create `blog/<category>/<article-slug>/` with `article.md` and a `sources/` subfolder
   holding the original references used to write it.
3. Add `assets/` / `code/` only if the article needs them.
4. Follow the category-specific README for content structure and required sections.

## Categories

| Folder | Scope |
|---|---|
| [blog/java/](blog/java/) | JVM internals, JDK features, JEP analyses, language evolution |
| [blog/architecture/](blog/architecture/) | System design, architectural patterns, AI-era architecture |
| [blog/ai-llm/](blog/ai-llm/) | Practical AI/LLM engineering: agents, evaluation, production patterns |
| [blog/energy/](blog/energy/) | JVM energy consumption studies, empirical measurements across JDK versions |
| [blog/security/](blog/security/) | Application security for Java developers: core practices, API/web, testing |
| [courses/](courses/) | Course descriptions and agendas published on ionutbalosin.com |
| [talks/](talks/) | Conference talks index with slides and recordings |
| [welcome/](welcome/) | Site welcome page |

Each category folder has its own `README.md` with the specifics of what belongs
there, what structure articles should follow, and any domain-specific conventions.

## License

All content © Ionut Balosin. Articles published on [ionutbalosin.com](https://ionutbalosin.com).

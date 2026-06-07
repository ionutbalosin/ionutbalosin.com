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

## License

All content © Ionut Balosin. Articles published on [ionutbalosin.com](https://ionutbalosin.com).

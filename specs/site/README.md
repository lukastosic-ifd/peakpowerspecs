# Stakeholder Site

A self-contained website that presents the whole specification set with navigation, rendered
diagrams, a searchable index and interactive boards for features, open questions and risks.

## Running it

```bash
node specs/site/build.mjs && open specs/site/index.html
```

That is the whole thing. No server, no install, no network. Open `index.html` from a file share, a
USB stick or a static host and it works identically.

## What it gives you beyond the Markdown

| View | What it adds |
| --- | --- |
| **Overview** | Live counts, the ten blocking questions as cards, top risks, phase summary |
| **Feature matrix** | All 15 features filterable by phase, with requirement counts and the open questions attached to each |
| **Open questions** | All 77, filterable by priority, owner and free text; every `[OQ-nn]` reference anywhere in the set links straight to its row |
| **Risk register** | Sorted by score with the scoring visible |
| **Decisions & assumptions** | The two registers side by side, linked from every `[DEC-nn]` and `[AS-nn]` in the text |
| **Mockup gallery** | All 19 wireframes inline, click to enlarge |
| **Search** | Full text across every document, ranked, with highlighted snippets — `⌘K` or `/` |

Cross-references become clickable chips throughout: <code>[OQ-14]</code>, <code>[DEC-07]</code>,
<code>[AS-06]</code>, <code>[F05]</code>, <code>[NFR-24]</code>. Relative Markdown links between
documents are rewritten to in-app routes, so the same files work both on disk and in the site.

Light and dark themes, following the system preference with a manual toggle. Mermaid diagrams are
re-themed when you switch. `Print` produces a clean copy of the current page with the chrome removed.

## How it is built

```
specs/site/
├── build.mjs      scans specs/**/*.md and specs/60-mockups/*.svg → content.js
├── content.js     generated bundle: documents, features, questions, risks, mockups
├── index.html     the entire application — markup, styles and logic in one file
├── vendor/
│   ├── marked.min.js     Markdown → HTML  (~40 kB)
│   └── mermaid.min.js    diagram rendering (~3.5 MB)
└── README.md
```

`build.mjs` inlines everything into `content.js` rather than fetching at runtime, which is what lets
the site work from `file://` where `fetch` is blocked by the browser's origin rules.

It also parses structure out of the Markdown so the boards are never out of step with the documents:

| Extracted | From |
| --- | --- |
| Features, priority, phase, size, requirement counts | The metadata line in each `10-features/F*.md` |
| Open questions with priority and owner | The tables in `80-open-questions.md` |
| Decisions and assumptions | The tables in `00-overview/04-assumptions-and-decisions.md` |
| Risks with scores | The register in `70-delivery/02-risks.md` |
| Mockups | `60-mockups/*.svg`, with the title read from each file |

**The Markdown is the source of truth.** Edit a document, re-run `build.mjs`, and every view updates.
Nothing is maintained twice.

## Sharing it

The whole `specs/site/` folder plus the `specs/60-mockups/*.svg` files are all that is needed. Zip
the folder and it opens anywhere, or drop it on any static host — GitHub Pages, Azure Static Web
Apps, an S3 bucket, a network share.

## Regenerating after a change

```bash
node specs/60-mockups/generate.mjs   # only if a mockup changed
node specs/site/build.mjs            # always
```

Both are deterministic, so a rerun with no content change produces no diff.

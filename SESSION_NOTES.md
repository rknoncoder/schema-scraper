# Session Notes

Last updated: 2026-07-14

## Current Status

This project is working locally according to the user. Dependencies were
installed and the CLI was run successfully before these notes were added.

The repository is `rknoncoder/schema-scraper`:

```text
https://github.com/rknoncoder/schema-scraper
```

Local path used in this session:

```text
C:\Users\Admin\Documents\Gub\schema-scraper
```

## What This Project Does

Schema Scraper extracts Schema.org structured data from web pages or raw
JSON-LD. It supports:

- static HTML fetches
- rendered Puppeteer fetches
- dual-pass static plus rendered extraction
- JSON-LD, Microdata, and RDFa extraction
- syntax recovery and strict Google parse comparison
- graph-ready normalization and URL canonicalization
- identity consolidation and graph resolution
- terminal tree, JSON report, and interactive HTML report output
- local Google rich result eligibility checks

## Latest Known Report

Latest output file:

```text
jellypopgrr2-report.html
```

Audited URL:

```text
https://colourpop.com/products/stay-jelly-jelly-much-eyeshadow-stick
```

Report snapshot extracted during this session:

```text
Generated: 2026-07-14T12:54:36.006Z
Primary root: Product
Graph entities: 14
Resolved entities: 14
Types: 1 Product, 1 Organization, 1 ItemList, 11 VideoObject
Syntax errors: 0
Scrape warnings: 0
Quality warnings: 0
Strict Google discarded blocks: 0
Graph health: success
Registry IDs: 25
Connected tree elements: 2
Broken links: 0
```

Google rich result summary:

```text
Product: Eligible, 0 issues
Organization: Eligible, repeated recommended-field warnings from nested video publisher objects
```

## Important Observation

The latest report is healthy. The main visible noise is repeated Organization
rich-result warnings because the same publisher-like `Organization` object is
visited inside many `VideoObject.publisher` nodes.

Likely follow-up if code changes are requested later:

1. Deduplicate Google rich-result candidate audits by stable identity/path.
2. Split the large HTML renderer out of `cli.ts` once report UI work grows.
3. Keep report output files outside normal commits unless they are intentional
   fixtures.

## Resume On Another PC

Recommended setup:

```bash
git clone https://github.com/rknoncoder/schema-scraper.git
cd schema-scraper
npm ci
npm run build
npm test -- --run
```

Then start Codex from the repository root and ask it to read:

```text
AGENTS.md
SESSION_NOTES.md
README.md
```

Useful resume prompt:

```text
I am continuing schema-scraper from another PC. Read AGENTS.md,
SESSION_NOTES.md, and README.md first. Do not change source code until I ask.
The latest known output is jellypopgrr2-report.html.
```

## Local Tooling Note From This Session

In the Codex PowerShell environment used for this note, `git`, `node`, and
`npm` were not on PATH, even though the repository had `.git`, `node_modules`,
and `dist`. If future Codex sessions cannot run tests, check PATH first.

## Generated Files

Root-level `.html` files appear to be generated audit/report outputs. They are
now ignored for future changes via `.gitignore`, but files already tracked by
Git will remain tracked until explicitly removed from Git history/index.

Do not delete existing reports blindly if they are needed as examples. If they
are only local run outputs, remove them in a separate cleanup commit after
confirming with `git status`.

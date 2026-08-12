# Session Notes

Last updated: 2026-08-12

## Current Status

The project is healthy, committed, and pushed to GitHub.

Repository:

```text
https://github.com/rknoncoder/schema-scraper
```

Local path used in this session:

```text
C:\Users\Admin\Documents\Gub\schema-scraper
```

Latest confirmed git status:

```text
branch: main
tracking: origin/main
working tree: clean
latest commit: e3901ee case/typo detector and business impact summary report added
```

Last verified test status:

```text
npm run build
npm test -- --run

69 tests passed
```

## What This Project Does

Schema Scraper is a TypeScript CLI/library for extracting and auditing
Schema.org structured data from URLs or raw JSON-LD. It preserves raw source
data, normalizes it for graph analysis, resolves entity relationships, and
generates JSON, terminal, or interactive HTML reports.

Supported extraction sources:

- JSON-LD from `<script type="application/ld+json">`
- Microdata from `itemscope` markup
- RDFa from `typeof` markup

Supported fetch modes:

- static server HTML
- rendered Puppeteer DOM
- dual-pass static plus rendered comparison

## Current Implemented Features

- JSON-LD syntax diagnostics with recovery where possible
- Strict Google Mode that only includes JSON-LD accepted by native `JSON.parse`
- Graph-ready normalization and URL canonicalization
- Entity consolidation by stable identity such as `@id`, URL, SKU, or GTIN
- Primary root selection, orphan root reporting, and graph health checks
- Static vs rendered diff in dual-pass mode
- Batch URL audits using `--url-file`, `--output-dir`, and `--concurrency`
- Config file support through `schema-scraper.config.json`
- Text tree, JSON report, and interactive HTML report outputs
- Schema Inventory table with filtering, CSV/JSON export, and evidence rows
- Google Rich Results local preflight checks
- Google supported type coverage for Product, ProductGroup, BreadcrumbList,
  Organization, LocalBusiness, Article, VideoObject, and related nested
  enhancement nodes such as Offer, AggregateRating, Clip, and BroadcastEvent
- FAQPage deprecation notice for standard Google Search rich results
- Raw Script Block Map alongside the Resolved Entity Graph
- Relationship map PNG export and detailed PNG export
- Configurable raw map visual cap with `--raw-map-max-nodes`
- Case-sensitive schema property typo detection, such as `Name` -> `name`,
  `URL` -> `url`, `contentURL` -> `contentUrl`, and `embedURL` -> `embedUrl`
- Business Impact summary cards:
  - Blockers
  - Rich Result Disqualifications
  - Deprecation Notices
  - Optimizations

## Latest Report Checked

Latest checked output:

```text
myn-ts1-report02.html
```

Audited URL:

```text
https://www.myntra.com/men-tshirts
```

Report snapshot:

```text
Generated: 2026-08-08T12:11:40.040Z
JSON syntax errors: 0
Strict Google discarded blocks: 0
Quality warnings: 4
Google Rich Result rows: 4
Eligible: 2
Ineligible: 1
Deprecated: 1
Raw JSON-LD blocks: 3
Raw map truncated: false
```

Business Impact summary:

```text
Blockers: 0
Rich Result Disqualifications: 1
Deprecation Notices: 1
Optimizations: 7
```

Important observations from this report:

- Myntra ranked well despite schema issues because ranking and rich-result
  eligibility are separate systems.
- The Organization block uses `Name` and `URL`; the tool now correctly reports
  these as case-sensitive schema property typos instead of vague missing-field
  errors.
- The VideoObject uses `contentURL` and `embedURL`; the tool now points users
  toward canonical `contentUrl` and `embedUrl`.
- FAQPage markup is valid but deprecated/ignored for standard Google Search
  rich results.

## Useful Commands

Run from the repository root:

```bash
npm ci
npm run build
npm test -- --run
```

Common single-page HTML audit:

```bash
npm run cli -- --url "https://example.com" --dual-pass --deep-render --timeout 60000 --google-rich-results --format html -o report.html
```

Common batch audit:

```bash
npm run cli -- --url-file urls.txt --dual-pass --deep-render --timeout 60000 --google-rich-results --format html --output-dir reports --concurrency 2
```

Increase Raw Script Block Map visual cap:

```bash
npm run cli -- --url "https://example.com" --dual-pass --google-rich-results --raw-map-max-nodes 1000 --format html -o report.html
```

## Pending / Recommended Next Work

1. Quick Fix Snippet Generator
   Generate corrected JSON-LD snippets for simple issues like casing mistakes,
   missing `@id`, missing required Google fields, and obvious URL typos.

2. Entity Linkage / `@id` Architecture Checks
   Strengthen checks for canonical `@id` usage between Organization, WebSite,
   WebPage, Product, BreadcrumbList, and media/content entities.

3. Duplicate Site Entity Detection
   Detect repeated Organization/WebSite declarations across blocks or pages and
   recommend stable reusable `@id` references.

4. Multi-Format / Migration Audit
   Add gentle recommendations when important entities are only available as
   Microdata/RDFa and could be migrated to cleaner JSON-LD.

5. Duplicate Type Across Formats
   Flag cases where the same schema type/entity appears in both JSON-LD and
   Microdata/RDFa on the same page.

6. Report UI Polish
   Improve the Business Impact section with clearer "fix first" ordering,
   anchors to evidence, and client-friendly language.

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
Latest pushed commit: e3901ee case/typo detector and business impact summary report added.
Latest checked report: myn-ts1-report02.html.
```

## Local Tooling Note

In some Codex PowerShell sessions, `git`, `node`, or `npm` may not be on PATH.
If commands fail unexpectedly, try explicit paths:

```powershell
& 'C:\Program Files\Git\cmd\git.exe' status
& 'C:\Program Files\nodejs\npm.cmd' run build
& 'C:\Program Files\nodejs\npm.cmd' test -- --run
```

## Generated Files

Generated `.html` reports are local audit outputs and should generally stay
out of commits unless intentionally added as fixtures or examples. The repo is
configured to ignore generated report outputs by default.

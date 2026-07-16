# Agent Guide

This repository is a TypeScript CLI/library for scraping Schema.org structured
data from URLs or raw JSON-LD, normalizing it, resolving graph relationships,
and producing text, JSON, or interactive HTML audit reports.

## Project Shape

- `cli.ts` owns CLI argument parsing and report export/rendering.
- `src/scraper.ts` coordinates static, rendered, and dual-pass scraping.
- `src/extractors/` extracts JSON-LD, Microdata, and RDFa.
- `src/commands/auditAction.ts` converts raw scrape payloads into graph-ready
  audit data.
- `src/analyzer/` contains syntax, format, URL, quality, and Google rich result
  checks.
- `src/tree/graphResolver.ts` consolidates identities, resolves references, and
  selects primary/orphan roots.
- `src/reporter/textReporter.ts` renders terminal trees.
- `tests/` contains Vitest coverage for scraper, analyzer, graph, report, and
  CLI-adjacent behavior.

## Commands

Run these from the repository root:

```bash
npm ci
npm run build
npm test -- --run
```

Common manual audit command:

```bash
npm run cli -- --url "https://example.com" --dual-pass --deep-render --timeout 60000 --google-rich-results --format html -o report.html
```

If `node`, `npm`, or `git` are missing in the agent shell, check the local PATH
before assuming the project is broken.

## Working Rules

- Do not change source code unless the user explicitly asks for code changes.
- Keep generated report outputs out of commits by default.
- Prefer focused changes with tests near the touched behavior.
- For report/UI changes, verify both `npm run build` and `npm test -- --run`.
- For rendered or dual-pass scraping changes, consider Puppeteer timeout and
  lazy-loading behavior.
- Preserve raw extraction data; analysis should add views rather than discard
  recoverable source information.

## Continuation Notes

Read `SESSION_NOTES.md` first when resuming work on another PC or in a new
Codex session. It contains the latest known project status, report snapshot,
and likely next tasks.

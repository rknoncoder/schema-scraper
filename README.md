# Schema Scraper

Schema Scraper is a TypeScript CLI for extracting and inspecting Schema.org
structured data from web pages or raw JSON-LD. It preserves the raw extraction
result and can optionally turn it into normalized entities, resolved graph
trees, terminal output, JSON reports, or an interactive HTML audit.

The extractor reads:

- JSON-LD from `<script type="application/ld+json">`
- Microdata from `itemscope` markup
- RDFa from `typeof` markup

The optional analysis pipeline can:

- report malformed JSON-LD without losing recoverable data
- homogenize Microdata and RDFa AST nodes into JSON-like Schema.org objects
- canonicalize relative schema URLs against the fetched page URL
- merge entities only when they share an explicit identity such as `@id`,
  product `gtin`, product `sku`, or a canonical product URL
- resolve references, circular pointers, primary roots, and unlinked roots
- audit Google rich result eligibility when requested
- produce interactive semantic trees and relationship maps

## Requirements

- Node.js with built-in `fetch` support
- npm

Puppeteer is included as a dependency and is used by rendered and dual-pass
fetching.

## Install

```bash
npm install
```

## Quick Start

Fetch the server HTML and print the raw extraction result:

```bash
npm run cli -- --url "https://example.com"
```

Create a complete interactive audit using both the server HTML and rendered
browser DOM:

```bash
npm run cli -- --url "https://example.com" --dual-pass --deep-render --timeout 60000 --format html -o report.html
```

## URL Fetch Modes

### Static mode

Static mode is the default. It fetches the original server response without
running page JavaScript. This is the fastest mode and is useful for checking
what a crawler receives directly.

```bash
npm run cli -- --url "https://example.com" --static
```

The default static request timeout is 15 seconds.

### Rendered mode

Rendered mode loads the page in headless Chromium and extracts schema after
JavaScript has run. Use it for schema injected by applications, tag managers,
review widgets, or client-side frameworks.

```bash
npm run cli -- --url "https://example.com" --rendered
```

The default rendered navigation timeout is 30 seconds.

### Dual-pass mode

Dual-pass mode extracts from both the static response and rendered DOM. Exact
rendered extraction duplicates already found in the static response are
filtered before analysis.

```bash
npm run cli -- --url "https://example.com" --dual-pass
```

If the rendered pass fails, the command keeps the static result and records a
scrape warning instead of discarding the successful extraction.

Dual-pass entities may carry `_meta.sourceMode` values of `static`, `rendered`,
or `merged`, along with their extraction channel.

Do not combine `--static`, `--rendered`, and `--dual-pass` in one command.

## Slow and Lazy Pages

Set a custom timeout in milliseconds:

```bash
npm run cli -- --url "https://example.com" --dual-pass --timeout 60000
```

Use `--deep-render` with rendered or dual-pass mode to scroll the page and wait
for additional lazy content before extraction:

```bash
npm run cli -- --url "https://example.com" --dual-pass --deep-render --timeout 90000
```

## Batch URL Audits

Audit a list of URLs from a file and write one report per URL:

```bash
npm run cli -- --url-file urls.txt --dual-pass --deep-render --timeout 60000 --google-rich-results --format html --output-dir reports
```

URL files support one URL per line. Blank lines and lines starting with `#` are
ignored. Batch mode also writes:

- `batch-report.json` with per-URL status and output paths
- `failed-urls.txt` when any URL fails

Use `--concurrency <count>` to process more than one URL at a time:

```bash
npm run cli -- --url-file urls.txt --output-dir reports --concurrency 2
```

## Config Files

Pass a JSON config file with `--config`:

```bash
npm run cli -- --config schema-scraper.config.json
```

If `schema-scraper.config.json` exists in the repository root, the CLI loads it
automatically. Command-line flags override config values.

Example:

```json
{
  "urlFile": "urls.txt",
  "renderMode": "dual-pass",
  "deepRender": true,
  "timeoutMs": 60000,
  "googleRichResults": true,
  "format": "html",
  "outputDir": "reports",
  "concurrency": 2
}
```

## Raw JSON-LD Inputs

Analyze a local JSON-LD file without fetching a URL:

```bash
npm run cli -- --jsonld-file schema.json --tree
npm run cli -- --input schema.json --format html -o schema-report.html
```

Pipe JSON-LD through Bash stdin:

```bash
cat schema.json | npm run cli -- --stdin --graph-ready
```

Pass a small inline JSON-LD value:

```bash
npm run cli -- --jsonld '{ "@context": "https://schema.org", "@type": "Product", "name": "Example" }' --tree
```

## Output Modes

### Raw extraction JSON

With no output-processing flag, the CLI prints the raw scrape envelope,
including the final URL and every extracted schema block:

```bash
npm run cli -- --url "https://example.com"
```

Use compact JSON for piping into another command:

```bash
npm run cli -- --url "https://example.com" --compact
```

### Graph-ready JSON

Run syntax processing and format homogenization before graph resolution:

```bash
npm run cli -- --url "https://example.com" --graph-ready
```

This output contains `entitiesForGraphResolver`, `strictGoogleEntities`, and
`detectedSyntaxErrors`.

### Terminal tree

Print the selected primary semantic tree followed by unlinked root schemas:

```bash
npm run cli -- --url "https://example.com" --dual-pass --tree
```

### JSON report

Export the complete audit data as structured JSON:

```bash
npm run cli -- --url "https://example.com" --dual-pass --format json -o report.json
```

### Interactive HTML report

```bash
npm run cli -- --url "https://example.com" --dual-pass --format html -o report.html
```

The HTML report provides:

- schema counts, duplicate identity groups, scrape warnings, and graph health
- JSON-LD script block counts with per-block type/entity diagnostics
- static vs rendered source differences for dual-pass audits
- syntax errors and semantic sanity warnings
- Strict Google Mode containing only JSON-LD accepted by native `JSON.parse`
- an optional Google Rich Results eligibility tab when `--google-rich-results`
  is passed
- primary, orphan, resolved, and raw schema tree views
- a system-fields toggle for `@context` and `_meta`
- copy and download actions for normalized graph-ready JSON-LD
- a collapsible, zoomable relationship map with mouse-wheel zoom and panning
- a layered semantic DAG with shared identity hubs and metadata-leaf pruning
- ItemList position-gap warnings and metadata leaf previews

When multiple JSON-LD script blocks are detected, the report includes an
informational note to check that related entities are connected with stable
`@id` references and do not conflict across blocks.

Large graph views are rendered when their tabs are opened to reduce initial
browser work.

If `--format` is omitted, the output filename extension can infer it:

```bash
npm run cli -- --url "https://example.com" -o report.json
npm run cli -- --url "https://example.com" -o report.html
```

## Strict Google Mode

The main analyzer may recover certain malformed JSON-LD strings so an auditor
can inspect the publisher's intended data. Strict Google Mode does not use
that recovery path. It includes only JSON-LD blocks that pass native strict
JSON parsing and shows how many blocks were discarded.

This is an inspection aid, not a guarantee of Google rich-result eligibility.

## Google Rich Result Eligibility

Add `--google-rich-results` to run a local Google rich result preflight after
schema normalization and graph resolution:

```bash
npm run cli -- --url "https://example.com" --dual-pass --google-rich-results --format html -o report.html
npm run cli -- --url "https://example.com" --graph-ready --google-rich-results
```

The audit checks supported entity types such as `Product`, `BreadcrumbList`,
`Organization`, `LocalBusiness`, and `Article` for required and recommended
fields. `FAQPage` is detected as deprecated for standard Google Search rich
results and is shown with a notice.

This is a local eligibility layer. Use Google's live Rich Results Test for
final Search validation.

## CLI Options

| Option | Purpose |
| --- | --- |
| `--url <url>` | Fetch schema from a web page |
| `--url-file <path>` | Batch audit URLs from a newline-delimited file |
| `--static` | Use only the server HTML response |
| `--rendered` | Use only the JavaScript-rendered DOM |
| `--dual-pass` | Combine static and rendered extraction |
| `--deep-render` | Scroll and wait for lazy content in browser modes |
| `--timeout <ms>` | Set the fetch or navigation timeout |
| `--config <path>` | Load CLI defaults from a JSON config file |
| `--output-dir <path>` | Write batch report files to a directory |
| `--concurrency <count>` | Set batch URL concurrency |
| `--jsonld-file <path>` | Read JSON-LD from a local file |
| `--input <path>` | Alias for `--jsonld-file` |
| `--jsonld <code>` | Read inline JSON-LD |
| `--stdin` | Read JSON-LD from standard input |
| `--graph-ready` | Print homogenized entities and syntax results |
| `--google-rich-results` | Add a Google rich result eligibility audit to JSON/stdout/HTML reports |
| `--tree` | Print the resolved tree in the terminal |
| `--format json\|html` | Generate a complete JSON or HTML audit report |
| `-o, --output <path>` | Write report output to a file |
| `--compact` | Remove indentation from JSON output |

## Library API

The package also exports its extraction and graph utilities:

```ts
import {
  scrapeSchema,
  processRawPayload,
  consolidateGraphEntities,
  buildGraphEntityMap,
  resolveGraph,
} from 'schema-scraper';

const scraped = await scrapeSchema('https://example.com', {
  renderMode: 'dual-pass',
  deepRender: true,
  timeoutMs: 60_000,
});

const processed = processRawPayload(scraped);
const entities = consolidateGraphEntities(
  processed.entitiesForGraphResolver
);
const entityMap = buildGraphEntityMap(entities);
const resolved = resolveGraph(entities, entityMap);
```

Other exports include the JSON-LD syntax validator, Microdata homogenizers,
URL canonicalizer, quality auditor, terminal reporter, and root-selection
helpers.

## Environment Limits

The static fetcher accepts HTML and XML content types and limits response
bodies to 5 MB by default. These environment variables can change the default
limits used when corresponding CLI options are not provided:

```bash
REQUEST_TIMEOUT_MS=30000 MAX_RESPONSE_BYTES=10000000 npm run cli -- --url "https://example.com"
RENDER_TIMEOUT_MS=60000 npm run cli -- --url "https://example.com" --rendered
```

## Development

```bash
npm run build
npm test -- --run
```

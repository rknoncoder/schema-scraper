# Schema Scraper

Schema Scraper fetches a URL and returns the raw structured data found on the
page as JSON. It does not diagnose, validate, merge, normalize, or score the
schema. The output is intended to show what the publisher actually provided.

It extracts:

- JSON-LD from `<script type="application/ld+json">`
- Microdata from `itemscope` markup
- RDFa from `typeof` markup

## Install

```bash
npm install
```

## Use

```bash
npm run cli -- --url "https://example.com"
```

The command prints JSON:

```json
{
  "url": "https://example.com",
  "finalUrl": "https://example.com/",
  "schemas": [
    {
      "source": "json-ld",
      "raw": "{ \"@context\": \"https://schema.org\", \"@type\": \"Product\" }",
      "data": {
        "@context": "https://schema.org",
        "@type": "Product"
      },
      "tree": {
        "label": "Schema #1",
        "type": "object",
        "children": []
      }
    }
  ]
}
```

Use `--compact` if another tool will consume the result:

```bash
npm run cli -- --url "https://example.com" --compact
```

Use `--graph-ready` to run the orchestration layer before graph resolution:

```bash
npm run cli -- --url "https://example.com" --graph-ready
```

That output contains:

- `entitiesForGraphResolver`
- `detectedSyntaxErrors`

Analyze raw JSON-LD without fetching a URL:

```bash
npm run cli -- --jsonld-file schema.json --tree
npm run cli -- --jsonld-file schema.json --format html -o schema-report.html
```

Pipe JSON-LD through stdin:

```bash
cat schema.json | npm run cli -- --stdin --graph-ready
```

Pass a small inline JSON-LD string:

```bash
npm run cli -- --jsonld '{ "@context": "https://schema.org", "@type": "Product", "name": "Example" }' --tree
```

Use `--rendered` to extract schema after JavaScript has hydrated the page.
This requires Puppeteer:

```bash
npm install puppeteer --save
npm run cli -- --url "https://example.com" --rendered
```

Use `--dual-pass` to stitch the static server response together with the
rendered browser DOM. This is useful for pages that mix open JSON-LD with
hidden schema injected by apps, reviews widgets, or tag managers:

```bash
npm run cli -- --url "https://example.com" --dual-pass --format html -o report.html
```

Dual-pass report entities include `_meta.sourceMode` values such as `static`,
`rendered`, or `merged` so the HTML dashboard can show where each graph came
from.

Use `--tree` to print graph-ready entities as terminal trees:

```bash
npm run cli -- --url "https://example.com" --tree
```

Export a structured JSON report:

```bash
npm run cli -- --url "https://example.com" --tree --format json -o report.json
```

Export a shareable interactive HTML report:

```bash
npm run cli -- --url "https://example.com" --tree --format html -o report.html
```

When `-o` is provided, the extension can infer the format:

```bash
npm run cli -- --url "https://example.com" -o report.json
npm run cli -- --url "https://example.com" -o report.html
```

## Development

```bash
npm run build
npm test -- --run
```

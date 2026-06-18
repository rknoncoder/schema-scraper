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

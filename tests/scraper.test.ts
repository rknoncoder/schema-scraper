import { describe, expect, it } from 'vitest';
import { compareStaticRenderedSchemas, extractSchemasFromHtml, scrapeJsonLdInput } from '../src';

describe('schema scraper', () => {
  it('returns raw JSON-LD data and a matching source tree', () => {
    const schemas = extractSchemasFromHtml(`
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@graph": [
            { "@type": "Product", "name": "Example Product" },
            { "@type": "Organization", "name": "Example Org" }
          ]
        }
      </script>
    `);

    expect(schemas).toHaveLength(1);
    expect(schemas[0].source).toBe('json-ld');
    expect(schemas[0].data).toMatchObject({
      '@graph': [
        { '@type': 'Product' },
        { '@type': 'Organization' },
      ],
    });
    expect(schemas[0].tree.children.find(child => child.label === '@graph')?.type)
      .toBe('array');
  });

  it('extracts microdata without validation metadata', () => {
    const schemas = extractSchemasFromHtml(`
      <div itemscope itemtype="https://schema.org/Product">
        <span itemprop="name">Example Product</span>
        <span itemprop="sku">ABC-123</span>
      </div>
    `);

    expect(schemas).toHaveLength(1);
    expect(schemas[0].source).toBe('microdata');
    expect(schemas[0].data).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: 'Example Product',
      sku: 'ABC-123',
    });
    expect(JSON.stringify(schemas[0])).not.toContain('validation');
  });

  it('keeps invalid JSON-LD as raw scrape output instead of diagnosing schema quality', () => {
    const schemas = extractSchemasFromHtml(`
      <script type="application/ld+json">
        { "@context": "https://schema.org", "@type": }
      </script>
    `);

    expect(schemas).toHaveLength(1);
    expect(schemas[0].raw).toContain('"@type"');
    expect(schemas[0].parseError).toBeTruthy();
    expect(schemas[0].data).toBeUndefined();
  });

  it('creates raw scrape output from direct JSON-LD input', () => {
    const result = scrapeJsonLdInput(`
      <script type="application/ld+json">
        { "@context": "https://schema.org", "@type": "Product", "name": "Input Product" }
      </script>
    `, 'file://schema.json');

    expect(result).toMatchObject({
      url: 'file://schema.json',
      finalUrl: 'file://schema.json',
      jsonLdDiagnostics: {
        jsonLdBlockCount: 1,
        blocks: [
          {
            index: 1,
            sourceMode: 'static',
            valid: true,
            syntaxStatus: 'valid',
            types: ['Product'],
            entityCount: 1,
          },
        ],
      },
      schemas: [
        {
          source: 'json-ld',
          raw: '{ "@context": "https://schema.org", "@type": "Product", "name": "Input Product" }',
          data: {
            '@type': 'Product',
            name: 'Input Product',
          },
          syntaxStatus: 'valid',
        },
      ],
    });
  });

  it('adds per-block JSON-LD diagnostics with type breakdowns and errors', () => {
    const schemas = extractSchemasFromHtml(`
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@graph": [
            { "@type": "Product", "name": "Graph Product" },
            { "@type": "Organization", "name": "Graph Org" }
          ]
        }
      </script>
      <script type="application/ld+json">
        { "@context": "https://schema.org", "@type": }
      </script>
    `, 'static');

    expect(schemas).toHaveLength(2);
    expect(schemas[0]).toMatchObject({
      source: 'json-ld',
      jsonLdBlockIndex: 1,
      jsonLdTypes: ['Product', 'Organization'],
      jsonLdEntityCount: 2,
    });
    expect(schemas[1]).toMatchObject({
      source: 'json-ld',
      jsonLdBlockIndex: 2,
      jsonLdTypes: [],
      jsonLdEntityCount: 0,
      syntaxStatus: 'critical',
    });
  });

  it('summarizes static vs rendered schema differences', () => {
    const staticSchemas = extractSchemasFromHtml(`
      <script type="application/ld+json">
        { "@context": "https://schema.org", "@type": "Product", "@id": "#product", "name": "Static Product" }
      </script>
      <script type="application/ld+json">
        { "@context": "https://schema.org", "@type": "Organization", "name": "Server Org" }
      </script>
    `, 'static');
    const renderedSchemas = extractSchemasFromHtml(`
      <script type="application/ld+json">
        { "@context": "https://schema.org", "@type": "Product", "@id": "#product", "name": "Static Product" }
      </script>
      <script type="application/ld+json">
        { "@context": "https://schema.org", "@type": "VideoObject", "name": "Rendered Video" }
      </script>
    `, 'rendered');

    const diff = compareStaticRenderedSchemas(staticSchemas, renderedSchemas);

    expect(diff.both).toMatchObject([
      {
        source: 'json-ld',
        types: ['Product'],
        id: '#product',
        name: 'Static Product',
      },
    ]);
    expect(diff.staticOnly).toMatchObject([
      {
        source: 'json-ld',
        types: ['Organization'],
        name: 'Server Org',
      },
    ]);
    expect(diff.renderedOnly).toMatchObject([
      {
        source: 'json-ld',
        types: ['VideoObject'],
        name: 'Rendered Video',
      },
    ]);
  });
});

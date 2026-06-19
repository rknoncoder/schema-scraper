import { describe, expect, it } from 'vitest';
import {
  extractSchemasFromHtml,
  processRawPayload,
  verifyGraphResolutionHealth,
} from '../src';

describe('audit action orchestration', () => {
  it('flattens JSON-LD @graph entities and keeps syntax errors', () => {
    const rawPayload = {
      schemas: extractSchemasFromHtml(`
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@graph": [
              { "@type": "Product", "name": "Example Product" },
              { "@type": "Organization", "name": "Example Org" },
            ]
          }
        </script>
      `),
    };

    const result = processRawPayload(rawPayload);

    expect(result.detectedSyntaxErrors).toHaveLength(1);
    expect(result.detectedSyntaxErrors[0]).toMatchObject({
      type: 'TRAILING_COMMA',
    });
    expect(result.entitiesForGraphResolver).toEqual([
      {
        '@type': 'Product',
        name: 'Example Product',
      },
      {
        '@type': 'Organization',
        name: 'Example Org',
      },
    ]);
  });

  it('homogenizes scraped microdata tree output into graph-ready entities', () => {
    const rawPayload = {
      schemas: extractSchemasFromHtml(`
        <div itemscope itemtype="https://schema.org/Product">
          <span itemprop="name">Example Product</span>
          <span itemprop="sku">ABC-123</span>
        </div>
      `),
    };

    const result = processRawPayload(rawPayload);

    expect(result.detectedSyntaxErrors).toEqual([]);
    expect(result.entitiesForGraphResolver).toEqual([
      {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: 'Example Product',
        sku: 'ABC-123',
      },
    ]);
  });

  it('adds discovery metadata when a scrape source mode is present', () => {
    const result = processRawPayload({
      schemas: extractSchemasFromHtml(`
        <script type="application/ld+json">
          { "@context": "https://schema.org", "@type": "Product", "@id": "#product" }
        </script>
      `, 'rendered'),
    });

    expect(result.entitiesForGraphResolver).toEqual([
      {
        '@context': 'https://schema.org',
        '@type': 'Product',
        '@id': '#product',
        _meta: {
          sourceMode: 'rendered',
          extractionChannel: 'json-ld',
        },
      },
    ]);
  });

  it('supports module-style microdata children AST payloads', () => {
    const result = processRawPayload({
      schemas: [
        {
          source: 'microdata',
          children: [
            {
              id: 'root',
              label: 'BreadcrumbList',
              type: 'schema',
              source: 'microdata',
              meta: {
                path: 'schemas[0]',
                schemaType: 'BreadcrumbList',
              },
              children: [
                {
                  id: 'item',
                  label: 'itemListElement',
                  type: 'schema',
                  source: 'microdata',
                  meta: {
                    path: 'schemas[0].itemListElement',
                    schemaType: 'ListItem',
                  },
                  children: [
                    {
                      id: 'position',
                      label: 'position',
                      type: 'field',
                      source: 'microdata',
                      value: '1',
                      children: [],
                      meta: { path: 'schemas[0].itemListElement.position' },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    expect(result.entitiesForGraphResolver).toEqual([
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          {
            '@type': 'ListItem',
            position: '1',
          },
        ],
      },
    ]);
  });

  it('verifies graph health for connected resolved trees', () => {
    const report = verifyGraphResolutionHealth(
      [
        {
          '@type': 'Product',
          '@id': '#product',
          url: 'https://example.com/product',
          brand: {
            '@type': 'Brand',
            '@id': '#brand',
          },
        },
      ],
      {
        '@type': 'Product',
        '@id': '#product',
        brand: {
          '@type': 'Brand',
          '@id': '#brand',
        },
      },
      { log: false }
    );

    expect(report).toEqual({
      registryIdCount: 3,
      connectedTreeElementCount: 2,
      brokenLinks: [],
      status: 'success',
    });
  });

  it('treats URL identity references as connected graph targets', () => {
    const report = verifyGraphResolutionHealth(
      [
        {
          '@type': 'RealEstateListing',
          url: 'https://example.com/listing',
          offers: {
            '@type': 'Offer',
            url: 'https://example.com/listing',
          },
        },
      ],
      {
        '@type': 'RealEstateListing',
        url: 'https://example.com/listing',
        offers: {
          $ref: 'https://example.com/listing',
        },
      },
      { log: false }
    );

    expect(report).toMatchObject({
      registryIdCount: 1,
      brokenLinks: [],
      status: 'success',
    });
  });

  it('flags unresolved explicit reference targets', () => {
    const report = verifyGraphResolutionHealth(
      [
        {
          '@type': 'Product',
          '@id': '#product',
        },
      ],
      {
        '@type': 'Product',
        '@id': '#product',
        brand: {
          $ref: '#missing-brand',
        },
      },
      { log: false }
    );

    expect(report).toMatchObject({
      registryIdCount: 1,
      connectedTreeElementCount: 2,
      brokenLinks: ['#missing-brand'],
      status: 'warning',
    });
  });
});

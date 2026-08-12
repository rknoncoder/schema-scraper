import { auditSchemaArchitecture } from '../src';
import { describe, expect, it } from 'vitest';

describe('schema architecture auditor', () => {
  it('flags missing page-to-site and page-to-organization @id links', () => {
    const findings = auditSchemaArchitecture([
      {
        '@type': 'WebSite',
        '@id': 'https://example.com/#website',
        name: 'Example',
      },
      {
        '@type': 'Organization',
        '@id': 'https://example.com/#organization',
        name: 'Example Inc',
        logo: 'https://example.com/logo.png',
      },
      {
        '@type': 'WebPage',
        '@id': 'https://example.com/page/#webpage',
        name: 'Example Page',
      },
    ]);

    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        category: 'entity-linkage',
        entityType: 'WebPage',
        property: 'isPartOf',
        expectedReference: 'https://example.com/#website',
      }),
      expect.objectContaining({
        category: 'entity-linkage',
        entityType: 'WebPage',
        property: 'publisher / about',
        expectedReference: 'https://example.com/#organization',
      }),
    ]));
  });

  it('does not flag page architecture when canonical @id links are present', () => {
    expect(auditSchemaArchitecture([
      {
        '@type': 'WebSite',
        '@id': 'https://example.com/#website',
        name: 'Example',
      },
      {
        '@type': 'Organization',
        '@id': 'https://example.com/#organization',
        name: 'Example Inc',
        logo: 'https://example.com/logo.png',
      },
      {
        '@type': 'WebPage',
        '@id': 'https://example.com/page/#webpage',
        name: 'Example Page',
        isPartOf: { '@id': 'https://example.com/#website' },
        publisher: { '@id': 'https://example.com/#organization' },
      },
    ])).toEqual([]);
  });

  it('flags repeated full site profiles that should be referenced by @id', () => {
    const findings = auditSchemaArchitecture([
      {
        '@type': 'Organization',
        '@id': 'https://example.com/#organization',
        name: 'Example Inc',
        url: 'https://example.com',
        logo: 'https://example.com/logo.png',
        sameAs: ['https://www.linkedin.com/company/example'],
      },
      {
        '@type': 'WebPage',
        '@id': 'https://example.com/page/#webpage',
        publisher: {
          '@type': 'Organization',
          '@id': 'https://example.com/#organization',
          name: 'Example Inc',
          url: 'https://example.com',
          logo: 'https://example.com/logo.png',
          sameAs: ['https://www.linkedin.com/company/example'],
        },
      },
    ]);

    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        category: 'duplicate-site-entity',
        entityType: 'Organization',
        severity: 'warning',
        expectedReference: 'https://example.com/#organization',
      }),
    ]));
  });

  it('does not force product brand objects to point at the organization @id', () => {
    expect(auditSchemaArchitecture([
      {
        '@type': 'Organization',
        '@id': 'https://example.com/#organization',
        name: 'Example Inc',
      },
      {
        '@type': 'Product',
        '@id': 'https://example.com/product/#product',
        name: 'Demo Product',
        brand: {
          '@type': 'Brand',
          name: 'Demo Brand',
        },
      },
    ])).toEqual([]);
  });
});

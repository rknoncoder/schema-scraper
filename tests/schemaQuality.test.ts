import { auditSchemaQuality } from '../src';
import { describe, expect, it } from 'vitest';

describe('schema quality auditor', () => {
  it('flags incomplete organization profiles', () => {
    expect(auditSchemaQuality([
      {
        '@type': 'Organization',
        url: '/',
      },
    ])).toEqual([
      {
        entityType: 'Organization',
        property: 'url',
        severity: 'warning',
        message: 'Relative URL found. Use absolute URLs so crawlers can parse relationships reliably.',
        path: '$.url',
        value: '/',
      },
      {
        entityType: 'Organization',
        property: 'name',
        severity: 'warning',
        message: 'The organization profile exists but lacks an identity label ("name").',
      },
    ]);
  });

  it('flags malformed nested URL-like schema fields with evidence', () => {
    expect(auditSchemaQuality([
      {
        '@type': 'ItemList',
        name: 'Residential Projects in Chennai',
        itemListElement: [
          {
            '@type': 'ListItem',
            name: 'Purva Raagam',
            url: 'hhttps://www.puravankara.com/residential/chennai/purva-raagam',
            position: 3,
          },
        ],
        _meta: {
          sourceMode: 'static',
          extractionChannel: 'json-ld',
          jsonLdBlockIndex: 5,
        },
      },
    ])).toEqual([
      {
        entityType: 'ItemList',
        property: 'url',
        severity: 'warning',
        message: 'Unsupported URL scheme "hhttps" found. Use http:// or https:// for schema URL fields.',
        path: '$.itemListElement[0].url',
        value: 'hhttps://www.puravankara.com/residential/chennai/purva-raagam',
        entityName: 'Residential Projects in Chennai',
        sourceMode: 'static',
        jsonLdBlockIndex: 5,
      },
    ]);
  });

  it('flags schema property casing typos with canonical property guidance', () => {
    expect(auditSchemaQuality([
      {
        '@type': 'Organization',
        Name: 'Myntra',
        URL: 'https://www.myntra.com',
      },
    ])).toEqual([
      {
        entityType: 'Organization',
        property: 'name',
        severity: 'warning',
        message: 'Found property "Name" but expected "name". Schema.org property names are case-sensitive.',
        path: '$.Name',
        value: 'Myntra',
      },
      {
        entityType: 'Organization',
        property: 'url',
        severity: 'warning',
        message: 'Found property "URL" but expected "url". Schema.org property names are case-sensitive.',
        path: '$.URL',
        value: 'https://www.myntra.com',
      },
    ]);
  });

  it('does not flag product groups when variants carry offers', () => {
    expect(auditSchemaQuality([
      {
        '@type': 'ProductGroup',
        hasVariant: [
          {
            '@type': 'Product',
            offers: {
              '@type': 'Offer',
              price: '10.00',
            },
          },
        ],
      },
    ])).toEqual([]);
  });
});

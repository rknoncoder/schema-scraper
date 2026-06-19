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
        property: 'name',
        severity: 'warning',
        message: 'The organization profile exists but lacks an identity label ("name").',
      },
      {
        entityType: 'Organization',
        property: 'url',
        severity: 'warning',
        message: 'Relative URLs found. Use absolute URLs so crawlers can parse relationships reliably.',
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

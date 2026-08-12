import { auditFormatMigration } from '../src';
import { describe, expect, it } from 'vitest';

describe('format migration auditor', () => {
  it('raises soft migration flags for core entities defined in Microdata', () => {
    expect(auditFormatMigration([
      {
        '@type': 'VideoObject',
        name: 'Demo Video',
        _meta: {
          extractionChannel: 'microdata',
          sourceMode: 'static',
        },
      },
    ])).toEqual([
      expect.objectContaining({
        category: 'legacy-format',
        severity: 'info',
        entityType: 'VideoObject',
        formats: ['microdata'],
      }),
    ]);
  });

  it('detects duplicate schema types across JSON-LD and Microdata', () => {
    expect(auditFormatMigration([
      {
        '@type': 'Product',
        name: 'Demo Product',
        offers: { '@type': 'Offer', price: '100' },
        _meta: { extractionChannel: 'json-ld' },
      },
      {
        '@type': 'Product',
        name: 'Demo Product',
        offers: { '@type': 'Offer', price: '100' },
        _meta: { extractionChannel: 'microdata' },
      },
    ])).toEqual(expect.arrayContaining([
      expect.objectContaining({
        category: 'duplicate-type',
        severity: 'info',
        entityType: 'Product',
        formats: ['json-ld', 'microdata'],
      }),
    ]));
  });

  it('flags high-priority data mismatches across formats', () => {
    expect(auditFormatMigration([
      {
        '@type': 'Product',
        name: 'Demo Product',
        offers: { '@type': 'Offer', price: '90', priceCurrency: 'USD' },
        _meta: { extractionChannel: 'json-ld' },
      },
      {
        '@type': 'Product',
        name: 'Demo Product',
        offers: { '@type': 'Offer', price: '100', priceCurrency: 'USD' },
        _meta: { extractionChannel: 'microdata' },
      },
    ])).toEqual(expect.arrayContaining([
      expect.objectContaining({
        category: 'data-mismatch',
        severity: 'warning',
        entityType: 'Product',
        property: 'offers.price',
        values: expect.arrayContaining([
          { format: 'json-ld', value: '90' },
          { format: 'microdata', value: '100' },
        ]),
      }),
    ]));
  });
});

import { describe, expect, it } from 'vitest';
import { auditGoogleEligibility } from '../src';

describe('google rich result validator', () => {
  it('marks a complete Product as eligible', () => {
    const [result] = auditGoogleEligibility([
      {
        '@type': 'Product',
        '@id': '#product',
        name: 'Example Product',
        image: 'https://example.com/product.jpg',
        description: 'A product used in tests.',
        sku: 'SKU-1',
        gtin: '1234567890123',
        brand: { '@type': 'Brand', name: 'Example Brand' },
        offers: {
          '@type': 'Offer',
          price: '10.00',
          priceCurrency: 'USD',
          availability: 'https://schema.org/InStock',
        },
      },
    ]);

    expect(result).toMatchObject({
      entityId: '#product',
      type: 'Product',
      status: 'Eligible',
      issues: [],
    });
  });

  it('marks a Product without offers, reviews, or aggregateRating as ineligible', () => {
    const [result] = auditGoogleEligibility([
      {
        '@type': 'Product',
        name: 'Incomplete Product',
        image: 'https://example.com/product.jpg',
        description: 'A product missing commercial or review signals.',
        sku: 'SKU-2',
        gtin: '1234567890124',
        brand: { '@type': 'Brand', name: 'Example Brand' },
      },
    ]);

    expect(result.status).toBe('Ineligible');
    expect(result.issues).toContainEqual({
      property: 'offers|review|aggregateRating',
      severity: 'error',
      message: 'Product needs at least one of offers, review, or aggregateRating for Google rich result eligibility.',
    });
  });

  it('reports BreadcrumbList entries missing position values', () => {
    const [result] = auditGoogleEligibility([
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home' },
          { '@type': 'ListItem', name: 'Category' },
        ],
      },
    ]);

    expect(result.status).toBe('Ineligible');
    expect(result.issues).toContainEqual({
      property: 'itemListElement[1].position',
      severity: 'error',
      message: 'BreadcrumbList itemListElement entries must include a position value.',
    });
  });

  it('marks FAQPage as deprecated', () => {
    const [result] = auditGoogleEligibility([
      {
        '@type': 'FAQPage',
        mainEntity: [
          {
            '@type': 'Question',
            name: 'Question?',
            acceptedAnswer: { '@type': 'Answer', text: 'Answer.' },
          },
        ],
      },
    ]);

    expect(result).toMatchObject({
      type: 'FAQPage',
      status: 'Deprecated',
      notice: 'Google deprecated FAQ rich results as of May 7, 2026. This markup is ignored for standard search results.',
    });
  });
});

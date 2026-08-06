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
          priceValidUntil: '2027-01-01',
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

  it('preserves source metadata on Google feature rows', () => {
    const [result] = auditGoogleEligibility([
      {
        '@type': 'Product',
        name: 'Source Product',
        offers: {
          '@type': 'Offer',
          price: '10.00',
          priceCurrency: 'USD',
        },
        _meta: {
          sourceMode: 'rendered',
          extractionChannel: 'json-ld',
          jsonLdBlockIndex: 7,
        },
      },
    ]);

    expect(result).toMatchObject({
      sourceMode: 'rendered',
      extractionChannel: 'json-ld',
      jsonLdBlockIndex: 7,
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

  it('can report multiple Google features for one Product entity', () => {
    const results = auditGoogleEligibility([
      {
        '@type': 'Product',
        '@id': '#merchant-product',
        name: 'Merchant Product',
        image: 'https://example.com/product.jpg',
        brand: { '@type': 'Brand', name: 'Example Brand' },
        gtin: '1234567890123',
        offers: {
          '@type': 'Offer',
          price: '10.00',
          priceCurrency: 'USD',
        },
      },
    ]);

    expect(results.map(result => result.featureName)).toEqual([
      'Product snippet',
      'Merchant listing',
    ]);
    expect(results.every(result => result.status === 'Eligible')).toBe(true);
  });

  it('folds nested Offer issues into Product feature rows', () => {
    const results = auditGoogleEligibility([
      {
        '@type': 'Product',
        name: 'Merchant Product',
        image: 'https://example.com/product.jpg',
        brand: { '@type': 'Brand', name: 'Example Brand' },
        gtin: '1234567890123',
        offers: {
          '@type': 'Offer',
          price: '10.00',
        },
      },
    ]);

    const productSnippet = results.find(result => result.featureName === 'Product snippet');
    const merchantListing = results.find(result => result.featureName === 'Merchant listing');

    expect(productSnippet?.status).toBe('Eligible');
    expect(productSnippet?.issues).toContainEqual({
      property: 'offers.priceCurrency|priceSpecification.priceCurrency',
      severity: 'warning',
      message: '[Offer details] Offer should include priceCurrency or priceSpecification.priceCurrency.',
    });
    expect(merchantListing?.status).toBe('Ineligible');
    expect(merchantListing?.issues).toContainEqual({
      property: 'offers.priceCurrency|priceSpecification.priceCurrency',
      severity: 'error',
      message: '[Merchant offer details] Merchant listing Offer needs priceCurrency or priceSpecification.priceCurrency.',
    });
  });

  it('folds nested AggregateRating issues into Product snippet rows', () => {
    const [result] = auditGoogleEligibility([
      {
        '@type': 'Product',
        name: 'Rated Product',
        image: 'https://example.com/product.jpg',
        aggregateRating: {
          '@type': 'AggregateRating',
          ratingValue: '4.5',
        },
      },
    ]);

    expect(result.status).toBe('Ineligible');
    expect(result.issues).toContainEqual({
      property: 'aggregateRating.reviewCount|ratingCount',
      severity: 'error',
      message: '[Review snippet aggregate rating] AggregateRating needs reviewCount or ratingCount.',
    });
  });

  it('checks ProductGroup as a Product variants feature', () => {
    const [result] = auditGoogleEligibility([
      {
        '@type': 'ProductGroup',
        name: 'Variant family',
        productGroupID: 'group-1',
        variesBy: ['https://schema.org/size', 'https://schema.org/color'],
        url: 'https://example.com/products/group-1',
      },
    ]);

    expect(result).toMatchObject({
      type: 'ProductGroup',
      featureName: 'Product variants',
      status: 'Eligible',
      issues: [],
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

  it('marks a complete VideoObject as eligible', () => {
    const [result] = auditGoogleEligibility([
      {
        '@type': 'VideoObject',
        '@id': '#video-1',
        name: 'Launch walkthrough',
        description: 'A short walkthrough of the launch page.',
        thumbnailUrl: ['https://example.com/thumb.jpg'],
        uploadDate: '2026-07-01T10:00:00+05:30',
        duration: 'PT2M10S',
        embedUrl: 'https://example.com/embed/video-1',
        interactionStatistic: {
          '@type': 'InteractionCounter',
          userInteractionCount: 1200,
        },
      },
    ]);

    expect(result).toMatchObject({
      entityId: '#video-1',
      type: 'VideoObject',
      status: 'Eligible',
      issues: [],
    });
  });

  it('marks a VideoObject missing required fields as ineligible', () => {
    const [result] = auditGoogleEligibility([
      {
        '@type': 'VideoObject',
        name: 'Incomplete video',
        description: 'A video without enough Google-required fields.',
      },
    ]);

    expect(result.status).toBe('Ineligible');
    expect(result.issues).toContainEqual({
      property: 'thumbnailUrl',
      severity: 'error',
      message: 'VideoObject is missing required Google field "thumbnailUrl".',
    });
    expect(result.issues).toContainEqual({
      property: 'uploadDate',
      severity: 'error',
      message: 'VideoObject is missing required Google field "uploadDate".',
    });
  });

  it('does not audit nested supported entities as standalone rich result candidates', () => {
    const results = auditGoogleEligibility([
      {
        '@type': 'VideoObject',
        name: 'Publisher noise example',
        description: 'A video with a nested publisher organization.',
        thumbnailUrl: 'https://example.com/thumb.jpg',
        uploadDate: '2026-07-01T10:00:00+05:30',
        duration: 'PT1M',
        contentUrl: 'https://example.com/video.mp4',
        publisher: {
          '@type': 'Organization',
          name: 'Nested Publisher',
        },
      },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      type: 'VideoObject',
      status: 'Eligible',
    });
  });

  it('warns when VideoObject omits both contentUrl and embedUrl', () => {
    const [result] = auditGoogleEligibility([
      {
        '@type': 'VideoObject',
        name: 'Video without playback URL',
        description: 'A video with required fields but no direct or embed URL.',
        thumbnailUrl: 'https://example.com/thumb.jpg',
        uploadDate: '2026-07-01T10:00:00+05:30',
        duration: 'PT1M',
        interactionStatistic: {
          '@type': 'InteractionCounter',
          userInteractionCount: 1200,
        },
      },
    ]);

    expect(result.status).toBe('Eligible');
    expect(result.issues).toContainEqual({
      property: 'contentUrl|embedUrl',
      severity: 'warning',
      message: 'VideoObject should include contentUrl or embedUrl so Google can access the video content.',
    });
  });

  it('folds nested Clip issues into Video rows', () => {
    const [result] = auditGoogleEligibility([
      {
        '@type': 'VideoObject',
        name: 'Video with key moments',
        description: 'A video with incomplete key moment markup.',
        thumbnailUrl: 'https://example.com/thumb.jpg',
        uploadDate: '2026-07-01T10:00:00+05:30',
        duration: 'PT1M',
        contentUrl: 'https://example.com/video.mp4',
        interactionStatistic: {
          '@type': 'InteractionCounter',
          userInteractionCount: 1200,
        },
        hasPart: {
          '@type': 'Clip',
          name: 'Intro',
          startOffset: 0,
        },
      },
    ]);

    expect(result.status).toBe('Ineligible');
    expect(result.issues).toContainEqual({
      property: 'hasPart.url',
      severity: 'error',
      message: '[Clip key moments] Clip key moments is missing required Google field "url".',
    });
  });

  it('folds nested BroadcastEvent issues into Video rows', () => {
    const [result] = auditGoogleEligibility([
      {
        '@type': 'VideoObject',
        name: 'Live video',
        description: 'A video with incomplete live badge markup.',
        thumbnailUrl: 'https://example.com/thumb.jpg',
        uploadDate: '2026-07-01T10:00:00+05:30',
        duration: 'PT1M',
        embedUrl: 'https://example.com/embed/live',
        interactionStatistic: {
          '@type': 'InteractionCounter',
          userInteractionCount: 1200,
        },
        publication: {
          '@type': 'BroadcastEvent',
          isLiveBroadcast: true,
          startDate: '2026-07-01T10:00:00+05:30',
        },
      },
    ]);

    expect(result.status).toBe('Ineligible');
    expect(result.issues).toContainEqual({
      property: 'publication.endDate',
      severity: 'error',
      message: '[LIVE badge] LIVE badge is missing required Google field "endDate".',
    });
  });
});

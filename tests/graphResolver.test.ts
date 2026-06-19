import {
  buildGraphEntityMap,
  consolidateGraphEntities,
  resolveGraph,
  selectBestRootEntity,
  selectBestRootIndex,
  selectUnlinkedRootEntities,
} from '../src';
import { describe, expect, it } from 'vitest';

describe('graph resolver', () => {
  it('indexes entities and resolves nested identity references', () => {
    const entities = [
      {
        '@type': 'Product',
        '@id': '#product',
        name: 'Example Product',
        brand: { '@id': '#brand' },
      },
      {
        '@type': 'Brand',
        '@id': '#brand',
        name: 'Example Brand',
      },
    ];

    const map = buildGraphEntityMap(entities);
    const resolved = resolveGraph(entities, map);

    expect(map.get('#brand')).toMatchObject({
      '@type': 'Brand',
      name: 'Example Brand',
    });
    expect(resolved[0]).toMatchObject({
      '@type': 'Product',
      brand: {
        '@type': 'Brand',
        '@id': '#brand',
        name: 'Example Brand',
      },
    });
  });

  it('selects the highest-priority presentation root', () => {
    const entities = [
      { '@type': 'Organization', name: 'Example Org' },
      { '@type': 'Product', name: 'Example Product' },
    ];

    expect(selectBestRootEntity(entities)).toEqual({
      '@type': 'Product',
      name: 'Example Product',
    });
    expect(selectBestRootIndex(entities)).toBe(1);
  });

  it('prioritizes ProductGroup over site-level organization roots', () => {
    const entities = [
      { '@type': 'Organization', url: '/' },
      { '@type': 'ProductGroup', name: 'Variant Product Group' },
    ];

    expect(selectBestRootEntity(entities)).toEqual({
      '@type': 'ProductGroup',
      name: 'Variant Product Group',
    });
    expect(selectBestRootIndex(entities)).toBe(1);
  });

  it('emits reference markers for circular identity chains', () => {
    const entities = [
      {
        '@type': 'Organization',
        '@id': '#org',
        parentOrganization: { '@id': '#org' },
      },
    ];

    expect(resolveGraph(entities)[0]).toMatchObject({
      parentOrganization: {
        $ref: '#org',
      },
    });
  });

  it('consolidates entities that share the same explicit @id', () => {
    const entities = [
      {
        '@type': 'Product',
        '@id': '#product',
        name: 'Example Product',
        image: ['hero.jpg', ''],
        offers: {
          '@type': 'Offer',
          price: '100',
        },
      },
      {
        '@type': 'Product',
        '@id': '#product',
        name: 'Replacement Name',
        sku: 'SKU-123',
        image: ['hero.jpg', 'gallery.jpg'],
        offers: {
          availability: 'https://schema.org/InStock',
        },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [],
      },
    ];

    expect(consolidateGraphEntities(entities)).toEqual([
      {
        '@type': 'Product',
        '@id': '#product',
        name: 'Example Product',
        image: ['hero.jpg', 'gallery.jpg'],
        offers: {
          '@type': 'Offer',
          price: '100',
          availability: 'https://schema.org/InStock',
        },
        sku: 'SKU-123',
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [],
      },
    ]);
  });

  it('resolves a duplicate @id graph as one merged root', () => {
    const resolved = resolveGraph([
      {
        '@type': 'Product',
        '@id': '#product',
        offers: {
          price: '100',
        },
      },
      {
        '@type': 'Product',
        '@id': '#product',
        offers: {
          priceCurrency: 'INR',
        },
      },
    ]);

    expect(resolved).toEqual([
      {
        '@type': 'Product',
        '@id': '#product',
        offers: {
          price: '100',
          priceCurrency: 'INR',
        },
      },
    ]);
  });

  it('does not merge entities only because they share the same @type', () => {
    expect(consolidateGraphEntities([
      {
        '@type': 'Product',
        name: 'First Product',
      },
      {
        '@type': 'Product',
        name: 'Second Product',
      },
    ])).toEqual([
      {
        '@type': 'Product',
        name: 'First Product',
      },
      {
        '@type': 'Product',
        name: 'Second Product',
      },
    ]);
  });

  it('consolidates products with matching definitive identifiers', () => {
    expect(consolidateGraphEntities([
      {
        '@type': 'Product',
        name: 'Static Product',
        sku: 'SKU-123',
      },
      {
        '@type': 'Product',
        sku: 'sku-123',
        aggregateRating: {
          '@type': 'AggregateRating',
          ratingValue: '4.9',
        },
      },
      {
        '@type': 'Product',
        name: 'GTIN Product',
        gtin: '00012345678905',
      },
      {
        '@type': 'Product',
        gtin14: '00012345678905',
        image: 'gtin-product.jpg',
      },
      {
        '@type': 'Product',
        name: 'URL Product',
        url: 'https://example.com/products/widget/',
      },
      {
        '@type': 'Product',
        url: 'https://example.com/products/widget',
        offers: {
          '@type': 'Offer',
          price: '25',
        },
      },
    ])).toEqual([
      {
        '@type': 'Product',
        name: 'Static Product',
        sku: 'SKU-123',
        aggregateRating: {
          '@type': 'AggregateRating',
          ratingValue: '4.9',
        },
      },
      {
        '@type': 'Product',
        name: 'GTIN Product',
        gtin: '00012345678905',
        gtin14: '00012345678905',
        image: 'gtin-product.jpg',
      },
      {
        '@type': 'Product',
        name: 'URL Product',
        url: 'https://example.com/products/widget/',
        offers: {
          '@type': 'Offer',
          price: '25',
        },
      },
    ]);
  });

  it('marks duplicate static and rendered entities as merged', () => {
    expect(consolidateGraphEntities([
      {
        '@type': 'Product',
        '@id': '#product',
        name: 'Static Name',
        _meta: {
          sourceMode: 'static',
          extractionChannel: 'json-ld',
        },
      },
      {
        '@type': 'Product',
        '@id': '#product',
        aggregateRating: {
          '@type': 'AggregateRating',
          ratingValue: '4.8',
        },
        _meta: {
          sourceMode: 'rendered',
          extractionChannel: 'json-ld',
        },
      },
    ])).toEqual([
      {
        '@type': 'Product',
        '@id': '#product',
        name: 'Static Name',
        aggregateRating: {
          '@type': 'AggregateRating',
          ratingValue: '4.8',
        },
        _meta: {
          sourceMode: 'merged',
          extractionChannel: 'json-ld',
        },
      },
    ]);
  });

  it('does not merge full page-url entities into the canonical product', () => {
    const resolved = resolveGraph([
      {
        '@type': 'Product',
        '@id': '#product',
        url: 'https://example.com/product',
        name: 'Example Product',
      },
      {
        '@type': 'VideoObject',
        url: 'https://example.com/product',
        name: 'Example Product Video',
        contentUrl: 'https://cdn.example.com/video.mp4',
      },
    ]);

    expect(resolved).toEqual([
      {
        '@type': 'Product',
        '@id': '#product',
        url: 'https://example.com/product',
        name: 'Example Product',
      },
      {
        '@type': 'VideoObject',
        url: 'https://example.com/product',
        name: 'Example Product Video',
        contentUrl: 'https://cdn.example.com/video.mp4',
      },
    ]);
  });

  it('caps merged arrays to keep huge variant collections bounded', () => {
    const firstVariants = Array.from({ length: 100 }, (_, index) => ({
      '@id': `#variant-${index}`,
    }));
    const secondVariants = Array.from({ length: 100 }, (_, index) => ({
      '@id': `#variant-${index + 100}`,
    }));

    const [merged] = consolidateGraphEntities([
      {
        '@type': 'ProductGroup',
        '@id': '#group',
        hasVariant: firstVariants,
      },
      {
        '@type': 'ProductGroup',
        '@id': '#group',
        hasVariant: secondVariants,
      },
    ]);

    expect(Array.isArray(merged.hasVariant)).toBe(true);
    expect((merged.hasVariant as unknown[])).toHaveLength(150);
  });

  it('keeps only roots not already linked inside the selected master tree', () => {
    const resolvedEntities = [
      {
        '@type': 'WebPage',
        '@id': '#page',
        isPartOf: {
          '@type': 'WebSite',
          '@id': '#site',
        },
        breadcrumb: {
          '@type': 'BreadcrumbList',
          '@id': '#breadcrumb',
        },
      },
      {
        '@type': 'WebSite',
        '@id': '#site',
      },
      {
        '@type': 'BreadcrumbList',
        '@id': '#breadcrumb',
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [],
      },
    ];

    expect(selectUnlinkedRootEntities(resolvedEntities, 0)).toEqual([
      {
        '@type': 'BreadcrumbList',
        itemListElement: [],
      },
    ]);
  });
});

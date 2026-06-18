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

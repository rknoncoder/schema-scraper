import { describe, expect, it } from 'vitest';
import { homogenizeMicrodata } from '../src';

describe('homogenizeMicrodata', () => {
  it('reconstructs a clean object from flat meta paths', () => {
    const result = homogenizeMicrodata([
      {
        type: 'object',
        meta: {
          path: 'schemas[0]',
          schemaType: 'Product',
        },
      },
      {
        label: 'name',
        type: 'field',
        value: 'Example Product',
        meta: { path: 'schemas[0].name' },
      },
      {
        label: 'offers',
        type: 'object',
        meta: {
          path: 'schemas[0].offers',
          schemaType: 'Offer',
        },
      },
      {
        label: 'price',
        type: 'field',
        value: '19.99',
        meta: { path: 'schemas[0].offers.price' },
      },
    ]);

    expect(result).toEqual([
      {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: 'Example Product',
        offers: {
          '@type': 'Offer',
          price: '19.99',
        },
      },
    ]);
  });

  it('creates nested arrays from indexed paths', () => {
    const result = homogenizeMicrodata([
      {
        type: 'object',
        meta: {
          path: 'schemas[0]',
          schemaType: 'Product',
        },
      },
      {
        type: 'field',
        value: 'https://example.com/one.jpg',
        meta: { path: 'schemas[0].image[0]' },
      },
      {
        type: 'field',
        value: 'https://example.com/two.jpg',
        meta: { path: 'schemas[0].image[1]' },
      },
      {
        type: 'object',
        meta: {
          path: 'schemas[0].offers[0]',
          schemaType: 'Offer',
        },
      },
      {
        type: 'field',
        value: '10.00',
        meta: { path: 'schemas[0].offers[0].price' },
      },
      {
        type: 'object',
        meta: {
          path: 'schemas[0].offers[1]',
          schemaType: 'Offer',
        },
      },
      {
        type: 'field',
        value: '12.00',
        meta: { path: 'schemas[0].offers[1].price' },
      },
    ]);

    expect(result[0]).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'Product',
      image: [
        'https://example.com/one.jpg',
        'https://example.com/two.jpg',
      ],
      offers: [
        {
          '@type': 'Offer',
          price: '10.00',
        },
        {
          '@type': 'Offer',
          price: '12.00',
        },
      ],
    });
  });

  it('returns one object per root schema path', () => {
    const result = homogenizeMicrodata([
      {
        type: 'object',
        meta: {
          path: 'schemas[0]',
          schemaType: 'Product',
        },
      },
      {
        type: 'field',
        value: 'Product name',
        meta: { path: 'schemas[0].name' },
      },
      {
        type: 'object',
        meta: {
          path: 'schemas[1]',
          schemaType: 'LocalBusiness',
        },
      },
      {
        type: 'field',
        value: 'Business name',
        meta: { path: 'schemas[1].name' },
      },
    ]);

    expect(result).toEqual([
      {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: 'Product name',
      },
      {
        '@context': 'https://schema.org',
        '@type': 'LocalBusiness',
        name: 'Business name',
      },
    ]);
  });
});

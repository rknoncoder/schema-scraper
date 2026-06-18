import { describe, expect, it } from 'vitest';
import {
  ASTNode,
  homogenizeAST,
  homogenizeMicrodataAst,
  homogenizeSchemaFormat,
  TreeNode,
} from '../src';

describe('format homogenizer', () => {
  it('follows the provided ASTNode module shape', () => {
    const node: ASTNode = {
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
          id: 'item-1',
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
    };

    expect(homogenizeAST(node)).toEqual({
      '@type': 'BreadcrumbList',
      itemListElement: [
        {
          '@type': 'ListItem',
          position: '1',
        },
      ],
    });
  });

  it('unwraps a structural microdata AST into a clean object literal', () => {
    const tree: TreeNode = {
      id: 'schemas[0]',
      label: 'Schema #1',
      type: 'object',
      source: 'microdata',
      children: [
        field('@context', 'https://schema.org', 'schemas[0].@context'),
        field('@type', 'BreadcrumbList', 'schemas[0].@type'),
        {
          id: 'schemas[0].itemListElement',
          label: 'itemListElement',
          type: 'array',
          source: 'microdata',
          children: [
            {
              id: 'schemas[0].itemListElement[0]',
              label: '[0]',
              type: 'object',
              source: 'microdata',
              meta: {
                path: 'schemas[0].itemListElement[0]',
                schemaType: 'ListItem',
              },
              children: [
                field('position', 1, 'schemas[0].itemListElement[0].position'),
                {
                  id: 'schemas[0].itemListElement[0].item',
                  label: 'item',
                  type: 'object',
                  source: 'microdata',
                  meta: {
                    path: 'schemas[0].itemListElement[0].item',
                    schemaType: 'WebPage',
                    idRef: 'https://example.com/',
                  },
                  children: [
                    field('name', 'Home', 'schemas[0].itemListElement[0].item.name'),
                  ],
                },
              ],
            },
          ],
          meta: { path: 'schemas[0].itemListElement' },
        },
      ],
      meta: {
        path: 'schemas[0]',
        schemaType: 'BreadcrumbList',
      },
    };

    expect(homogenizeMicrodataAst(tree)).toEqual([
      {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          {
            '@type': 'ListItem',
            position: 1,
            item: {
              '@type': 'WebPage',
              '@id': 'https://example.com/',
              name: 'Home',
            },
          },
        ],
      },
    ]);
  });

  it('turns repeated AST object properties into arrays', () => {
    const tree: TreeNode = {
      id: 'schemas[0]',
      label: 'Schema #1',
      type: 'object',
      source: 'microdata',
      meta: {
        path: 'schemas[0]',
        schemaType: 'Product',
      },
      children: [
        field('image', 'one.jpg', 'schemas[0].image'),
        field('image', 'two.jpg', 'schemas[0].image'),
      ],
    };

    expect(homogenizeMicrodataAst(tree)).toEqual([
      {
        '@context': 'https://schema.org',
        '@type': 'Product',
        image: ['one.jpg', 'two.jpg'],
      },
    ]);
  });

  it('passes clean JSON-LD data through while converting microdata blocks', () => {
    const result = homogenizeSchemaFormat([
      {
        source: 'json-ld',
        data: {
          '@context': 'https://schema.org',
          '@type': 'Organization',
          name: 'Example Org',
        },
      },
      {
        source: 'microdata',
        tree: {
          id: 'schemas[1]',
          label: 'Schema #2',
          type: 'object',
          source: 'microdata',
          meta: {
            path: 'schemas[1]',
            schemaType: 'Product',
          },
          children: [
            field('name', 'Example Product', 'schemas[1].name'),
          ],
        },
      },
    ]);

    expect(result).toEqual([
      {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: 'Example Org',
      },
      {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: 'Example Product',
      },
    ]);
  });
});

function field(
  label: string,
  value: string | number | boolean,
  path: string
): TreeNode {
  return {
    id: path,
    label,
    type: 'field',
    source: 'microdata',
    value,
    children: [],
    meta: { path },
  };
}

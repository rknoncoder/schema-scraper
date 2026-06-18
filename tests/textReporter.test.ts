import { describe, expect, it } from 'vitest';
import { TextReporter } from '../src';

const TEE = '\u251c\u2500\u2500 ';
const ELBOW = '\u2514\u2500\u2500 ';
const PIPE = '\u2502   ';

describe('text reporter', () => {
  it('renders objects with box-drawing branches and schema types', () => {
    const output = new TextReporter().renderTree({
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: 'Example Product',
      offers: {
        '@type': 'Offer',
        price: '19.99',
      },
    }, { color: false });

    expect(output).toContain('Resolved Schema Tree (Root: Product)');
    expect(output).toContain(`${TEE}@type: "Product"`);
    expect(output).toContain(`${TEE}name: "Example Product"`);
    expect(output).toContain(`${ELBOW}offers [Offer]`);
    expect(output).toContain(`    ${TEE}@type: "Offer"`);
    expect(output).toContain(`    ${ELBOW}price: "19.99"`);
  });

  it('renders array indices as native terminal tree nodes', () => {
    const output = new TextReporter().renderTree({
      '@type': 'BreadcrumbList',
      itemListElement: [
        {
          '@type': 'ListItem',
          position: 1,
          name: 'Home',
        },
      ],
    }, { color: false });

    expect(output).toContain(`${ELBOW}itemListElement`);
    expect(output).toContain(`    ${ELBOW}[0] [ListItem]`);
    expect(output).toContain(`        ${TEE}@type: "ListItem"`);
    expect(output).toContain(`        ${TEE}position: 1`);
    expect(output).toContain(`        ${ELBOW}name: "Home"`);
  });

  it('renders explicit and actual circular pointers without recursing forever', () => {
    const entity: any = {
      '@type': 'Organization',
      name: 'Example Org',
      sameAs: { $ref: '#org' },
    };
    entity.parent = entity;

    const output = new TextReporter().renderTree(entity, { color: false });

    expect(output).toContain(`${TEE}sameAs: \u2192 ref: #org`);
    expect(output).toContain(`${ELBOW}parent [Organization]`);
    expect(output).toContain(`    ${ELBOW}\u21bb circular pointer: $`);
  });

  it('keeps sibling pipes aligned when rendering nested object internals', () => {
    const output = new TextReporter().renderTree({
      '@type': 'WebPage',
      isPartOf: {
        '@type': 'WebSite',
        publisher: {
          '@type': 'Organization',
          name: 'Example Org',
        },
        inLanguage: 'en-US',
      },
      name: 'Example Page',
    }, { color: false });

    expect(output).toContain(`${TEE}isPartOf [WebSite]`);
    expect(output).toContain(`${PIPE}${TEE}@type: "WebSite"`);
    expect(output).toContain(`${PIPE}${TEE}publisher [Organization]`);
    expect(output).toContain(`${PIPE}${PIPE}${ELBOW}name: "Example Org"`);
    expect(output).toContain(`${PIPE}${ELBOW}inLanguage: "en-US"`);
    expect(output).toContain(`${ELBOW}name: "Example Page"`);
  });
});

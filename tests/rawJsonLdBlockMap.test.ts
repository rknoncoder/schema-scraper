import { describe, expect, it } from 'vitest';
import { buildRawJsonLdBlockMap, extractSchemasFromHtml } from '../src';

describe('raw JSON-LD block map', () => {
  it('summarizes typed and untyped JSON-LD script blocks without resolving them', () => {
    const schemas = extractSchemasFromHtml(`
      <script type="application/ld+json">
        { "@context": "https://schema.org", "@type": "Organization", "name": "Demo Org" }
      </script>
      <script type="application/ld+json">
        { "event": "view_item", "currency": "USD" }
      </script>
    `, 'static');

    const map = buildRawJsonLdBlockMap(schemas);

    expect(map.summary).toMatchObject({
      blockCount: 2,
      typedBlockCount: 1,
      untypedBlockCount: 1,
      noCrossBlockIdLinkBlockCount: 2,
      analyticsPayloadBlockCount: 1,
    });
    expect(map.nodes.find(node => node.id === 'raw-block-2')).toMatchObject({
      label: 'Block #2: Analytics/Data Layer Payload',
      badges: expect.arrayContaining([
        'Untyped JSON-LD',
        'Analytics/Data Layer Payload',
        'No Cross-Block @id Links',
      ]),
      status: 'warning',
    });
  });

  it('counts nested typed schema nodes and internal parent-child links', () => {
    const schemas = extractSchemasFromHtml(`
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "ItemList",
          "itemListElement": [
            { "@type": "ListItem", "position": 1, "name": "One" },
            { "@type": "ListItem", "position": 2, "name": "Two" }
          ]
        }
      </script>
    `, 'static');

    const map = buildRawJsonLdBlockMap(schemas);

    expect(map.summary).toMatchObject({
      blockCount: 1,
      typedBlockCount: 1,
      nestedTypedSchemaNodeCount: 2,
      internalParentChildLinkCount: 2,
    });
    expect(map.nodes.filter(node => node.type === 'ListItem')).toHaveLength(2);
  });

  it('keeps cross-block @id references separate and links them as unresolved references', () => {
    const schemas = extractSchemasFromHtml(`
      <script type="application/ld+json">
        { "@context": "https://schema.org", "@type": "Organization", "@id": "#org", "name": "Demo Org" }
      </script>
      <script type="application/ld+json">
        { "@context": "https://schema.org", "@type": "Product", "name": "Demo Product", "brand": { "@id": "#org" } }
      </script>
    `, 'static');

    const map = buildRawJsonLdBlockMap(schemas);
    const crossBlockLink = map.links.find(link => link.kind === 'cross-block-reference');
    const referenceNode = map.nodes.find(node => node.id === crossBlockLink?.sourceId);

    expect(map.summary.crossBlockReferenceCount).toBe(1);
    expect(crossBlockLink).toMatchObject({
      label: 'refers to @id (Cross-Block)',
      status: 'warning',
    });
    expect(referenceNode).toMatchObject({
      kind: 'reference',
      blockIndex: 2,
      badges: expect.arrayContaining(['@id Reference', 'Cross-Block Ref']),
    });
    expect(map.nodes.filter(node => node.kind === 'block')).toHaveLength(2);
  });

  it('marks missing @id references as orphan references', () => {
    const schemas = extractSchemasFromHtml(`
      <script type="application/ld+json">
        { "@context": "https://schema.org", "@type": "Product", "brand": { "@id": "#missing" } }
      </script>
    `, 'static');

    const map = buildRawJsonLdBlockMap(schemas);
    const orphanNode = map.nodes.find(node => node.badges.includes('Orphan Reference'));

    expect(map.summary.orphanReferenceCount).toBe(1);
    expect(orphanNode).toMatchObject({
      kind: 'reference',
      status: 'error',
      badges: expect.arrayContaining(['Orphan Reference']),
    });
  });
});

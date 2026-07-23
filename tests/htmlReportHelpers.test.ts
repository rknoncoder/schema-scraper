import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { renderHtmlReport, type ResolvedAuditReport } from '../src/reporter/htmlReport';

function sampleReport(): ResolvedAuditReport {
  return {
    url: 'https://example.com/product',
    finalUrl: 'https://example.com/product',
    generatedAt: '2026-01-01T00:00:00.000Z',
    rawEntitiesForGraphResolver: [
      { '@context': 'https://schema.org', '@type': 'Product', name: 'Demo' },
    ],
    strictGoogleEntities: [
      { '@context': 'https://schema.org', '@type': 'Product', name: 'Demo' },
    ],
    strictGoogleDiscardedCount: 0,
    entitiesForGraphResolver: [
      { '@context': 'https://schema.org', '@type': 'Product', name: 'Demo' },
    ],
    resolvedEntities: [
      { '@context': 'https://schema.org', '@type': 'Product', name: 'Demo' },
    ],
    scrapeWarnings: [],
    detectedSyntaxErrors: [],
    qualityWarnings: [],
    primaryRoot: { '@context': 'https://schema.org', '@type': 'Product', name: 'Demo' },
    orphanRoots: [],
    health: {
      registryIdCount: 0,
      connectedTreeElementCount: 0,
      brokenLinks: [],
      status: 'success',
    },
    jsonLdDiagnostics: {
      jsonLdBlockCount: 1,
      typedSchemaBlockCount: 1,
      untypedJsonLdBlockCount: 0,
      blocks: [
        {
          index: 1,
          sourceMode: 'static',
          valid: true,
          syntaxStatus: 'valid',
          types: ['Product'],
          entityCount: 1,
          rawLength: 72,
        },
      ],
    },
    rawJsonLdBlockMap: {
      nodes: [
        {
          id: 'raw-block-1',
          label: 'Block #1: Product',
          type: 'Product',
          kind: 'block',
          status: 'ok',
          blockIndex: 1,
          sourceMode: 'static',
          path: 'Block #1',
          badges: [],
          details: [{ key: 'block', value: '#1' }],
        },
      ],
      links: [],
      summary: {
        blockCount: 1,
        typedBlockCount: 1,
        untypedBlockCount: 0,
        isolatedBlockCount: 1,
        noCrossBlockIdLinkBlockCount: 1,
        nestedTypedSchemaNodeCount: 0,
        internalParentChildLinkCount: 0,
        analyticsPayloadBlockCount: 0,
        crossBlockReferenceCount: 0,
        orphanReferenceCount: 0,
        parseErrorBlockCount: 0,
        truncated: false,
      },
    },
  };
}

describe('HTML report helpers', () => {
  it('ships guarded deferred map controls in parseable browser script', () => {
    const html = renderHtmlReport(sampleReport());
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];

    expect(script).toBeTruthy();
    expect(script).toContain('function ensureSchemaMapReady()');
    expect(script).toContain('if (!ensureSchemaMapReady()) return;');
    expect(html).toContain('id="toggle-system-keys"');
    expect(html).toContain('JSON-LD Script Blocks');
    expect(html).toContain('Typed JSON-LD Script Blocks');
    expect(html).toContain('Untyped JSON-LD / Data Payload Blocks');
    expect(html).toContain('Resolved Entity Graph');
    expect(html).toContain('Raw Script Block Map');
    expect(html).toContain('Download PNG');
    expect(html).toContain('Static vs Rendered Diff');
    expect(script).toContain('function downloadCurrentSchemaMapPng()');
    expect(script).toContain('function prepareSchemaMapSvgForPngExport(svg)');
    expect(script).toContain('function isAnalyticsDataPayload(value)');
    expect(script).toContain('const scale = 2;');
    expect(script).toContain('treeViewState.showSystemFields');
    expect(() => new vm.Script(script ?? '')).not.toThrow();
  });
});

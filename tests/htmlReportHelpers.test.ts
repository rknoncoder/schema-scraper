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
    expect(html).toContain('Blocks Detected');
    expect(html).toContain('Static vs Rendered Diff');
    expect(script).toContain('treeViewState.showSystemFields');
    expect(() => new vm.Script(script ?? '')).not.toThrow();
  });
});

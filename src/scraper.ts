import { extractAll, ExtractedSchema } from './extractors';
import { fetchHtml } from './fetcher';
import { fetchRenderedHtml } from './renderedFetcher';
import { buildSourceTree } from './tree/sourceTreeBuilder';
import { TreeNode } from './tree/treeNode';
import {
  validateAndParseJSON,
  type SyntaxErrorDetail,
  type ValidationReport,
} from './analyzer/syntaxValidator';

export type ScrapeSourceMode = 'static' | 'rendered';
export type ScrapeRenderMode = ScrapeSourceMode | 'dual-pass';

export interface ScrapeOptions {
  deepRender?: boolean;
  renderMode?: ScrapeRenderMode;
  timeoutMs?: number;
}

export interface RawSchemaBlock {
  source: ExtractedSchema['source'];
  sourceMode?: ScrapeSourceMode;
  raw?: string;
  data?: object;
  parseError?: string;
  syntaxStatus?: ValidationReport['status'];
  syntaxError?: SyntaxErrorDetail;
  jsonLdBlockIndex?: number;
  jsonLdTypes?: string[];
  jsonLdEntityCount?: number;
  tree: TreeNode;
}

export interface JsonLdBlockDiagnostic {
  index: number;
  sourceMode: ScrapeSourceMode;
  valid: boolean;
  syntaxStatus?: ValidationReport['status'];
  types: string[];
  entityCount: number;
  rawLength: number;
  parseError?: string;
  syntaxError?: SyntaxErrorDetail;
}

export interface JsonLdDiagnostics {
  jsonLdBlockCount: number;
  blocks: JsonLdBlockDiagnostic[];
  note?: string;
}

export interface SchemaDiffEntry {
  source: RawSchemaBlock['source'];
  sourceMode?: ScrapeSourceMode;
  types: string[];
  id?: string;
  name?: string;
  fingerprint: string;
  occurrences: number;
  parseError?: string;
}

export interface StaticRenderedSchemaDiff {
  staticOnly: SchemaDiffEntry[];
  renderedOnly: SchemaDiffEntry[];
  both: SchemaDiffEntry[];
}

export interface ScrapeResult {
  url: string;
  finalUrl: string;
  schemas: RawSchemaBlock[];
  warnings?: string[];
  staticRenderedDiff?: StaticRenderedSchemaDiff;
  jsonLdDiagnostics: JsonLdDiagnostics;
}

export async function scrapeSchema(
  url: string,
  options: ScrapeOptions = {}
): Promise<ScrapeResult> {
  if (options.renderMode === 'rendered') {
    return scrapeRenderedSchema(url, options);
  }

  if (options.renderMode === 'dual-pass') {
    return scrapeSchemaDualPass(url, options);
  }

  const fetched = await fetchHtml(url, { timeoutMs: options.timeoutMs });

  const schemas = extractSchemasFromHtml(fetched.html);

  return {
    url,
    finalUrl: fetched.finalUrl,
    schemas,
    jsonLdDiagnostics: buildJsonLdDiagnostics(schemas, 'static'),
  };
}

export async function scrapeRenderedSchema(
  url: string,
  options: ScrapeOptions = {}
): Promise<ScrapeResult> {
  const fetched = await fetchRenderedHtml(url, {
    deepRender: options.deepRender,
    timeoutMs: options.timeoutMs,
  });

  const schemas = extractSchemasFromHtml(fetched.html, 'rendered');

  return {
    url,
    finalUrl: fetched.finalUrl,
    schemas,
    jsonLdDiagnostics: buildJsonLdDiagnostics(schemas, 'rendered'),
  };
}

export function scrapeJsonLdInput(
  rawJsonLd: string,
  sourceLabel = 'inline-jsonld'
): ScrapeResult {
  const raw = stripJsonLdScriptWrapper(rawJsonLd);
  const validation = validateAndParseJSON(raw);
  const schema: ExtractedSchema = {
    source: 'json-ld',
    data: validation.parsedData ?? {},
    raw,
    parseError: validation.status === 'critical'
      ? validation.error?.message ?? 'Invalid JSON-LD input.'
      : undefined,
    syntaxStatus: validation.status,
    syntaxError: validation.error,
  };

  const block = toRawSchemaBlock(schema, 0, 'static');

  return {
    url: sourceLabel,
    finalUrl: sourceLabel,
    schemas: [block],
    jsonLdDiagnostics: buildJsonLdDiagnostics([block], 'static'),
  };
}

export async function scrapeSchemaDualPass(
  url: string,
  options: ScrapeOptions = {}
): Promise<ScrapeResult> {
  const staticFetched = await fetchHtml(url, { timeoutMs: options.timeoutMs });
  const staticSchemas = extractSchemasFromHtml(staticFetched.html, 'static');

  try {
    const renderedFetched = await fetchRenderedHtml(url, {
      deepRender: options.deepRender,
      timeoutMs: options.timeoutMs,
    });
    const allRenderedSchemas = extractSchemasFromHtml(renderedFetched.html, 'rendered');
    const renderedSchemas = filterRenderedDuplicates(
      staticSchemas,
      allRenderedSchemas
    );

    return {
      url,
      finalUrl: renderedFetched.finalUrl || staticFetched.finalUrl,
      schemas: [...staticSchemas, ...renderedSchemas],
      staticRenderedDiff: compareStaticRenderedSchemas(staticSchemas, allRenderedSchemas),
      jsonLdDiagnostics: buildJsonLdDiagnostics([
        ...staticSchemas,
        ...renderedSchemas,
      ]),
    };
  } catch (error) {
    return {
      url,
      finalUrl: staticFetched.finalUrl,
      schemas: staticSchemas,
      staticRenderedDiff: compareStaticRenderedSchemas(staticSchemas, []),
      jsonLdDiagnostics: buildJsonLdDiagnostics(staticSchemas, 'static'),
      warnings: [
        `Rendered pass failed; report contains static schemas only. ${errorMessage(error)}`,
      ],
    };
  }
}

export function extractSchemasFromHtml(
  html: string,
  sourceMode?: ScrapeSourceMode
): RawSchemaBlock[] {
  return extractAll(html).map((schema, index) =>
    toRawSchemaBlock(schema, index, sourceMode)
  );
}

function toRawSchemaBlock(
  schema: ExtractedSchema,
  index: number,
  sourceMode?: ScrapeSourceMode
): RawSchemaBlock {
  const treeValue = schema.parseError
    ? { parseError: schema.parseError, raw: schema.raw }
    : schema.data;

  return {
    source: schema.source,
    sourceMode,
    raw: schema.raw,
    data: schema.parseError ? undefined : schema.data,
    parseError: schema.parseError,
    syntaxStatus: schema.syntaxStatus,
    syntaxError: schema.syntaxError,
    jsonLdBlockIndex: schema.jsonLdBlockIndex,
    jsonLdTypes: schema.jsonLdTypes,
    jsonLdEntityCount: schema.jsonLdEntityCount,
    tree: buildSourceTree(treeValue, schema.source, index + 1),
  };
}

function filterRenderedDuplicates(
  staticSchemas: RawSchemaBlock[],
  renderedSchemas: RawSchemaBlock[]
): RawSchemaBlock[] {
  const staticFingerprints = new Set(staticSchemas.map(schemaFingerprint));
  return renderedSchemas.filter(schema => !staticFingerprints.has(schemaFingerprint(schema)));
}

export function compareStaticRenderedSchemas(
  staticSchemas: RawSchemaBlock[],
  renderedSchemas: RawSchemaBlock[]
): StaticRenderedSchemaDiff {
  const staticMap = groupSchemaDiffEntries(staticSchemas);
  const renderedMap = groupSchemaDiffEntries(renderedSchemas);

  return {
    staticOnly: entriesMissingFrom(staticMap, renderedMap),
    renderedOnly: entriesMissingFrom(renderedMap, staticMap),
    both: [...staticMap.entries()]
      .filter(([fingerprint]) => renderedMap.has(fingerprint))
      .map(([, entry]) => entry),
  };
}

export function buildJsonLdDiagnostics(
  schemas: RawSchemaBlock[],
  fallbackSourceMode: ScrapeSourceMode = 'static'
): JsonLdDiagnostics {
  const blocks = schemas
    .filter(schema => schema.source === 'json-ld')
    .map((schema, index): JsonLdBlockDiagnostic => ({
      index: schema.jsonLdBlockIndex ?? index + 1,
      sourceMode: schema.sourceMode ?? fallbackSourceMode,
      valid: !schema.parseError,
      syntaxStatus: schema.syntaxStatus,
      types: schema.jsonLdTypes ?? schemaTypes(schema.data ?? {}),
      entityCount: schema.jsonLdEntityCount ?? schemaEntityCount(schema.data ?? {}),
      rawLength: schema.raw?.length ?? 0,
      parseError: schema.parseError,
      syntaxError: schema.syntaxError,
    }));

  return {
    jsonLdBlockCount: blocks.length,
    blocks,
    note: blocks.length > 1
      ? 'Multiple JSON-LD script blocks detected. Ensure entities across separate blocks do not conflict and are connected using @id references where applicable.'
      : undefined,
  };
}

function groupSchemaDiffEntries(schemas: RawSchemaBlock[]): Map<string, SchemaDiffEntry> {
  const entries = new Map<string, SchemaDiffEntry>();

  schemas.forEach(schema => {
    const fingerprint = schemaFingerprint(schema);
    const existing = entries.get(fingerprint);

    if (existing) {
      existing.occurrences += 1;
      return;
    }

    entries.set(fingerprint, {
      ...schemaDiffEntry(schema),
      fingerprint,
      occurrences: 1,
    });
  });

  return entries;
}

function entriesMissingFrom(
  source: Map<string, SchemaDiffEntry>,
  comparison: Map<string, SchemaDiffEntry>
): SchemaDiffEntry[] {
  return [...source.entries()]
    .filter(([fingerprint]) => !comparison.has(fingerprint))
    .map(([, entry]) => entry);
}

function schemaDiffEntry(schema: RawSchemaBlock): Omit<SchemaDiffEntry, 'fingerprint' | 'occurrences'> {
  const sample = schema.data ?? {};

  return {
    source: schema.source,
    sourceMode: schema.sourceMode,
    types: schemaTypes(sample),
    id: firstStringValue(sample, '@id'),
    name: firstStringValue(sample, 'name'),
    parseError: schema.parseError,
  };
}

function schemaTypes(value: unknown): string[] {
  if (Array.isArray(value)) {
    return uniqueStrings(value.flatMap(schemaTypes));
  }

  if (!value || typeof value !== 'object') return [];

  const record = value as Record<string, unknown>;
  const graph = record['@graph'];
  if (Array.isArray(graph)) {
    return uniqueStrings(graph.flatMap(schemaTypes));
  }

  const type = record['@type'];
  if (typeof type === 'string') return [type];
  if (Array.isArray(type)) {
    return uniqueStrings(type.filter((item): item is string => typeof item === 'string'));
  }

  return [];
}

function schemaEntityCount(value: unknown): number {
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + schemaEntityCount(item), 0);
  if (!value || typeof value !== 'object') return 0;

  const graph = (value as Record<string, unknown>)['@graph'];
  return Array.isArray(graph)
    ? graph.filter(item => Boolean(item) && typeof item === 'object' && !Array.isArray(item)).length
    : 1;
}

function firstStringValue(value: unknown, key: string): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstStringValue(item, key);
      if (found) return found;
    }
    return undefined;
  }

  if (!value || typeof value !== 'object') return undefined;

  const record = value as Record<string, unknown>;
  const direct = record[key];
  if (typeof direct === 'string' && direct.trim().length > 0) return direct;

  const graph = record['@graph'];
  return Array.isArray(graph) ? firstStringValue(graph, key) : undefined;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function schemaFingerprint(schema: RawSchemaBlock): string {
  return `${schema.source}:${stableStringify(schema.data ?? schema.raw ?? schema.parseError ?? null)}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')}}`;
  }

  return JSON.stringify(value) ?? 'undefined';
}

function stripJsonLdScriptWrapper(value: string): string {
  const match = value.match(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i
  );

  return (match ? match[1] : value).trim();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

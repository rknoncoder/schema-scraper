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
  tree: TreeNode;
}

export interface ScrapeResult {
  url: string;
  finalUrl: string;
  schemas: RawSchemaBlock[];
  warnings?: string[];
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

  return {
    url,
    finalUrl: fetched.finalUrl,
    schemas: extractSchemasFromHtml(fetched.html),
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

  return {
    url,
    finalUrl: fetched.finalUrl,
    schemas: extractSchemasFromHtml(fetched.html, 'rendered'),
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

  return {
    url: sourceLabel,
    finalUrl: sourceLabel,
    schemas: [toRawSchemaBlock(schema, 0, 'static')],
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
    const renderedSchemas = filterRenderedDuplicates(
      staticSchemas,
      extractSchemasFromHtml(renderedFetched.html, 'rendered')
    );

    return {
      url,
      finalUrl: renderedFetched.finalUrl || staticFetched.finalUrl,
      schemas: [...staticSchemas, ...renderedSchemas],
    };
  } catch (error) {
    return {
      url,
      finalUrl: staticFetched.finalUrl,
      schemas: staticSchemas,
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

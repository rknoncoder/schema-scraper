import * as cheerio from 'cheerio';
import {
  SyntaxErrorDetail,
  validateAndParseJSON,
  ValidationReport,
} from '../analyzer/syntaxValidator';

export interface JsonLdBlock {
  index: number;
  raw: string;
  parsed?: object;
  parseError?: string;
  syntaxStatus: ValidationReport['status'];
  syntaxError?: SyntaxErrorDetail;
  types: string[];
  entityCount: number;
}

export function extractJsonLd(html: string): JsonLdBlock[] {
  const $ = cheerio.load(html);
  const blocks: JsonLdBlock[] = [];

  $('script[type="application/ld+json"]').each((index, element) => {
    const raw = $(element).contents().text().trim();
    blocks.push(parseJsonLdBlock(raw, index + 1));
  });

  return blocks;
}

function parseJsonLdBlock(raw: string, index: number): JsonLdBlock {
  const report = validateAndParseJSON(raw);
  const parsed = report.parsedData as unknown;

  if (typeof parsed === 'object' && parsed !== null) {
    return {
      index,
      raw,
      parsed: parsed as object,
      syntaxStatus: report.status,
      syntaxError: report.error,
      types: schemaTypes(parsed),
      entityCount: schemaEntityCount(parsed),
    };
  }

  return {
    index,
    raw,
    parseError: report.error?.message ?? 'JSON-LD must parse to an object or array.',
    syntaxStatus: report.status === 'valid' ? 'critical' : report.status,
    syntaxError: report.error,
    types: [],
    entityCount: 0,
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
  return Array.isArray(graph) ? graph.filter(isRecord).length : 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

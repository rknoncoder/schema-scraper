import * as cheerio from 'cheerio';
import {
  SyntaxErrorDetail,
  validateAndParseJSON,
  ValidationReport,
} from '../analyzer/syntaxValidator';

export interface JsonLdBlock {
  raw: string;
  parsed?: object;
  parseError?: string;
  syntaxStatus: ValidationReport['status'];
  syntaxError?: SyntaxErrorDetail;
}

export function extractJsonLd(html: string): JsonLdBlock[] {
  const $ = cheerio.load(html);
  const blocks: JsonLdBlock[] = [];

  $('script[type="application/ld+json"]').each((_, element) => {
    const raw = $(element).contents().text().trim();
    if (!raw) return;

    blocks.push(parseJsonLdBlock(raw));
  });

  return blocks;
}

function parseJsonLdBlock(raw: string): JsonLdBlock {
  const report = validateAndParseJSON(raw);
  const parsed = report.parsedData as unknown;

  if (typeof parsed === 'object' && parsed !== null) {
    return {
      raw,
      parsed: parsed as object,
      syntaxStatus: report.status,
      syntaxError: report.error,
    };
  }

  return {
    raw,
    parseError: report.error?.message ?? 'JSON-LD must parse to an object or array.',
    syntaxStatus: report.status === 'valid' ? 'critical' : report.status,
    syntaxError: report.error,
  };
}

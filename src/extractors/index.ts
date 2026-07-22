import { extractJsonLd } from './jsonLdExtractor';
import { extractMicrodata } from './microdataExtractor';
import { extractRdfa } from './rdfaExtractor';
import type { SyntaxErrorDetail, ValidationReport } from '../analyzer/syntaxValidator';

export type ExtractionSource = 'json-ld' | 'microdata' | 'rdfa';

export interface ExtractedSchema {
  source: ExtractionSource;
  data: object;
  raw?: string;
  parseError?: string;
  syntaxStatus?: ValidationReport['status'];
  syntaxError?: SyntaxErrorDetail;
  jsonLdBlockIndex?: number;
  jsonLdTypes?: string[];
  jsonLdEntityCount?: number;
}

export function extractAll(html: string): ExtractedSchema[] {
  const jsonLdSchemas: ExtractedSchema[] = extractJsonLd(html).map(block => ({
    source: 'json-ld',
    data: block.parsed ?? {},
    raw: block.raw,
    parseError: block.parseError,
    syntaxStatus: block.syntaxStatus,
    syntaxError: block.syntaxError,
    jsonLdBlockIndex: block.index,
    jsonLdTypes: block.types,
    jsonLdEntityCount: block.entityCount,
  }));

  const microdataSchemas: ExtractedSchema[] = extractMicrodata(html).map(data => ({
    source: 'microdata',
    data,
    raw: JSON.stringify(data),
  }));

  const rdfaSchemas: ExtractedSchema[] = extractRdfa(html).map(data => ({
    source: 'rdfa',
    data,
    raw: JSON.stringify(data),
  }));

  return [
    ...jsonLdSchemas,
    ...microdataSchemas,
    ...rdfaSchemas,
  ];
}

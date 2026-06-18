import { extractAll, ExtractedSchema } from './extractors';
import { fetchHtml } from './fetcher';
import { buildSourceTree } from './tree/sourceTreeBuilder';
import { TreeNode } from './tree/treeNode';
import type { SyntaxErrorDetail, ValidationReport } from './analyzer/syntaxValidator';

export interface RawSchemaBlock {
  source: ExtractedSchema['source'];
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
}

export async function scrapeSchema(url: string): Promise<ScrapeResult> {
  const fetched = await fetchHtml(url);

  return {
    url,
    finalUrl: fetched.finalUrl,
    schemas: extractSchemasFromHtml(fetched.html),
  };
}

export function extractSchemasFromHtml(html: string): RawSchemaBlock[] {
  return extractAll(html).map((schema, index) => toRawSchemaBlock(schema, index));
}

function toRawSchemaBlock(schema: ExtractedSchema, index: number): RawSchemaBlock {
  const treeValue = schema.parseError
    ? { parseError: schema.parseError, raw: schema.raw }
    : schema.data;

  return {
    source: schema.source,
    raw: schema.raw,
    data: schema.parseError ? undefined : schema.data,
    parseError: schema.parseError,
    syntaxStatus: schema.syntaxStatus,
    syntaxError: schema.syntaxError,
    tree: buildSourceTree(treeValue, schema.source, index + 1),
  };
}

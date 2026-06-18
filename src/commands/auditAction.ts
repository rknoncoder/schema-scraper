import { homogenizeAST, homogenizeMicrodataAst, type ASTNode } from '../analyzer/formatHomogenizer';
import {
  validateAndParseJSON,
  type SyntaxErrorDetail,
  type ValidationReport,
} from '../analyzer/syntaxValidator';
import { scrapeSchema, type ScrapeResult } from '../scraper';
import type { TreeNode } from '../tree/treeNode';
import chalk from 'chalk';

type JsonObject = Record<string, unknown>;

export interface AuditActionResult {
  entitiesForGraphResolver: JsonObject[];
  detectedSyntaxErrors: SyntaxErrorDetail[];
}

export interface GraphResolutionHealthReport {
  registryIdCount: number;
  connectedTreeElementCount: number;
  brokenLinks: string[];
  status: 'success' | 'warning';
}

export interface GraphResolutionHealthOptions {
  log?: boolean;
  color?: boolean;
}

export async function auditUrl(url: string): Promise<AuditActionResult> {
  return processRawPayload(await scrapeSchema(url));
}

export function processRawPayload(rawPayload: ScrapeResult | any): AuditActionResult {
  const unifiedEntities: JsonObject[] = [];
  const syntaxErrors: SyntaxErrorDetail[] = [];

  for (const item of rawPayload?.schemas ?? []) {
    if (item?.source === 'json-ld') {
      const audit = parseJsonLdItem(item);

      if (audit.error) {
        syntaxErrors.push(audit.error);
      }

      unifiedEntities.push(...entitiesFromParsedJsonLd(audit.parsedData));
      continue;
    }

    if (item?.source === 'microdata' || item?.source === 'rdfa') {
      unifiedEntities.push(...entitiesFromAstItem(item));
    }
  }

  return {
    entitiesForGraphResolver: unifiedEntities,
    detectedSyntaxErrors: syntaxErrors,
  };
}

export function verifyGraphResolutionHealth(
  rawEntities: any[],
  resolvedTree: any,
  options: GraphResolutionHealthOptions = {}
): GraphResolutionHealthReport {
  const shouldLog = options.log ?? true;
  const useColor = options.color ?? true;
  const inputIds = new Set<string>();
  const foundTreeRefs = new Set<string>();
  const explicitRefs = new Set<string>();

  rawEntities.forEach(entity => collectIds(entity, inputIds));
  trackResolvedRefs(resolvedTree, foundTreeRefs, explicitRefs);

  const brokenLinks = [...explicitRefs].filter(id => !inputIds.has(id));
  const report: GraphResolutionHealthReport = {
    registryIdCount: inputIds.size,
    connectedTreeElementCount: foundTreeRefs.size,
    brokenLinks,
    status: brokenLinks.length > 0 ? 'warning' : 'success',
  };

  if (shouldLog) {
    logGraphResolutionHealth(report, useColor);
  }

  return report;
}

function parseJsonLdItem(item: any): ValidationReport {
  if (typeof item.raw === 'string') {
    return validateAndParseJSON(item.raw);
  }

  if (item.syntaxError) {
    return {
      status: item.syntaxStatus ?? 'critical',
      parsedData: item.data ?? null,
      error: item.syntaxError,
    };
  }

  return {
    status: 'valid',
    parsedData: item.data ?? null,
  };
}

function entitiesFromParsedJsonLd(parsedData: unknown): JsonObject[] {
  if (Array.isArray(parsedData)) {
    return parsedData.flatMap(entitiesFromParsedJsonLd);
  }

  if (!isJsonObject(parsedData)) return [];

  const graph = parsedData['@graph'];
  if (Array.isArray(graph)) {
    return graph.filter(isJsonObject);
  }

  return [parsedData];
}

function entitiesFromAstItem(item: any): JsonObject[] {
  if (isTreeNode(item.tree)) {
    return homogenizeMicrodataAst(item.tree);
  }

  if (Array.isArray(item.children) && item.children.length > 0) {
    return item.children
      .map((child: unknown) => homogenizeUnknownAst(child))
      .filter(isJsonObject);
  }

  if (isJsonObject(item.data)) {
    return [item.data];
  }

  return [];
}

function homogenizeUnknownAst(node: unknown): unknown {
  if (isModuleAstNode(node)) {
    return homogenizeAST(node);
  }

  if (isTreeNode(node)) {
    return homogenizeMicrodataAst(node)[0];
  }

  return undefined;
}

function isModuleAstNode(value: unknown): value is ASTNode {
  return (
    isJsonObject(value) &&
    typeof value.id === 'string' &&
    typeof value.label === 'string' &&
    (value.type === 'schema' || value.type === 'field') &&
    Array.isArray(value.children)
  );
}

function isTreeNode(value: unknown): value is TreeNode {
  return (
    isJsonObject(value) &&
    typeof value.id === 'string' &&
    typeof value.label === 'string' &&
    (value.type === 'object' || value.type === 'array' || value.type === 'field') &&
    Array.isArray(value.children)
  );
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collectIds(node: unknown, ids: Set<string>): void {
  if (!node || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    node.forEach(child => collectIds(child, ids));
    return;
  }

  collectIdentityValues(node as Record<string, unknown>).forEach(id => ids.add(id));

  Object.values(node).forEach(child => collectIds(child, ids));
}

function trackResolvedRefs(
  node: unknown,
  foundTreeRefs: Set<string>,
  explicitRefs: Set<string>
): void {
  if (!node || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    node.forEach(child => trackResolvedRefs(child, foundTreeRefs, explicitRefs));
    return;
  }

  const record = node as Record<string, unknown>;
  if (typeof record.$ref === 'string' && record.$ref.length > 0) {
    foundTreeRefs.add(record.$ref);
    explicitRefs.add(record.$ref);
    return;
  }

  if (typeof record['@id'] === 'string' && record['@id'].length > 0) {
    foundTreeRefs.add(record['@id']);
  }

  Object.values(record).forEach(child =>
    trackResolvedRefs(child, foundTreeRefs, explicitRefs)
  );
}

function logGraphResolutionHealth(
  report: GraphResolutionHealthReport,
  useColor: boolean
): void {
  const gray = useColor ? chalk.gray : identity;
  const red = useColor ? chalk.red : identity;
  const green = useColor ? chalk.green : identity;

  console.log(
    gray(
      `\n[Self-Diagnostic] Registry IDs: ${report.registryIdCount} | Connected Tree Elements: ${report.connectedTreeElementCount}`
    )
  );

  if (report.brokenLinks.length > 0) {
    console.warn(
      red(
        `ERROR: Tree contains unresolved reference targets outside the canonical map: ${report.brokenLinks.join(', ')}`
      )
    );
    return;
  }

  console.log(green('SUCCESS: Tree resolution structure is sound.'));
}

function identity(value: string): string {
  return value;
}

function collectIdentityValues(record: Record<string, unknown>): string[] {
  return [
    stringValue(record['@id']),
    stringValue(record.url),
    ...arrayStringValues(record.sameAs),
  ].filter((value): value is string => typeof value === 'string');
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? normalizeIdentity(value)
    : undefined;
}

function arrayStringValues(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map(normalizeIdentity);
}

function normalizeIdentity(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 1 ? trimmed.replace(/\/$/, '') : trimmed;
}

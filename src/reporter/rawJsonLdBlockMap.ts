import type { RawSchemaBlock, ScrapeSourceMode } from '../scraper';

export type RawJsonLdMapNodeKind =
  | 'block'
  | 'object'
  | 'array'
  | 'value'
  | 'reference';

export type RawJsonLdMapStatus = 'ok' | 'warning' | 'error';

export interface RawJsonLdMapNode {
  id: string;
  label: string;
  type: string;
  kind: RawJsonLdMapNodeKind;
  status: RawJsonLdMapStatus;
  blockIndex: number;
  sourceMode?: ScrapeSourceMode;
  path: string;
  badges: string[];
  details: Array<{ key: string; value: string }>;
}

export interface RawJsonLdMapLink {
  sourceId: string;
  targetId: string;
  label: string;
  kind: 'contains' | 'cross-block-reference';
  status: RawJsonLdMapStatus;
}

export interface RawJsonLdBlockMapSummary {
  blockCount: number;
  typedBlockCount: number;
  untypedBlockCount: number;
  isolatedBlockCount: number;
  noCrossBlockIdLinkBlockCount: number;
  nestedTypedSchemaNodeCount: number;
  internalParentChildLinkCount: number;
  analyticsPayloadBlockCount: number;
  crossBlockReferenceCount: number;
  orphanReferenceCount: number;
  parseErrorBlockCount: number;
  maxNodes: number;
  truncated: boolean;
}

export interface RawJsonLdBlockMap {
  nodes: RawJsonLdMapNode[];
  links: RawJsonLdMapLink[];
  summary: RawJsonLdBlockMapSummary;
}

interface ReferenceCandidate {
  nodeId: string;
  blockIndex: number;
  targetId: string;
}

interface DefinitionCandidate {
  nodeId: string;
  blockIndex: number;
}

export const DEFAULT_RAW_MAP_MAX_NODES = 420;

export interface RawJsonLdBlockMapOptions {
  maxNodes?: number;
}

export function buildRawJsonLdBlockMap(
  schemas: RawSchemaBlock[],
  options: RawJsonLdBlockMapOptions = {}
): RawJsonLdBlockMap {
  const maxNodes = normalizeMaxNodes(options.maxNodes);
  const jsonLdSchemas = schemas.filter(schema => schema.source === 'json-ld');
  const nodes: RawJsonLdMapNode[] = [];
  const links: RawJsonLdMapLink[] = [];
  const definitions = new Map<string, DefinitionCandidate[]>();
  const references: ReferenceCandidate[] = [];
  const blockNodeIds = new Map<number, string>();
  let truncated = false;

  const rootTypesByBlock = jsonLdSchemas.map(schema => ({
    index: schema.jsonLdBlockIndex ?? jsonLdSchemas.indexOf(schema) + 1,
    types: schema.jsonLdTypes ?? schemaTypes(schema.data ?? {}),
  }));
  const duplicateTypes = duplicatedValues(rootTypesByBlock.flatMap(entry => entry.types));

  function pushNode(node: RawJsonLdMapNode): boolean {
    if (nodes.length >= maxNodes) {
      truncated = true;
      return false;
    }

    nodes.push(node);
    return true;
  }

  function addDefinition(idValue: string, nodeId: string, blockIndex: number): void {
    const key = normalizeId(idValue);
    if (!key) return;
    const existing = definitions.get(key) ?? [];
    existing.push({ nodeId, blockIndex });
    definitions.set(key, existing);
  }

  function addLink(link: RawJsonLdMapLink): void {
    links.push(link);
  }

  function addBadge(nodeId: string, badge: string): void {
    const node = nodes.find(candidate => candidate.id === nodeId);
    if (!node || node.badges.includes(badge)) return;
    node.badges.push(badge);
    if (badge === 'Orphan Reference') node.status = 'error';
  }

  function markNodeStatus(nodeId: string, status: RawJsonLdMapStatus): void {
    const node = nodes.find(candidate => candidate.id === nodeId);
    if (node) node.status = status;
  }

  jsonLdSchemas.forEach((schema, fallbackIndex) => {
    const blockIndex = schema.jsonLdBlockIndex ?? fallbackIndex + 1;
    const blockId = `raw-block-${blockIndex}`;
    const rootTypes = schema.jsonLdTypes ?? schemaTypes(schema.data ?? {});
    const classification = blockClassification(schema, rootTypes);
    const badges = blockBadges(schema, rootTypes, duplicateTypes);
    const status = schema.parseError
      ? 'error'
      : rootTypes.length === 0
        ? 'warning'
        : 'ok';

    const blockAdded = pushNode({
      id: blockId,
      label: `Block #${blockIndex}: ${classification}`,
      type: rootTypes[0] ?? classification,
      kind: 'block',
      status,
      blockIndex,
      sourceMode: schema.sourceMode,
      path: `Block #${blockIndex}`,
      badges,
      details: detailRows({
        block: `#${blockIndex}`,
        source: schema.sourceMode ?? 'unknown',
        classification,
        types: rootTypes.length > 0 ? rootTypes.join(', ') : 'none',
        chars: String(schema.raw?.length ?? 0),
        status: schema.syntaxStatus ?? (schema.parseError ? 'critical' : 'valid'),
        message: schema.parseError ?? schema.syntaxError?.message,
      }),
    });
    if (blockAdded) {
      blockNodeIds.set(blockIndex, blockId);
    }

    if (!blockAdded || schema.parseError || !schema.data) return;

    visitRawValue({
      value: schema.data,
      parentId: blockId,
      blockIndex,
      sourceMode: schema.sourceMode,
      path: '$',
      edgeLabel: 'script',
      nodeKey: 'root',
      isRoot: true,
    });
  });

  references.forEach(reference => {
    const matches = definitions.get(normalizeId(reference.targetId)) ?? [];
    const crossBlockMatches = matches.filter(match => match.blockIndex !== reference.blockIndex);
    if (crossBlockMatches.length > 0) {
      crossBlockMatches.forEach(match => addLink({
        sourceId: reference.nodeId,
        targetId: match.nodeId,
        label: 'refers to @id (Cross-Block)',
        kind: 'cross-block-reference',
        status: 'warning',
      }));
      addBadge(reference.nodeId, 'Cross-Block Ref');
      return;
    }

    if (matches.length === 0) {
      markNodeStatus(reference.nodeId, 'error');
      addBadge(reference.nodeId, 'Orphan Reference');
    }
  });

  const connectedBlocks = new Set<number>();
  links
    .filter(link => link.kind === 'cross-block-reference')
    .forEach(link => {
      const source = nodes.find(node => node.id === link.sourceId);
      const target = nodes.find(node => node.id === link.targetId);
      if (source) connectedBlocks.add(source.blockIndex);
      if (target) connectedBlocks.add(target.blockIndex);
    });

  blockNodeIds.forEach((nodeId, blockIndex) => {
    if (connectedBlocks.has(blockIndex)) return;
    addBadge(nodeId, 'No Cross-Block @id Links');
  });

  const nestedTypedSchemaNodeCount = nodes.filter(isNestedTypedSchemaNode).length;

  return {
    nodes,
    links,
    summary: {
      blockCount: jsonLdSchemas.length,
      typedBlockCount: rootTypesByBlock.filter(entry => entry.types.length > 0).length,
      untypedBlockCount: rootTypesByBlock.filter(entry => entry.types.length === 0).length,
      isolatedBlockCount: jsonLdSchemas.length - connectedBlocks.size,
      noCrossBlockIdLinkBlockCount: jsonLdSchemas.length - connectedBlocks.size,
      nestedTypedSchemaNodeCount,
      internalParentChildLinkCount: links
        .filter(link => link.kind === 'contains')
        .filter(link => {
          const target = nodes.find(node => node.id === link.targetId);
          return target ? isNestedTypedSchemaNode(target) : false;
        }).length,
      analyticsPayloadBlockCount: jsonLdSchemas
        .filter(schema => rootBlockTypes(schema).length === 0 && isAnalyticsPayload(schema.data)).length,
      crossBlockReferenceCount: links.filter(link => link.kind === 'cross-block-reference').length,
      orphanReferenceCount: nodes.filter(node => node.badges.includes('Orphan Reference')).length,
      parseErrorBlockCount: jsonLdSchemas.filter(schema => Boolean(schema.parseError)).length,
      maxNodes,
      truncated,
    },
  };

  function visitRawValue(options: {
    value: unknown;
    parentId: string;
    blockIndex: number;
    sourceMode?: ScrapeSourceMode;
    path: string;
    edgeLabel: string;
    nodeKey: string;
    isRoot?: boolean;
  }): string | undefined {
    const { value, parentId, blockIndex, sourceMode, path, edgeLabel, nodeKey, isRoot } = options;
    const id = `raw-block-${blockIndex}-${sanitizeId(path)}`;

    if (Array.isArray(value)) {
      if (!pushNode({
        id,
        label: `${nodeKey}[] (${value.length})`,
        type: 'Array',
        kind: 'array',
        status: 'ok',
        blockIndex,
        sourceMode,
        path,
        badges: [],
        details: detailRows({
          block: `#${blockIndex}`,
          path,
          items: String(value.length),
        }),
      })) return undefined;
      addLink({ sourceId: parentId, targetId: id, label: edgeLabel, kind: 'contains', status: 'ok' });
      value.forEach((item, index) => visitRawValue({
        value: item,
        parentId: id,
        blockIndex,
        sourceMode,
        path: `${path}[${index}]`,
        edgeLabel: String(index),
        nodeKey: `[${index}]`,
      }));
      return id;
    }

    if (isRecord(value)) {
      const refOnly = isReferenceOnlyObject(value);
      const nodeTypes = schemaTypes(value);
      const nodeKind: RawJsonLdMapNodeKind = refOnly ? 'reference' : 'object';
      const label = refOnly
        ? `@id ref: ${truncateText(String(value['@id']), 44)}`
        : isRoot && nodeTypes.length > 0
          ? nodeTypes.join(', ')
          : `${nodeKey}: ${rawObjectLabel(value)}`;

      if (!pushNode({
        id,
        label,
        type: refOnly ? 'Reference' : nodeTypes[0] ?? 'Object',
        kind: nodeKind,
        status: 'ok',
        blockIndex,
        sourceMode,
        path,
        badges: refOnly ? ['@id Reference'] : [],
        details: detailRows({
          block: `#${blockIndex}`,
          path,
          type: nodeTypes.join(', ') || undefined,
          '@id': stringValue(value['@id']),
          name: stringValue(value.name),
          url: stringValue(value.url),
        }),
      })) return undefined;
      addLink({ sourceId: parentId, targetId: id, label: edgeLabel, kind: 'contains', status: 'ok' });

      const idValue = stringValue(value['@id']);
      if (idValue && refOnly) {
        references.push({ nodeId: id, blockIndex, targetId: idValue });
      } else if (idValue) {
        addDefinition(idValue, id, blockIndex);
      }

      Object.entries(value).forEach(([key, child]) => visitRawValue({
        value: child,
        parentId: id,
        blockIndex,
        sourceMode,
        path: path === '$' ? `$.${key}` : `${path}.${key}`,
        edgeLabel: key,
        nodeKey: key,
      }));
      return id;
    }

    if (!pushNode({
      id,
      label: `${nodeKey}: ${primitivePreview(value)}`,
      type: 'Value',
      kind: 'value',
      status: 'ok',
      blockIndex,
      sourceMode,
      path,
      badges: [],
      details: detailRows({
        block: `#${blockIndex}`,
        path,
        value: primitivePreview(value),
      }),
    })) return undefined;
    addLink({ sourceId: parentId, targetId: id, label: edgeLabel, kind: 'contains', status: 'ok' });
    return id;
  }
}

function normalizeMaxNodes(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_RAW_MAP_MAX_NODES;
  }

  return Math.floor(value);
}

function blockBadges(
  schema: RawSchemaBlock,
  rootTypes: string[],
  duplicateTypes: Set<string>
): string[] {
  const badges: string[] = [];
  if (schema.parseError) badges.push('Parse Error');
  if (rootTypes.length === 0) {
    badges.push('Untyped JSON-LD');
    if (isAnalyticsPayload(schema.data)) badges.push('Analytics/Data Layer Payload');
  }
  if (rootTypes.some(type => duplicateTypes.has(type))) badges.push('Duplicate @type');
  return badges;
}

function blockClassification(schema: RawSchemaBlock, rootTypes: string[]): string {
  if (schema.parseError) return 'Invalid JSON-LD Block';
  if (rootTypes.length > 0) return rootTypes.join(', ');
  if (isAnalyticsPayload(schema.data)) return 'Analytics/Data Layer Payload';
  return 'Untyped Payload / Data Block';
}

function rootBlockTypes(schema: RawSchemaBlock): string[] {
  return schema.jsonLdTypes ?? schemaTypes(schema.data ?? {});
}

function isNestedTypedSchemaNode(node: RawJsonLdMapNode): boolean {
  return node.kind === 'object'
    && node.path !== '$'
    && node.type !== 'Object'
    && node.type !== 'Reference'
    && node.type !== 'Value'
    && node.type !== 'Array';
}

function isAnalyticsPayload(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const keys = new Set(Object.keys(value));
  const hasItemKey = [...keys].some(key => key.startsWith('item_'));
  return hasItemKey
    || keys.has('event')
    || keys.has('ecommerce')
    || keys.has('gtm')
    || (keys.has('currency') && (keys.has('price') || keys.has('stock_status')));
}

function schemaTypes(value: unknown): string[] {
  if (Array.isArray(value)) return uniqueStrings(value.flatMap(schemaTypes));
  if (!isRecord(value)) return [];

  const graph = value['@graph'];
  if (Array.isArray(graph)) return uniqueStrings(graph.flatMap(schemaTypes));

  const type = value['@type'];
  if (typeof type === 'string' && type.length > 0) return [type];
  if (Array.isArray(type)) {
    return uniqueStrings(type.filter((item): item is string => typeof item === 'string' && item.length > 0));
  }

  return [];
}

function isReferenceOnlyObject(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value);
  return typeof value['@id'] === 'string'
    && keys.length > 0
    && keys.every(key => key === '@id' || key === '@context');
}

function rawObjectLabel(value: Record<string, unknown>): string {
  const types = schemaTypes(value);
  if (types.length > 0) return types.join(', ');
  const name = stringValue(value.name);
  if (name) return truncateText(name, 44);
  const id = stringValue(value['@id']);
  if (id) return `@id ${truncateText(id, 44)}`;
  return 'Object';
}

function detailRows(values: Record<string, string | undefined>): Array<{ key: string; value: string }> {
  return Object.entries(values)
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([key, value]) => ({ key, value }));
}

function primitivePreview(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return truncateText(value, 70);
  return truncateText(String(value), 70);
}

function sanitizeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'root';
}

function normalizeId(value: string): string {
  return value.trim();
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function duplicatedValues(values: string[]): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  values.forEach(value => {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  });
  return duplicates;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function truncateText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

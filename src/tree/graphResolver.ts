export interface GraphEntity {
  '@id'?: string;
  '@type'?: string | string[];
  _meta?: GraphEntityMeta;
  [property: string]: unknown;
}

export interface GraphEntityMeta {
  sourceMode?: 'static' | 'rendered' | 'merged';
  extractionChannel?: 'json-ld' | 'microdata' | 'rdfa' | 'mixed';
}

export interface ReferenceNode {
  $ref: string;
}

export type ResolvedGraphNode =
  | GraphEntity
  | ReferenceNode
  | ResolvedGraphNode[]
  | string
  | number
  | boolean
  | null
  | undefined;

const MAX_MERGE_DEPTH = 25;
const MAX_MERGED_ARRAY_ITEMS = 150;

const ROOT_TYPE_WEIGHTS: Record<string, number> = {
  ProductGroup: 100,
  Product: 95,
  Service: 94,
  Article: 92,
  BlogPosting: 91,
  WebPage: 90,
  CollectionPage: 85,
  WebSite: 80,
  BreadcrumbList: 60,
  Organization: 50,
  LocalBusiness: 45,
};

export function consolidateGraphEntities(entities: GraphEntity[]): GraphEntity[] {
  const registry = new Map<string, GraphEntity>();
  const namelessEntities: GraphEntity[] = [];

  for (const entity of entities) {
    const id = stringValue(entity['@id']);

    if (!id) {
      namelessEntities.push(cloneValue(entity));
      continue;
    }

    const existing = registry.get(id);
    registry.set(
      id,
      existing
        ? mergeConsolidatedEntity(existing, entity)
        : cloneValue(entity)
    );
  }

  return [...registry.values(), ...namelessEntities];
}

export function buildGraphEntityMap(
  entities: GraphEntity[]
): ReadonlyMap<string, GraphEntity> {
  const map = new Map<string, GraphEntity>();

  for (const entity of consolidateGraphEntities(entities)) {
    indexEntity(entity, map);
  }

  return map;
}

export function resolveGraph(
  entities: GraphEntity[],
  entityMap?: ReadonlyMap<string, GraphEntity>
): GraphEntity[] {
  const consolidatedEntities = consolidateGraphEntities(entities);
  const map = entityMap ?? buildGraphEntityMap(consolidatedEntities);

  return consolidatedEntities
    .map(entity => resolveNode(entity, new Set(), map))
    .filter(isGraphEntity);
}

export function selectBestRootEntity(
  resolvedEntities: GraphEntity[]
): GraphEntity | undefined {
  const index = selectBestRootIndex(resolvedEntities);
  return index >= 0 ? resolvedEntities[index] : undefined;
}

export function selectBestRootIndex(
  resolvedEntities: GraphEntity[]
): number {
  let bestIndex = -1;
  let bestScore = Number.NEGATIVE_INFINITY;

  resolvedEntities.forEach((entity, index) => {
    const score = rootScore(entity);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  return bestIndex;
}

export function selectUnlinkedRootEntities(
  resolvedEntities: GraphEntity[],
  bestRootIndex: number
): GraphEntity[] {
  const masterRoot = resolvedEntities[bestRootIndex];
  if (!masterRoot) return [];

  const linkedIdentities = collectLinkedIdentities(masterRoot);

  return resolvedEntities.filter((entity, index) => {
    if (index === bestRootIndex) return false;

    const identities = identityKeys(entity).map(normalizeIdentity);
    if (identities.length === 0) return true;

    return !identities.some(identity => linkedIdentities.has(identity));
  });
}

export function resolveNode(
  value: unknown,
  visitedIds: Set<string>,
  entityMap: ReadonlyMap<string, GraphEntity>
): ResolvedGraphNode {
  if (Array.isArray(value)) {
    return value.map(item => resolveNode(item, visitedIds, entityMap));
  }

  if (!isRecord(value)) return value as ResolvedGraphNode;

  const identity = primaryIdentity(value);
  if (identity && visitedIds.has(identity)) {
    return { $ref: identity };
  }

  const canonical = identity ? entityMap.get(normalizeIdentity(identity)) : undefined;
  const merged = canonical && canonical !== value
    ? deepMerge(cloneValue(canonical), cloneValue(value))
    : cloneValue(value);
  const nextVisited = identity
    ? new Set([...visitedIds, identity])
    : new Set(visitedIds);

  return Object.fromEntries(
    Object.entries(merged).map(([key, child]) => [
      key,
      resolveNode(child, nextVisited, entityMap),
    ])
  );
}

function indexEntity(entity: GraphEntity, map: Map<string, GraphEntity>): void {
  for (const key of identityKeys(entity)) {
    const normalized = normalizeIdentity(key);
    const existing = map.get(normalized);

    if (!existing || entityScore(entity) > entityScore(existing)) {
      map.set(normalized, entity);
    }
  }
}

function identityKeys(entity: GraphEntity): string[] {
  return [
    stringValue(entity['@id']),
    stringValue(entity.url),
    ...arrayStringValues(entity.sameAs),
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);
}

function collectLinkedIdentities(value: unknown): Set<string> {
  const identities = new Set<string>();
  collectLinkedIdentitiesFromNode(value, identities);
  return identities;
}

function collectLinkedIdentitiesFromNode(value: unknown, identities: Set<string>): void {
  if (Array.isArray(value)) {
    value.forEach(child => collectLinkedIdentitiesFromNode(child, identities));
    return;
  }

  if (!isRecord(value)) return;

  identityKeys(value as GraphEntity)
    .map(normalizeIdentity)
    .forEach(identity => identities.add(identity));

  Object.values(value).forEach(child =>
    collectLinkedIdentitiesFromNode(child, identities)
  );
}

function primaryIdentity(value: Record<string, unknown>): string | undefined {
  const id = stringValue(value['@id']);
  if (id) return id;

  const url = stringValue(value.url);
  return url && isUrlReferenceOnly(value) ? url : undefined;
}

function isUrlReferenceOnly(value: Record<string, unknown>): boolean {
  return Object.keys(value)
    .filter(key => key !== '@context' && key !== '_meta')
    .every(key => key === 'url');
}

function normalizeIdentity(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 1 ? trimmed.replace(/\/$/, '') : trimmed;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function arrayStringValues(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function entityHasType(entity: GraphEntity, type: string): boolean {
  const value = entity['@type'];
  if (typeof value === 'string') return value === type;
  return Array.isArray(value) && value.includes(type);
}

function entityScore(entity: GraphEntity): number {
  return Object.keys(entity).length + (entity['@type'] ? 5 : 0);
}

function mergeConsolidatedEntity(
  primary: GraphEntity,
  secondary: GraphEntity,
  currentDepth = 0
): GraphEntity {
  const merged = cloneValue(primary);
  const mergedMeta = mergeEntityMeta(primary._meta, secondary._meta);

  if (currentDepth > MAX_MERGE_DEPTH) {
    return merged;
  }

  if (mergedMeta) {
    merged._meta = mergedMeta;
  }

  for (const [key, value] of Object.entries(secondary)) {
    if (key === '_meta' || key === '@context') continue;

    const existing = merged[key];

    if (isEmptyValue(existing)) {
      merged[key] = cloneValue(value);
      continue;
    }

    if (key === '@type') {
      merged['@type'] = mergeTypeValues(existing, value) as GraphEntity['@type'];
      continue;
    }

    if (Array.isArray(existing) && Array.isArray(value)) {
      merged[key] = mergeArrayValues(existing, value);
      continue;
    }

    if (isRecord(existing) && isRecord(value)) {
      merged[key] = mergeConsolidatedEntity(
        existing as GraphEntity,
        value as GraphEntity,
        currentDepth + 1
      );
    }
  }

  return merged;
}

function mergeEntityMeta(
  first: GraphEntityMeta | undefined,
  second: GraphEntityMeta | undefined
): GraphEntityMeta | undefined {
  if (!first && !second) return undefined;
  if (!first) return cloneValue(second);
  if (!second) return cloneValue(first);

  const firstMode = first.sourceMode;
  const secondMode = second.sourceMode;
  const firstChannel = first.extractionChannel;
  const secondChannel = second.extractionChannel;

  return {
    sourceMode: firstMode === secondMode ? firstMode : 'merged',
    extractionChannel: firstChannel === secondChannel ? firstChannel : 'mixed',
  };
}

function rootScore(entity: GraphEntity): number {
  const typeScore = typeValues(entity['@type'])
    .map(type => ROOT_TYPE_WEIGHTS[type] ?? 10)
    .reduce((highest, score) => Math.max(highest, score), 10);
  const idBonus = entity['@id'] ? 5 : 0;
  const urlBonus = entity.url ? 2 : 0;
  const richnessBonus = Math.min(Object.keys(entity).length, 20) / 10;

  return typeScore + idBonus + urlBonus + richnessBonus;
}

function deepMerge(first: unknown, second: unknown, currentDepth = 0): GraphEntity {
  if (currentDepth > MAX_MERGE_DEPTH) {
    return isRecord(first) ? first as GraphEntity : {};
  }

  if (!isRecord(first)) return isRecord(second) ? second : {};
  if (!isRecord(second)) return first as GraphEntity;

  const merged: GraphEntity = { ...first };

  for (const [key, value] of Object.entries(second)) {
    if (key in merged) {
      merged[key] = mergeValue(merged[key], value, key, currentDepth);
    } else {
      merged[key] = value;
    }
  }

  return merged;
}

function mergeValue(
  first: unknown,
  second: unknown,
  key: string,
  currentDepth = 0
): unknown {
  if (key === '@type') return mergeTypeValues(first, second);

  if (Array.isArray(first) && Array.isArray(second)) {
    return mergeArrayValues(first, second);
  }

  if (isRecord(first) && isRecord(second)) {
    return deepMerge(first, second, currentDepth + 1);
  }

  return second ?? first;
}

function mergeArrayValues(first: unknown[], second: unknown[]): unknown[] {
  const merged: unknown[] = [];

  for (const item of [...first, ...second]) {
    if (item === '' || containsEquivalent(merged, item)) continue;
    merged.push(cloneValue(item));
  }

  return merged.slice(0, MAX_MERGED_ARRAY_ITEMS);
}

function mergeTypeValues(first: unknown, second: unknown): unknown {
  const types = [...typeValues(second), ...typeValues(first)];
  const unique = [...new Set(types)];

  if (unique.length === 0) return second ?? first;
  return unique.length === 1 ? unique[0] : unique;
}

function typeValues(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }

  return [];
}

function containsEquivalent(values: unknown[], candidate: unknown): boolean {
  return values.some(value => stableStringify(value) === stableStringify(candidate));
}

function isEmptyValue(value: unknown): boolean {
  return value === undefined
    || value === null
    || value === ''
    || (Array.isArray(value) && value.length === 0);
}

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map(cloneValue) as T;

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, cloneValue(child)])
    ) as T;
  }

  return value;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;

  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }

  return JSON.stringify(value) ?? 'undefined';
}

function isGraphEntity(value: ResolvedGraphNode): value is GraphEntity {
  return isRecord(value) && !('$ref' in value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

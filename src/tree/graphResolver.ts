export interface GraphEntity {
  '@id'?: string;
  '@type'?: string | string[];
  [property: string]: unknown;
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

const ROOT_TYPE_PRIORITY = [
  'Product',
  'Service',
  'Article',
  'BlogPosting',
  'WebPage',
  'BreadcrumbList',
  'Organization',
  'LocalBusiness',
];

export function buildGraphEntityMap(
  entities: GraphEntity[]
): ReadonlyMap<string, GraphEntity> {
  const map = new Map<string, GraphEntity>();

  for (const entity of entities) {
    indexEntity(entity, map);
  }

  return map;
}

export function resolveGraph(
  entities: GraphEntity[],
  entityMap = buildGraphEntityMap(entities)
): GraphEntity[] {
  return entities
    .map(entity => resolveNode(entity, new Set(), entityMap))
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
  for (const type of ROOT_TYPE_PRIORITY) {
    const index = resolvedEntities.findIndex(entity => entityHasType(entity, type));
    if (index >= 0) return index;
  }

  return resolvedEntities.length > 0 ? 0 : -1;
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
  return stringValue(value['@id']) ?? stringValue(value.url);
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

function deepMerge(first: unknown, second: unknown): GraphEntity {
  if (!isRecord(first)) return isRecord(second) ? second : {};
  if (!isRecord(second)) return first as GraphEntity;

  const merged: GraphEntity = { ...first };

  for (const [key, value] of Object.entries(second)) {
    if (key in merged) {
      merged[key] = mergeValue(merged[key], value, key);
    } else {
      merged[key] = value;
    }
  }

  return merged;
}

function mergeValue(first: unknown, second: unknown, key: string): unknown {
  if (key === '@type') return mergeTypeValues(first, second);

  if (Array.isArray(first) && Array.isArray(second)) {
    return [...first, ...second.filter(item => !containsEquivalent(first, item))];
  }

  if (isRecord(first) && isRecord(second)) {
    return deepMerge(first, second);
  }

  return second ?? first;
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

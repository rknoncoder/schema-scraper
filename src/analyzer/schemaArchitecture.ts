export type ArchitectureFindingCategory =
  | 'entity-linkage'
  | 'duplicate-site-entity';

export interface SchemaArchitectureFinding {
  category: ArchitectureFindingCategory;
  severity: 'warning' | 'info';
  entityType: string;
  property?: string;
  message: string;
  recommendation: string;
  path?: string;
  entityName?: string;
  sourceMode?: string;
  jsonLdBlockIndex?: number;
  targetType?: string;
  expectedReference?: string;
}

interface EntityContext {
  entity: Record<string, unknown>;
  type: string;
  name?: string;
  path: string;
  sourceMode?: string;
  jsonLdBlockIndex?: number;
  topLevel: boolean;
}

const SITE_ENTITY_TYPES = new Set(['Organization', 'LocalBusiness', 'WebSite']);
const PAGE_TYPES = new Set(['WebPage', 'CollectionPage', 'SearchResultsPage', 'AboutPage', 'ContactPage']);
const PRODUCT_TYPES = new Set(['Product', 'ProductGroup']);
const LINKABLE_ROOT_TYPES = new Set([
  ...SITE_ENTITY_TYPES,
  ...PAGE_TYPES,
  ...PRODUCT_TYPES,
  'BreadcrumbList',
]);

const PROFILE_FIELD_NAMES = [
  'name',
  'url',
  'logo',
  'address',
  'sameAs',
  'contactPoint',
  'telephone',
  'email',
];

export function auditSchemaArchitecture(
  rawEntities: unknown[],
  resolvedEntities: unknown[] = []
): SchemaArchitectureFinding[] {
  const contexts = collectEntityContexts(rawEntities);
  const rootContexts = contexts.filter(context => context.topLevel);
  const idRegistry = collectIdRegistry([...rawEntities, ...resolvedEntities]);
  const siteProfiles = rootContexts.filter(context => SITE_ENTITY_TYPES.has(context.type));
  const findings: SchemaArchitectureFinding[] = [];

  findings.push(...auditMissingRootIds(rootContexts));
  findings.push(...auditExpectedEntityLinks(rootContexts, siteProfiles, idRegistry));
  findings.push(...auditDuplicateSiteEntities(contexts));

  return dedupeFindings(findings);
}

function auditMissingRootIds(contexts: EntityContext[]): SchemaArchitectureFinding[] {
  return contexts
    .filter(context => LINKABLE_ROOT_TYPES.has(context.type))
    .filter(context => !stringValue(context.entity['@id']))
    .map(context => finding(context, {
      category: 'entity-linkage',
      severity: SITE_ENTITY_TYPES.has(context.type) || PAGE_TYPES.has(context.type) ? 'warning' : 'info',
      property: '@id',
      message: `Top-level ${context.type} entity has no stable @id anchor.`,
      recommendation: `Add a canonical @id such as "${defaultAnchorForType(context.type)}" and reference it from related schema nodes.`,
      expectedReference: defaultAnchorForType(context.type),
    }));
}

function auditExpectedEntityLinks(
  contexts: EntityContext[],
  siteProfiles: EntityContext[],
  idRegistry: Set<string>
): SchemaArchitectureFinding[] {
  const findings: SchemaArchitectureFinding[] = [];
  const websiteId = firstId(siteProfiles, 'WebSite') || firstRegisteredId(idRegistry, '#website');
  const organizationId = firstId(siteProfiles, 'Organization')
    || firstId(siteProfiles, 'LocalBusiness')
    || firstRegisteredId(idRegistry, '#organization')
    || firstRegisteredId(idRegistry, '#local-business');

  contexts.forEach(context => {
    if (PAGE_TYPES.has(context.type)) {
      if (websiteId) {
        findings.push(...expectReference(context, 'isPartOf', 'WebSite', websiteId));
      }

      if (organizationId) {
        findings.push(...expectAnyReference(context, ['publisher', 'about'], 'Organization', organizationId));
      }
    }

    if (PRODUCT_TYPES.has(context.type) && organizationId) {
      findings.push(...auditProductOrganizationLink(context, organizationId));
    }

    if (context.type === 'BreadcrumbList') {
      findings.push(...auditBreadcrumbItemReferences(context));
    }
  });

  return findings;
}

function auditProductOrganizationLink(
  context: EntityContext,
  expectedId: string
): SchemaArchitectureFinding[] {
  const properties = ['offeredBy', 'brand', 'manufacturer'];
  if (properties.some(property => referenceMatches(context.entity[property], expectedId))) return [];

  const embeddedProfileProperty = properties.find(property => isFullEmbeddedProfile(context.entity[property]));
  if (embeddedProfileProperty) {
    return expectReference(context, embeddedProfileProperty, 'Organization', expectedId, 'info');
  }

  const hasAnyBranding = properties.some(property => context.entity[property] !== undefined);
  if (hasAnyBranding) return [];

  return [finding(context, {
    category: 'entity-linkage',
    severity: 'info',
    property: properties.join(' / '),
    targetType: 'Organization',
    message: `${context.type} has no offeredBy, brand, or manufacturer link to the site entity.`,
    recommendation: `If the site entity is the seller or producer, add a reference such as "offeredBy": {"@id": "${expectedId}"}.`,
    expectedReference: expectedId,
  })];
}

function expectReference(
  context: EntityContext,
  property: string,
  targetType: string,
  expectedId: string,
  severity: 'warning' | 'info' = 'warning'
): SchemaArchitectureFinding[] {
  const value = context.entity[property];
  if (referenceMatches(value, expectedId)) return [];

  if (value === undefined) {
    return [finding(context, {
      category: 'entity-linkage',
      severity,
      property,
      targetType,
      message: `${context.type} is not linked to the ${targetType} entity through "${property}".`,
      recommendation: `Add "${property}": {"@id": "${expectedId}"} to connect the page graph.`,
      expectedReference: expectedId,
    })];
  }

  if (isFullEmbeddedProfile(value)) {
    return [finding(context, {
      category: 'entity-linkage',
      severity,
      property,
      targetType,
      message: `${context.type}.${property} embeds a full ${targetType} profile instead of referencing the canonical @id.`,
      recommendation: `Replace the embedded profile with {"@id": "${expectedId}"} when the target entity is already declared on the page.`,
      expectedReference: expectedId,
    })];
  }

  const ref = referenceId(value);
  if (ref && normalizeIdentity(ref) !== normalizeIdentity(expectedId)) {
    return [finding(context, {
      category: 'entity-linkage',
      severity: 'info',
      property,
      targetType,
      message: `${context.type}.${property} points to "${ref}" instead of the detected ${targetType} @id.`,
      recommendation: `Verify the reference target, or align it with "${expectedId}" if it represents the same entity.`,
      expectedReference: expectedId,
    })];
  }

  return [finding(context, {
    category: 'entity-linkage',
    severity,
    property,
    targetType,
    message: `${context.type}.${property} exists but does not use an @id reference.`,
    recommendation: `Use {"@id": "${expectedId}"} so crawlers can join the entity graph reliably.`,
    expectedReference: expectedId,
  })];
}

function expectAnyReference(
  context: EntityContext,
  properties: string[],
  targetType: string,
  expectedId: string,
  severity: 'warning' | 'info' = 'warning'
): SchemaArchitectureFinding[] {
  if (properties.some(property => referenceMatches(context.entity[property], expectedId))) return [];

  const existingProperty = properties.find(property => context.entity[property] !== undefined);
  if (existingProperty) {
    return expectReference(context, existingProperty, targetType, expectedId, severity);
  }

  return [finding(context, {
    category: 'entity-linkage',
    severity,
    property: properties.join(' / '),
    targetType,
    message: `${context.type} is not linked to the ${targetType} entity through ${properties.join(' or ')}.`,
    recommendation: `Add one canonical reference, for example "${properties[0]}": {"@id": "${expectedId}"}.`,
    expectedReference: expectedId,
  })];
}

function auditBreadcrumbItemReferences(context: EntityContext): SchemaArchitectureFinding[] {
  const elements = context.entity.itemListElement;
  if (!Array.isArray(elements)) return [];

  const hasReferenceObjects = elements.some(item =>
    isRecord(item) && referenceId(item.item) !== undefined
  );
  if (hasReferenceObjects) return [];

  const hasUrlItems = elements.some(item =>
    isRecord(item) && (typeof item.item === 'string' || typeof item.url === 'string')
  );
  if (!hasUrlItems) return [];

  return [finding(context, {
    category: 'entity-linkage',
    severity: 'info',
    property: 'itemListElement',
    targetType: 'WebPage',
    message: 'BreadcrumbList items use URL/name values but no @id references to page entities.',
    recommendation: 'For richer graph clarity, point breadcrumb item values at canonical WebPage @id anchors when page entities are declared.',
  })];
}

function auditDuplicateSiteEntities(contexts: EntityContext[]): SchemaArchitectureFinding[] {
  const profiles = contexts.filter(context =>
    SITE_ENTITY_TYPES.has(context.type) &&
    profileFieldCount(context.entity) >= 3
  );
  const groups = new Map<string, EntityContext[]>();

  profiles.forEach(context => {
    const key = context.type + ':' + (identityFor(context.entity) || stringValue(context.entity.name) || context.path);
    const group = groups.get(key) || [];
    group.push(context);
    groups.set(key, group);
  });

  const findings: SchemaArchitectureFinding[] = [];
  groups.forEach(group => {
    const distinctBlocks = uniqueValues(group.map(context => context.jsonLdBlockIndex).filter(Boolean).map(String));
    if (group.length < 2 && distinctBlocks.length < 2) return;

    const first = group[0];
    findings.push(finding(first, {
      category: 'duplicate-site-entity',
      severity: 'warning',
      property: '@id',
      targetType: first.type,
      message: `${first.type} appears as a full site profile ${group.length} times in the extracted schema graph.`,
      recommendation: `Declare one canonical ${first.type} with a stable @id, then reference it from other nodes instead of repeating logo/address/sameAs profile fields.`,
      expectedReference: identityFor(first.entity) || defaultAnchorForType(first.type),
    }));
  });

  return findings;
}

function collectEntityContexts(values: unknown[]): EntityContext[] {
  const contexts: EntityContext[] = [];
  values.forEach((value, index) => {
    visitEntity(value, '$[' + index + ']', true, contexts);
  });
  return contexts;
}

function visitEntity(
  value: unknown,
  path: string,
  topLevel: boolean,
  contexts: EntityContext[]
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitEntity(item, `${path}[${index}]`, false, contexts));
    return;
  }

  if (!isRecord(value)) return;

  const type = primaryType(value['@type']);
  if (type !== 'Unknown') {
    const meta = isRecord(value._meta) ? value._meta : {};
    contexts.push({
      entity: value,
      type,
      name: stringValue(value.name),
      path,
      sourceMode: stringValue(meta.sourceMode),
      jsonLdBlockIndex: numberValue(meta.jsonLdBlockIndex),
      topLevel,
    });
  }

  Object.entries(value).forEach(([key, child]) => {
    if (key === '_meta') return;
    visitEntity(child, `${path}.${key}`, false, contexts);
  });
}

function collectIdRegistry(values: unknown[]): Set<string> {
  const ids = new Set<string>();
  visitUnknown(values, value => {
    if (!isRecord(value)) return;
    const id = stringValue(value['@id']);
    if (id) ids.add(normalizeIdentity(id));
  });
  return ids;
}

function visitUnknown(value: unknown, callback: (value: unknown) => void): void {
  callback(value);
  if (Array.isArray(value)) {
    value.forEach(item => visitUnknown(item, callback));
    return;
  }
  if (!isRecord(value)) return;
  Object.entries(value).forEach(([key, child]) => {
    if (key !== '_meta') visitUnknown(child, callback);
  });
}

function finding(
  context: EntityContext,
  input: Omit<SchemaArchitectureFinding, 'entityType' | 'entityName' | 'path' | 'sourceMode' | 'jsonLdBlockIndex'>
): SchemaArchitectureFinding {
  return cleanFinding({
    ...input,
    entityType: context.type,
    entityName: context.name,
    path: input.property ? `${context.path}.${input.property}` : context.path,
    sourceMode: context.sourceMode,
    jsonLdBlockIndex: context.jsonLdBlockIndex,
  });
}

function referenceMatches(value: unknown, expectedId: string): boolean {
  const ref = referenceId(value);
  return Boolean(ref && normalizeIdentity(ref) === normalizeIdentity(expectedId));
}

function referenceId(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map(referenceId).find(Boolean);
  }
  if (!isRecord(value)) return undefined;
  return stringValue(value['@id']);
}

function isFullEmbeddedProfile(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(isFullEmbeddedProfile);
  return isRecord(value) && SITE_ENTITY_TYPES.has(primaryType(value['@type'])) && profileFieldCount(value) >= 3;
}

function profileFieldCount(value: Record<string, unknown>): number {
  return PROFILE_FIELD_NAMES.filter(field => value[field] !== undefined).length;
}

function firstId(contexts: EntityContext[], type: string): string | undefined {
  return contexts
    .filter(context => context.type === type)
    .map(context => stringValue(context.entity['@id']))
    .find(Boolean);
}

function firstRegisteredId(ids: Set<string>, tail: string): string | undefined {
  return [...ids].find(id => id.endsWith(tail));
}

function identityFor(entity: Record<string, unknown>): string | undefined {
  return stringValue(entity['@id']) || stringValue(entity.url);
}

function defaultAnchorForType(type: string): string {
  const anchors: Record<string, string> = {
    Organization: 'https://example.com/#organization',
    LocalBusiness: 'https://example.com/#local-business',
    WebSite: 'https://example.com/#website',
    WebPage: 'https://example.com/#webpage',
    CollectionPage: 'https://example.com/#webpage',
    SearchResultsPage: 'https://example.com/#webpage',
    AboutPage: 'https://example.com/#webpage',
    ContactPage: 'https://example.com/#webpage',
    Product: 'https://example.com/#product',
    ProductGroup: 'https://example.com/#product-group',
    BreadcrumbList: 'https://example.com/#breadcrumb',
  };
  return anchors[type] || `https://example.com/#${type.toLowerCase()}`;
}

function primaryType(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value) && value.length > 0) return String(value[0]);
  return 'Unknown';
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeIdentity(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 1 ? trimmed.replace(/\/$/, '') : trimmed;
}

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function dedupeFindings(findings: SchemaArchitectureFinding[]): SchemaArchitectureFinding[] {
  const seen = new Set<string>();
  return findings.filter(finding => {
    const key = [
      finding.category,
      finding.entityType,
      finding.property,
      finding.path,
      finding.message,
      finding.expectedReference,
    ].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cleanFinding(finding: SchemaArchitectureFinding): SchemaArchitectureFinding {
  return Object.fromEntries(
    Object.entries(finding).filter(([, value]) => value !== undefined)
  ) as SchemaArchitectureFinding;
}

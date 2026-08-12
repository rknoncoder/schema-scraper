export type FormatMigrationFindingCategory =
  | 'legacy-format'
  | 'duplicate-type'
  | 'data-mismatch';

export interface FormatMigrationFinding {
  category: FormatMigrationFindingCategory;
  severity: 'warning' | 'info';
  entityType: string;
  formats: string[];
  message: string;
  recommendation: string;
  property?: string;
  values?: Array<{ format: string; value: string }>;
  entityName?: string;
  sourceMode?: string;
  jsonLdBlockIndex?: number;
}

interface FormatEntityContext {
  entity: Record<string, unknown>;
  type: string;
  format: string;
  name?: string;
  sourceMode?: string;
  jsonLdBlockIndex?: number;
}

interface ConflictField {
  property: string;
  read: (entity: Record<string, unknown>) => unknown;
}

const LEGACY_CORE_TYPES = new Set([
  'Product',
  'ProductGroup',
  'VideoObject',
  'LocalBusiness',
  'Organization',
  'BreadcrumbList',
  'FAQPage',
]);

const CONFLICT_FIELDS: ConflictField[] = [
  { property: 'name', read: entity => entity.name },
  { property: 'url', read: entity => entity.url },
  { property: 'description', read: entity => entity.description },
  { property: 'sku', read: entity => entity.sku },
  { property: 'image', read: entity => entity.image },
  { property: 'thumbnailUrl', read: entity => entity.thumbnailUrl },
  { property: 'uploadDate', read: entity => entity.uploadDate },
  { property: 'offers.price', read: entity => nestedValue(entity.offers, 'price') },
  { property: 'offers.priceCurrency', read: entity => nestedValue(entity.offers, 'priceCurrency') },
  { property: 'aggregateRating.ratingValue', read: entity => nestedValue(entity.aggregateRating, 'ratingValue') },
];

export function auditFormatMigration(entities: unknown[]): FormatMigrationFinding[] {
  const contexts = collectFormatContexts(entities);
  const findings: FormatMigrationFinding[] = [];

  contexts.forEach(context => {
    if (context.format === 'json-ld') return;
    if (!LEGACY_CORE_TYPES.has(context.type)) return;

    findings.push(cleanFinding({
      category: 'legacy-format',
      severity: 'info',
      entityType: context.type,
      formats: [context.format],
      entityName: context.name,
      sourceMode: context.sourceMode,
      jsonLdBlockIndex: context.jsonLdBlockIndex,
      message: `${context.type} is defined in ${formatLabel(context.format)}.`,
      recommendation: `Migrate this ${context.type} markup into JSON-LD to keep structured data centralized and easier for crawlers to parse.`,
    }));
  });

  groupBy(contexts, context => context.type).forEach((typeContexts, type) => {
    const formats = uniqueValues(typeContexts.map(context => context.format)).sort();
    if (formats.length < 2) return;

    findings.push({
      category: 'duplicate-type',
      severity: 'info',
      entityType: type,
      formats,
      message: `${type} appears in multiple structured-data formats on this page (${formats.map(formatLabel).join(', ')}).`,
      recommendation: `Prefer one canonical JSON-LD definition for ${type}, or ensure every format carries identical values if both must remain.`,
    });

    findings.push(...auditFormatValueConflicts(type, typeContexts, formats));
  });

  return dedupeFindings(findings);
}

function auditFormatValueConflicts(
  type: string,
  contexts: FormatEntityContext[],
  formats: string[]
): FormatMigrationFinding[] {
  const findings: FormatMigrationFinding[] = [];
  const comparableGroups = groupComparableContexts(contexts);

  comparableGroups.forEach(group => {
    CONFLICT_FIELDS.forEach(field => {
      const valuesByFormat = new Map<string, Set<string>>();

      group.forEach(context => {
        const normalized = normalizeComparableValue(field.read(context.entity));
        if (!normalized) return;
        const values = valuesByFormat.get(context.format) || new Set<string>();
        values.add(normalized);
        valuesByFormat.set(context.format, values);
      });

      if (valuesByFormat.size < 2) return;
      const flattened = [...valuesByFormat.entries()].map(([format, values]) => ({
        format,
        value: [...values].sort().join(' | '),
      }));
      const distinctValues = uniqueValues(flattened.map(item => item.value));
      if (distinctValues.length < 2) return;

      findings.push({
        category: 'data-mismatch',
        severity: 'warning',
        entityType: type,
        formats,
        property: field.property,
        entityName: group.map(context => context.name).find(Boolean),
        values: flattened,
        message: `${type}.${field.property} differs across structured-data formats.`,
        recommendation: `Choose one canonical ${field.property} value in JSON-LD and remove or update conflicting legacy markup.`,
      });
    });
  });

  return findings;
}

function groupComparableContexts(contexts: FormatEntityContext[]): FormatEntityContext[][] {
  const keyed = new Map<string, FormatEntityContext[]>();
  contexts.forEach(context => {
    const key = identityKey(context.entity) || context.name;
    if (!key) return;
    const group = keyed.get(key) || [];
    group.push(context);
    keyed.set(key, group);
  });

  const groups = [...keyed.values()].filter(hasMultipleFormats);
  if (groups.length > 0) return groups;

  const formats = uniqueValues(contexts.map(context => context.format));
  if (formats.length > 1 && formats.every(format => contexts.filter(context => context.format === format).length === 1)) {
    return [contexts];
  }

  return [];
}

function collectFormatContexts(entities: unknown[]): FormatEntityContext[] {
  return entities
    .filter(isRecord)
    .map(entity => {
      const meta = isRecord(entity._meta) ? entity._meta : {};
      return {
        entity,
        type: primaryType(entity['@type']),
        format: normalizedFormat(meta.extractionChannel),
        name: stringValue(entity.name),
        sourceMode: stringValue(meta.sourceMode),
        jsonLdBlockIndex: numberValue(meta.jsonLdBlockIndex),
      };
    })
    .filter(context => context.type !== 'Unknown' && context.format !== 'unknown');
}

function hasMultipleFormats(contexts: FormatEntityContext[]): boolean {
  return uniqueValues(contexts.map(context => context.format)).length > 1;
}

function nestedValue(value: unknown, property: string): unknown {
  if (Array.isArray(value)) {
    return value.map(item => nestedValue(item, property)).filter(item => item !== undefined);
  }
  if (!isRecord(value)) return undefined;
  return value[property];
}

function normalizeComparableValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) {
    const values = value
      .map(normalizeComparableValue)
      .filter((item): item is string => Boolean(item))
      .sort();
    return values.length > 0 ? values.join(' | ') : undefined;
  }
  if (isRecord(value)) {
    return normalizeComparableValue(value.url)
      || normalizeComparableValue(value['@id'])
      || normalizeComparableValue(value.name)
      || undefined;
  }
  const text = String(value).trim();
  if (!text) return undefined;
  return text.replace(/\s+/g, ' ').toLowerCase();
}

function identityKey(entity: Record<string, unknown>): string | undefined {
  return normalizeComparableValue(entity['@id'])
    || normalizeComparableValue(entity.url)
    || normalizeComparableValue(entity.sku)
    || normalizeComparableValue(entity.name);
}

function normalizedFormat(value: unknown): string {
  if (value === 'json-ld' || value === 'microdata' || value === 'rdfa') return value;
  return 'unknown';
}

function formatLabel(format: string): string {
  if (format === 'json-ld') return 'JSON-LD';
  if (format === 'microdata') return 'Microdata';
  if (format === 'rdfa') return 'RDFa';
  return format;
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

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function groupBy<T>(
  values: T[],
  keyFn: (value: T) => string
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  values.forEach(value => {
    const key = keyFn(value);
    const group = groups.get(key) || [];
    group.push(value);
    groups.set(key, group);
  });
  return groups;
}

function dedupeFindings(findings: FormatMigrationFinding[]): FormatMigrationFinding[] {
  const seen = new Set<string>();
  return findings.filter(finding => {
    const key = [
      finding.category,
      finding.entityType,
      finding.property,
      finding.entityName,
      finding.formats.join(','),
      finding.message,
    ].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cleanFinding(finding: FormatMigrationFinding): FormatMigrationFinding {
  return Object.fromEntries(
    Object.entries(finding).filter(([, value]) => value !== undefined)
  ) as FormatMigrationFinding;
}

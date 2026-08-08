export interface QualityWarning {
  entityType: string;
  property: string;
  severity: 'warning' | 'info';
  message: string;
  path?: string;
  value?: string;
  entityName?: string;
  sourceMode?: string;
  jsonLdBlockIndex?: number;
}

const CANONICAL_PROPERTY_NAMES = [
  '@context',
  '@id',
  '@type',
  'acceptedAnswer',
  'aggregateRating',
  'author',
  'availability',
  'brand',
  'contactPoint',
  'contentUrl',
  'dateModified',
  'datePublished',
  'description',
  'duration',
  'embedUrl',
  'gtin',
  'hasPart',
  'hasVariant',
  'headline',
  'image',
  'interactionStatistic',
  'item',
  'itemListElement',
  'logo',
  'mainEntity',
  'name',
  'offers',
  'price',
  'priceCurrency',
  'ratingCount',
  'ratingValue',
  'review',
  'reviewCount',
  'sameAs',
  'sku',
  'thumbnailUrl',
  'uploadDate',
  'url',
].reduce((map, property) => {
  map.set(property.toLowerCase(), property);
  return map;
}, new Map<string, string>());

const URL_LIKE_KEYS = new Set([
  '@id',
  'url',
  'sameAs',
  'image',
  'logo',
  'contentUrl',
  'embedUrl',
  'thumbnailUrl',
  'significantLink',
  'relatedLink',
  'discussionUrl',
]);

export function auditSchemaQuality(entities: any[]): QualityWarning[] {
  const warnings: QualityWarning[] = [];

  entities.forEach(entity => {
    if (!entity || typeof entity !== 'object' || Array.isArray(entity)) return;

    const type = primaryType(entity['@type']);
    const entityName = stringValue(entity.name);
    const meta = entity._meta && typeof entity._meta === 'object'
      ? entity._meta as Record<string, unknown>
      : {};

    warnings.push(...auditUrlFields(entity, {
      entityType: type,
      entityName,
      sourceMode: stringValue(meta.sourceMode),
      jsonLdBlockIndex: numberValue(meta.jsonLdBlockIndex),
    }));
    warnings.push(...auditPropertyCasing(entity, {
      entityType: type,
      entityName,
      sourceMode: stringValue(meta.sourceMode),
      jsonLdBlockIndex: numberValue(meta.jsonLdBlockIndex),
    }));

    if (type === 'Organization') {
      if (!hasText(entity.name) && !hasCaseVariant(entity, 'name')) {
        warnings.push(cleanWarning({
          entityType: type,
          property: 'name',
          severity: 'warning',
          message: 'The organization profile exists but lacks an identity label ("name").',
          entityName,
          sourceMode: stringValue(meta.sourceMode),
          jsonLdBlockIndex: numberValue(meta.jsonLdBlockIndex),
        }));
      }

    }

    if ((type === 'Product' || type === 'ProductGroup') && !hasOfferData(entity)) {
      warnings.push(cleanWarning({
        entityType: type,
        property: 'offers',
        severity: 'warning',
        message: 'Missing transaction data ("offers"). This node may be ineligible for price rich-result enhancements.',
        entityName,
        sourceMode: stringValue(meta.sourceMode),
        jsonLdBlockIndex: numberValue(meta.jsonLdBlockIndex),
      }));
    }
  });

  return warnings;
}

function primaryType(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.length > 0) return String(value[0]);
  return 'Unknown';
}

function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function auditPropertyCasing(entity: Record<string, unknown>, context: UrlAuditContext): QualityWarning[] {
  const warnings: QualityWarning[] = [];
  visitPropertyCasing(entity, '$', context, warnings);
  return warnings;
}

function visitPropertyCasing(
  value: unknown,
  path: string,
  context: UrlAuditContext,
  warnings: QualityWarning[]
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitPropertyCasing(item, `${path}[${index}]`, context, warnings));
    return;
  }

  if (!isRecord(value)) return;

  Object.entries(value).forEach(([key, child]) => {
    const canonical = canonicalPropertyFor(key);
    if (canonical && canonical !== key) {
      warnings.push(cleanWarning({
        entityType: context.entityType,
        property: canonical,
        severity: 'warning',
        message: `Found property "${key}" but expected "${canonical}". Schema.org property names are case-sensitive.`,
        path: `${path}.${key}`,
        value: primitivePreview(child),
        entityName: context.entityName,
        sourceMode: context.sourceMode,
        jsonLdBlockIndex: context.jsonLdBlockIndex,
      }));
    }

    visitPropertyCasing(child, `${path}.${key}`, context, warnings);
  });
}

function canonicalPropertyFor(key: string): string | undefined {
  const canonical = CANONICAL_PROPERTY_NAMES.get(key.toLowerCase());
  return canonical && canonical !== key ? canonical : undefined;
}

function hasCaseVariant(entity: Record<string, unknown>, canonicalProperty: string): boolean {
  return Object.keys(entity).some(key => key !== canonicalProperty && key.toLowerCase() === canonicalProperty.toLowerCase());
}

function hasOfferData(entity: Record<string, unknown>): boolean {
  if (entity.offers) return true;

  const variants = entity.hasVariant;
  return Array.isArray(variants) && variants.some(variant =>
    Boolean(
      variant &&
      typeof variant === 'object' &&
      !Array.isArray(variant) &&
      (variant as Record<string, unknown>).offers
    )
  );
}

interface UrlAuditContext {
  entityType: string;
  entityName?: string;
  sourceMode?: string;
  jsonLdBlockIndex?: number;
}

function auditUrlFields(entity: Record<string, unknown>, context: UrlAuditContext): QualityWarning[] {
  const warnings: QualityWarning[] = [];
  visitUrlFields(entity, '$', undefined, context, warnings);
  return warnings;
}

function visitUrlFields(
  value: unknown,
  path: string,
  parentKey: string | undefined,
  context: UrlAuditContext,
  warnings: QualityWarning[]
): void {
  if (typeof value === 'string') {
    if (shouldAuditUrlKey(parentKey)) {
      const warning = validateUrlLikeValue(value, parentKey ?? 'url', path, context);
      if (warning) warnings.push(warning);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      visitUrlFields(item, `${path}[${index}]`, parentKey, context, warnings);
    });
    return;
  }

  if (!isRecord(value)) return;

  Object.entries(value).forEach(([key, child]) => {
    visitUrlFields(child, `${path}.${key}`, key, context, warnings);
  });
}

function validateUrlLikeValue(
  value: string,
  property: string,
  path: string,
  context: UrlAuditContext
): QualityWarning | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return urlWarning(context, property, path, value, 'Empty URL-like value found.');
  }

  if (property === '@id' && (trimmed.startsWith('#') || trimmed.startsWith('_:'))) {
    return undefined;
  }

  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return urlWarning(
      context,
      property,
      path,
      value,
      'Relative URL found. Use absolute URLs so crawlers can parse relationships reliably.'
    );
  }

  if (trimmed.startsWith('//')) {
    return urlWarning(
      context,
      property,
      path,
      value,
      'Protocol-relative URL found. Use an explicit https:// URL in structured data.'
    );
  }

  if (!hasScheme(trimmed)) {
    return urlWarning(
      context,
      property,
      path,
      value,
      'URL-like value is missing a URL scheme such as https://.'
    );
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return urlWarning(
        context,
        property,
        path,
        value,
        `Unsupported URL scheme "${url.protocol.replace(':', '')}" found. Use http:// or https:// for schema URL fields.`
      );
    }
  } catch {
    return urlWarning(
      context,
      property,
      path,
      value,
      'Malformed URL value found. Check for typos such as duplicated protocol text.'
    );
  }

  return undefined;
}

function urlWarning(
  context: UrlAuditContext,
  property: string,
  path: string,
  value: string,
  message: string
): QualityWarning {
  return cleanWarning({
    entityType: context.entityType,
    property,
    severity: 'warning',
    message,
    path,
    value,
    entityName: context.entityName,
    sourceMode: context.sourceMode,
    jsonLdBlockIndex: context.jsonLdBlockIndex,
  });
}

function shouldAuditUrlKey(key: string | undefined): boolean {
  return Boolean(
    key &&
      (URL_LIKE_KEYS.has(key) ||
        key.endsWith('Url') ||
        key.endsWith('URL'))
  );
}

function hasScheme(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function primitivePreview(value: unknown): string | undefined {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return undefined;
}

function cleanWarning(warning: QualityWarning): QualityWarning {
  return Object.fromEntries(
    Object.entries(warning).filter(([, value]) => value !== undefined)
  ) as QualityWarning;
}

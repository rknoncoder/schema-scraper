export interface QualityWarning {
  entityType: string;
  property: string;
  severity: 'warning' | 'info';
  message: string;
}

export function auditSchemaQuality(entities: any[]): QualityWarning[] {
  const warnings: QualityWarning[] = [];

  entities.forEach(entity => {
    if (!entity || typeof entity !== 'object' || Array.isArray(entity)) return;

    const type = primaryType(entity['@type']);

    if (type === 'Organization') {
      if (!hasText(entity.name)) {
        warnings.push({
          entityType: type,
          property: 'name',
          severity: 'warning',
          message: 'The organization profile exists but lacks an identity label ("name").',
        });
      }

      if (typeof entity.url === 'string' && isRelativeUrl(entity.url)) {
        warnings.push({
          entityType: type,
          property: 'url',
          severity: 'warning',
          message: 'Relative URLs found. Use absolute URLs so crawlers can parse relationships reliably.',
        });
      }
    }

    if ((type === 'Product' || type === 'ProductGroup') && !hasOfferData(entity)) {
      warnings.push({
        entityType: type,
        property: 'offers',
        severity: 'warning',
        message: 'Missing transaction data ("offers"). This node may be ineligible for price rich-result enhancements.',
      });
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

function isRelativeUrl(value: string): boolean {
  return value.startsWith('/') && !value.startsWith('//');
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

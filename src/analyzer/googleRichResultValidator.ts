export type Severity = 'error' | 'warning';

export interface GoogleRuleIssue {
  property: string;
  severity: Severity;
  message: string;
}

export interface RichResultDefinition {
  type: string;
  requiredFields: string[];
  recommendedFields: string[];
  customValidator?: (entity: any) => GoogleRuleIssue[];
  status?: 'active' | 'deprecated';
  deprecationNotice?: string;
}

export interface GoogleAuditResult {
  entityId: string | null;
  type: string;
  status: 'Eligible' | 'Ineligible' | 'Deprecated';
  issues: GoogleRuleIssue[];
  notice?: string;
}

export const GOOGLE_RULES: Record<string, RichResultDefinition> = {
  Product: {
    type: 'Product',
    requiredFields: ['name'],
    recommendedFields: ['image', 'description', 'sku', 'gtin', 'brand'],
    customValidator: entity => {
      if (
        hasMeaningfulValue(entity.offers) ||
        hasMeaningfulValue(entity.review) ||
        hasMeaningfulValue(entity.aggregateRating)
      ) {
        return [];
      }

      return [
        {
          property: 'offers|review|aggregateRating',
          severity: 'error',
          message: 'Product needs at least one of offers, review, or aggregateRating for Google rich result eligibility.',
        },
      ];
    },
  },
  BreadcrumbList: {
    type: 'BreadcrumbList',
    requiredFields: ['itemListElement'],
    recommendedFields: [],
    customValidator: entity => {
      const elements: unknown[] = Array.isArray(entity.itemListElement)
        ? entity.itemListElement
        : hasMeaningfulValue(entity.itemListElement)
          ? [entity.itemListElement]
          : [];

      return elements.flatMap((item, index) => (
        isRecord(item) && hasMeaningfulValue(item.position)
          ? []
          : [{
              property: `itemListElement[${index}].position`,
              severity: 'error' as const,
              message: 'BreadcrumbList itemListElement entries must include a position value.',
            }]
      ));
    },
  },
  FAQPage: {
    type: 'FAQPage',
    requiredFields: [],
    recommendedFields: ['mainEntity'],
    status: 'deprecated',
    deprecationNotice: 'Google deprecated FAQ rich results as of May 7, 2026. This markup is ignored for standard search results.',
  },
  Organization: {
    type: 'Organization',
    requiredFields: ['name'],
    recommendedFields: ['url', 'logo', 'sameAs', 'contactPoint'],
  },
  LocalBusiness: {
    type: 'LocalBusiness',
    requiredFields: ['name', 'address'],
    recommendedFields: ['url', 'telephone', 'image', 'geo', 'openingHours', 'priceRange'],
  },
  Article: {
    type: 'Article',
    requiredFields: ['headline', 'image'],
    recommendedFields: ['author', 'datePublished', 'dateModified', 'publisher', 'description'],
  },
};

export function auditGoogleEligibility(resolvedEntities: any[]): GoogleAuditResult[] {
  const candidates = collectGoogleRichResultCandidates(resolvedEntities);

  return candidates.flatMap(entity => {
    const types = typeValues(entity['@type']).filter(type => GOOGLE_RULES[type]);

    return types.map(type => auditEntityForType(entity, GOOGLE_RULES[type]));
  });
}

function auditEntityForType(entity: any, definition: RichResultDefinition): GoogleAuditResult {
  const requiredIssues = definition.requiredFields
    .filter(field => !hasFieldPath(entity, field))
    .map(field => ({
      property: field,
      severity: 'error' as const,
      message: `${definition.type} is missing required Google field "${field}".`,
    }));

  const recommendedIssues = definition.recommendedFields
    .filter(field => !hasFieldPath(entity, field))
    .map(field => ({
      property: field,
      severity: 'warning' as const,
      message: `${definition.type} is missing recommended Google field "${field}".`,
    }));

  const customIssues = definition.customValidator?.(entity) ?? [];
  const issues = [...requiredIssues, ...recommendedIssues, ...customIssues];

  if (definition.status === 'deprecated') {
    return {
      entityId: entityIdentifier(entity),
      type: definition.type,
      status: 'Deprecated',
      issues,
      notice: definition.deprecationNotice,
    };
  }

  return {
    entityId: entityIdentifier(entity),
    type: definition.type,
    status: issues.some(issue => issue.severity === 'error') ? 'Ineligible' : 'Eligible',
    issues,
  };
}

function collectGoogleRichResultCandidates(value: unknown): any[] {
  const candidates: any[] = [];
  const seen = new WeakSet<object>();

  visit(value);
  return candidates;

  function visit(current: unknown): void {
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }

    if (!isRecord(current) || seen.has(current)) return;
    seen.add(current);

    if (typeValues(current['@type']).some(type => GOOGLE_RULES[type])) {
      candidates.push(current);
    }

    Object.entries(current)
      .filter(([key]) => key !== '_meta')
      .forEach(([, child]) => visit(child));
  }
}

function hasFieldPath(entity: any, path: string): boolean {
  const value = path.split('.').reduce<unknown>((current, part) => (
    isRecord(current) ? current[part] : undefined
  ), entity);

  return hasMeaningfulValue(value);
}

function hasMeaningfulValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.keys(value).length > 0;
  return true;
}

function entityIdentifier(entity: any): string | null {
  return stringValue(entity?.['@id'])
    ?? stringValue(entity?.url)
    ?? stringValue(entity?.name)
    ?? null;
}

function typeValues(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }

  return [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value
    : undefined;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object';
}

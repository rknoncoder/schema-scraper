export type Severity = 'error' | 'warning';
export type FieldSeverity = 'required' | 'recommended';
export type CandidateMode = 'root' | 'nested-enhancement';
export type GoogleFeatureStatus = 'active' | 'deprecated' | 'restricted';

export interface GoogleRuleIssue {
  property: string;
  severity: Severity;
  message: string;
}

export interface FieldRule {
  property: string;
  severity: FieldSeverity;
  message?: string;
  isValid?: (value: unknown, entity: SchemaEntity) => boolean;
}

export interface EitherOrFieldRule {
  properties: string[];
  severity: FieldSeverity;
  message: string;
}

export type GoogleFieldRule = FieldRule | EitherOrFieldRule;

export interface NestedEnhancement {
  hostFeatureId: string;
  hostProperty: string;
  optional: boolean;
}

export interface GoogleFeatureRule {
  featureId: string;
  featureName: string;
  schemaTypes: string[];
  candidateMode: CandidateMode;
  fields: GoogleFieldRule[];
  appliesIf?: (entity: SchemaEntity) => boolean;
  customValidator?: (entity: SchemaEntity) => GoogleRuleIssue[];
  nestedIn?: NestedEnhancement;
  status?: GoogleFeatureStatus;
  statusNotice?: string;
  docsUrl?: string;
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
  featureId?: string;
  featureName?: string;
  schemaType?: string;
  docsUrl?: string;
}

export type SchemaEntity = Record<string, unknown>;

export const SUPPORTED_GOOGLE_FEATURES: GoogleFeatureRule[] = [
  {
    featureId: 'product-snippet',
    featureName: 'Product snippet',
    schemaTypes: ['Product'],
    candidateMode: 'root',
    fields: [
      { property: 'name', severity: 'required' },
      {
        properties: ['offers', 'review', 'aggregateRating'],
        severity: 'required',
        message: 'Product needs at least one of offers, review, or aggregateRating for Google rich result eligibility.',
      },
      { property: 'image', severity: 'recommended' },
      { property: 'description', severity: 'recommended' },
      { property: 'sku', severity: 'recommended' },
      { property: 'gtin', severity: 'recommended' },
      { property: 'brand', severity: 'recommended' },
    ],
    docsUrl: 'https://developers.google.com/search/docs/appearance/structured-data/product-snippet',
  },
  {
    featureId: 'merchant-listing',
    featureName: 'Merchant listing',
    schemaTypes: ['Product'],
    candidateMode: 'root',
    appliesIf: entity => (
      hasMeaningfulValue(entity.offers) ||
      hasMeaningfulValue(entity.gtin) ||
      hasMeaningfulValue(entity.mpn) ||
      hasMeaningfulValue(entity.isbn)
    ),
    fields: [
      { property: 'name', severity: 'required' },
      { property: 'image', severity: 'required' },
      { property: 'offers', severity: 'required' },
      { property: 'brand', severity: 'required' },
      {
        properties: ['gtin', 'mpn', 'isbn'],
        severity: 'required',
        message: 'Merchant listing needs at least one product identifier: gtin, mpn, or isbn.',
      },
    ],
    docsUrl: 'https://developers.google.com/search/docs/appearance/structured-data/merchant-listing',
  },
  {
    featureId: 'product-variants',
    featureName: 'Product variants',
    schemaTypes: ['ProductGroup'],
    candidateMode: 'root',
    fields: [
      { property: 'name', severity: 'required' },
      { property: 'productGroupID', severity: 'required' },
      { property: 'variesBy', severity: 'required' },
      { property: 'url', severity: 'required' },
    ],
    docsUrl: 'https://developers.google.com/search/docs/appearance/structured-data/product-variants',
  },
  {
    featureId: 'breadcrumb-list',
    featureName: 'Breadcrumb',
    schemaTypes: ['BreadcrumbList'],
    candidateMode: 'root',
    fields: [
      { property: 'itemListElement', severity: 'required' },
    ],
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
    docsUrl: 'https://developers.google.com/search/docs/appearance/structured-data/breadcrumb',
  },
  {
    featureId: 'faq-page',
    featureName: 'FAQ',
    schemaTypes: ['FAQPage'],
    candidateMode: 'root',
    fields: [
      { property: 'mainEntity', severity: 'recommended' },
    ],
    status: 'restricted',
    statusNotice: 'Google deprecated FAQ rich results as of May 7, 2026. This markup is ignored for standard search results.',
    docsUrl: 'https://developers.google.com/search/docs/appearance/structured-data/faqpage',
  },
  {
    featureId: 'organization',
    featureName: 'Organization',
    schemaTypes: ['Organization', 'Corporation', 'EducationalOrganization'],
    candidateMode: 'root',
    fields: [
      { property: 'name', severity: 'required' },
      { property: 'url', severity: 'recommended' },
      { property: 'logo', severity: 'recommended' },
      { property: 'sameAs', severity: 'recommended' },
      { property: 'contactPoint', severity: 'recommended' },
    ],
    docsUrl: 'https://developers.google.com/search/docs/appearance/structured-data/organization',
  },
  {
    featureId: 'local-business',
    featureName: 'Local business',
    schemaTypes: ['LocalBusiness', 'Store', 'Restaurant'],
    candidateMode: 'root',
    fields: [
      { property: 'name', severity: 'required' },
      { property: 'address', severity: 'required' },
      { property: 'url', severity: 'recommended' },
      { property: 'telephone', severity: 'recommended' },
      { property: 'image', severity: 'recommended' },
      { property: 'geo', severity: 'recommended' },
      { property: 'openingHours', severity: 'recommended' },
      { property: 'priceRange', severity: 'recommended' },
    ],
    docsUrl: 'https://developers.google.com/search/docs/appearance/structured-data/local-business',
  },
  {
    featureId: 'article',
    featureName: 'Article',
    schemaTypes: ['Article', 'NewsArticle', 'BlogPosting', 'TechArticle'],
    candidateMode: 'root',
    fields: [
      { property: 'headline', severity: 'required' },
      { property: 'image', severity: 'required' },
      { property: 'author', severity: 'recommended' },
      { property: 'datePublished', severity: 'recommended' },
      { property: 'dateModified', severity: 'recommended' },
      { property: 'publisher', severity: 'recommended' },
      { property: 'description', severity: 'recommended' },
    ],
    docsUrl: 'https://developers.google.com/search/docs/appearance/structured-data/article',
  },
  {
    featureId: 'video-object',
    featureName: 'Video',
    schemaTypes: ['VideoObject'],
    candidateMode: 'root',
    fields: [
      { property: 'name', severity: 'required' },
      {
        property: 'thumbnailUrl',
        severity: 'required',
        message: 'VideoObject is missing required Google field "thumbnailUrl".',
      },
      {
        property: 'uploadDate',
        severity: 'required',
        message: 'VideoObject is missing required Google field "uploadDate".',
      },
      { property: 'description', severity: 'recommended' },
      { property: 'duration', severity: 'recommended' },
      { property: 'interactionStatistic', severity: 'recommended' },
      {
        properties: ['contentUrl', 'embedUrl'],
        severity: 'recommended',
        message: 'VideoObject should include contentUrl or embedUrl so Google can access the video content.',
      },
    ],
    docsUrl: 'https://developers.google.com/search/docs/appearance/structured-data/video',
  },
  {
    featureId: 'event',
    featureName: 'Event',
    schemaTypes: ['Event'],
    candidateMode: 'root',
    fields: [
      { property: 'name', severity: 'required' },
      { property: 'startDate', severity: 'required' },
      { property: 'location', severity: 'required' },
      { property: 'image', severity: 'recommended' },
      { property: 'description', severity: 'recommended' },
      { property: 'endDate', severity: 'recommended' },
      { property: 'offers', severity: 'recommended' },
      { property: 'eventStatus', severity: 'recommended' },
    ],
    docsUrl: 'https://developers.google.com/search/docs/appearance/structured-data/event',
  },
  {
    featureId: 'job-posting',
    featureName: 'Job posting',
    schemaTypes: ['JobPosting'],
    candidateMode: 'root',
    fields: [
      { property: 'title', severity: 'required' },
      { property: 'description', severity: 'required' },
      { property: 'datePosted', severity: 'required' },
      { property: 'hiringOrganization', severity: 'required' },
      { property: 'jobLocation', severity: 'required' },
      { property: 'validThrough', severity: 'recommended' },
      { property: 'employmentType', severity: 'recommended' },
      { property: 'baseSalary', severity: 'recommended' },
    ],
    docsUrl: 'https://developers.google.com/search/docs/appearance/structured-data/job-posting',
  },
  {
    featureId: 'recipe',
    featureName: 'Recipe',
    schemaTypes: ['Recipe'],
    candidateMode: 'root',
    fields: [
      { property: 'name', severity: 'required' },
      { property: 'image', severity: 'required' },
      { property: 'recipeIngredient', severity: 'recommended' },
      { property: 'recipeInstructions', severity: 'recommended' },
      { property: 'author', severity: 'recommended' },
      { property: 'datePublished', severity: 'recommended' },
      { property: 'prepTime', severity: 'recommended' },
      { property: 'cookTime', severity: 'recommended' },
    ],
    docsUrl: 'https://developers.google.com/search/docs/appearance/structured-data/recipe',
  },
  {
    featureId: 'software-application',
    featureName: 'Software app',
    schemaTypes: ['SoftwareApplication', 'MobileApplication', 'WebApplication'],
    candidateMode: 'root',
    fields: [
      { property: 'name', severity: 'required' },
      { property: 'offers', severity: 'required' },
      { property: 'aggregateRating', severity: 'recommended' },
      { property: 'applicationCategory', severity: 'recommended' },
      { property: 'operatingSystem', severity: 'recommended' },
    ],
    docsUrl: 'https://developers.google.com/search/docs/appearance/structured-data/software-app',
  },
];

export const GOOGLE_RULES: Record<string, RichResultDefinition> = buildLegacyGoogleRules(
  SUPPORTED_GOOGLE_FEATURES
);

export function auditGoogleEligibility(resolvedEntities: any[]): GoogleAuditResult[] {
  const rootFeatures = SUPPORTED_GOOGLE_FEATURES.filter(feature => feature.candidateMode === 'root');
  const candidates = collectGoogleRichResultCandidates(resolvedEntities);

  return candidates.flatMap(entity => {
    const types = typeValues(entity['@type']);

    return rootFeatures
      .filter(feature =>
        feature.schemaTypes.some(type => types.includes(type)) &&
        (!feature.appliesIf || feature.appliesIf(entity))
      )
      .map(feature => auditEntityForFeature(entity, feature));
  });
}

function auditEntityForFeature(entity: SchemaEntity, feature: GoogleFeatureRule): GoogleAuditResult {
  const issues = [
    ...feature.fields.flatMap(rule => evaluateFieldRule(entity, feature, rule)),
    ...(feature.customValidator?.(entity) ?? []),
  ];
  const schemaType = primaryMatchedType(entity, feature);
  const hasRequiredMiss = issues.some(issue => issue.severity === 'error');
  const status = feature.status === 'deprecated' || feature.status === 'restricted'
    ? 'Deprecated'
    : hasRequiredMiss
      ? 'Ineligible'
      : 'Eligible';

  return {
    entityId: entityIdentifier(entity),
    type: schemaType ?? feature.schemaTypes[0] ?? feature.featureName,
    status,
    issues,
    notice: feature.statusNotice,
    featureId: feature.featureId,
    featureName: feature.featureName,
    schemaType,
    docsUrl: feature.docsUrl,
  };
}

function evaluateFieldRule(
  entity: SchemaEntity,
  feature: GoogleFeatureRule,
  rule: GoogleFieldRule
): GoogleRuleIssue[] {
  if (isEitherOrRule(rule)) {
    const satisfied = rule.properties.some(property => hasFieldPath(entity, property));
    return satisfied
      ? []
      : [{
          property: rule.properties.join('|'),
          severity: severityFor(rule.severity),
          message: rule.message,
        }];
  }

  const value = valueAtFieldPath(entity, rule.property);
  const valid = rule.isValid ? rule.isValid(value, entity) : hasMeaningfulValue(value);
  return valid
    ? []
    : [{
        property: rule.property,
        severity: severityFor(rule.severity),
        message: rule.message ?? defaultMissingFieldMessage(feature, rule),
      }];
}

function collectGoogleRichResultCandidates(value: unknown): SchemaEntity[] {
  const candidates: SchemaEntity[] = [];
  const seen = new WeakSet<object>();

  collectTopLevel(value);
  return candidates;

  function collectTopLevel(current: unknown): void {
    if (Array.isArray(current)) {
      current.forEach(collectTopLevel);
      return;
    }

    if (!isRecord(current) || seen.has(current)) return;
    seen.add(current);

    if (typeValues(current['@type']).some(type => featureForType(type))) {
      candidates.push(current);
    }
  }
}

function buildLegacyGoogleRules(features: GoogleFeatureRule[]): Record<string, RichResultDefinition> {
  const rules: Record<string, RichResultDefinition> = {};

  features
    .filter(feature => feature.candidateMode === 'root')
    .forEach(feature => {
      feature.schemaTypes.forEach(type => {
        if (rules[type]) return;

        rules[type] = {
          type,
          requiredFields: fieldNamesForSeverity(feature.fields, 'required'),
          recommendedFields: fieldNamesForSeverity(feature.fields, 'recommended'),
          status: feature.status === 'deprecated' || feature.status === 'restricted'
            ? 'deprecated'
            : 'active',
          deprecationNotice: feature.statusNotice,
        };
      });
    });

  return rules;
}

function fieldNamesForSeverity(fields: GoogleFieldRule[], severity: FieldSeverity): string[] {
  return fields.flatMap(field => {
    if (field.severity !== severity) return [];
    return isEitherOrRule(field) ? [field.properties.join('|')] : [field.property];
  });
}

function featureForType(type: string): GoogleFeatureRule | undefined {
  return SUPPORTED_GOOGLE_FEATURES.find(feature =>
    feature.candidateMode === 'root' && feature.schemaTypes.includes(type)
  );
}

function primaryMatchedType(entity: SchemaEntity, feature: GoogleFeatureRule): string | undefined {
  return typeValues(entity['@type']).find(type => feature.schemaTypes.includes(type));
}

function defaultMissingFieldMessage(feature: GoogleFeatureRule, rule: FieldRule): string {
  return `${feature.featureName} is missing ${rule.severity} Google field "${rule.property}".`;
}

function severityFor(severity: FieldSeverity): Severity {
  return severity === 'required' ? 'error' : 'warning';
}

function isEitherOrRule(rule: GoogleFieldRule): rule is EitherOrFieldRule {
  return Array.isArray((rule as EitherOrFieldRule).properties);
}

function hasFieldPath(entity: SchemaEntity, path: string): boolean {
  return hasMeaningfulValue(valueAtFieldPath(entity, path));
}

function valueAtFieldPath(entity: SchemaEntity, path: string): unknown {
  return path.split('.').reduce<unknown>((current, part) => (
    isRecord(current) ? current[part] : undefined
  ), entity);
}

function hasMeaningfulValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.keys(value).length > 0;
  return true;
}

function entityIdentifier(entity: SchemaEntity): string | null {
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

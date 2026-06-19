type JsonObject = Record<string, unknown>;

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

/**
 * Safely resolves relative schema URLs into absolute URLs using the page URL.
 */
export function canonicalizeStringPaths(value: string, baseHtmlUrl: string): string {
  if (typeof value !== 'string') return value;

  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith('//') || hasScheme(trimmed)) return value;

  try {
    const baseUrl = new URL(baseHtmlUrl);
    if (baseUrl.protocol !== 'http:' && baseUrl.protocol !== 'https:') return value;
    baseUrl.search = '';
    baseUrl.hash = '';

    return new URL(trimmed, baseUrl.href).href;
  } catch {
    return value;
  }
}

export function canonicalizeSchemaUrls<T>(value: T, baseHtmlUrl?: string): T {
  if (!baseHtmlUrl || !isHttpUrl(baseHtmlUrl)) return value;
  return canonicalizeNode(value, baseHtmlUrl) as T;
}

function canonicalizeNode(
  value: unknown,
  baseHtmlUrl: string,
  parentKey?: string
): unknown {
  if (typeof value === 'string') {
    return shouldCanonicalizeKey(parentKey)
      ? canonicalizeStringPaths(value, baseHtmlUrl)
      : value;
  }

  if (Array.isArray(value)) {
    return value.map(item => canonicalizeNode(item, baseHtmlUrl, parentKey));
  }

  if (!isJsonObject(value)) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      canonicalizeNode(child, baseHtmlUrl, key),
    ])
  );
}

function shouldCanonicalizeKey(key: string | undefined): boolean {
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

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

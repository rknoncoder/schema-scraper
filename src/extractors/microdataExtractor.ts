import * as cheerio from 'cheerio';
import type { Cheerio, CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';

const SCHEMA_CONTEXT = 'https://schema.org';

export function extractMicrodata(html: string): object[] {
  const $ = cheerio.load(html);

  return $('[itemscope]')
    .toArray()
    .filter(element => isTopLevelScope($, element))
    .map(element => parseScope($, $(element)));
}

function parseScope($: CheerioAPI, scope: Cheerio<Element>): Record<string, unknown> {
  const schema: Record<string, unknown> = {
    '@context': SCHEMA_CONTEXT,
  };
  const type = scope.attr('itemtype');
  const id = scope.attr('itemid');

  if (type) schema['@type'] = normalizeType(type);
  if (id) schema['@id'] = id.trim();

  const propertyElements = scope
    .find('[itemprop]')
    .toArray()
    .filter((element): element is Element =>
      belongsToScope($, element, scope[0])
    );

  for (const element of propertyElements) {
    const property = $(element).attr('itemprop');
    if (!property) continue;

    addProperty(schema, normalizeProperty(property), readPropertyValue($, $(element)));
  }

  return schema;
}

function readPropertyValue($: CheerioAPI, element: Cheerio<Element>): unknown {
  if (element.is('[itemscope]')) {
    return parseScope($, element);
  }

  const content = element.attr('content');
  const href = element.attr('href');
  const src = element.attr('src');
  const datetime = element.attr('datetime');

  return (content ?? href ?? src ?? datetime ?? element.text()).trim();
}

function addProperty(target: Record<string, unknown>, key: string, value: unknown): void {
  if (!(key in target)) {
    target[key] = value;
    return;
  }

  const existing = target[key];
  target[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
}

function isTopLevelScope($: CheerioAPI, element: Element): boolean {
  return $(element).parents('[itemscope]').length === 0;
}

function belongsToScope($: CheerioAPI, element: Element, scope: Element | undefined): boolean {
  const ownerScope = $(element).parents('[itemscope]').first()[0];
  return ownerScope === scope;
}

function normalizeType(value: string): string | string[] {
  const types = value
    .split(/\s+/)
    .map(type => type.trim())
    .filter(Boolean)
    .map(lastTerm);

  return types.length === 1 ? types[0] : types;
}

function normalizeProperty(value: string): string {
  return lastTerm(value.trim());
}

function lastTerm(value: string): string {
  return value
    .replace(/\/$/, '')
    .split(/[/:#]/)
    .filter(Boolean)
    .pop() ?? value;
}

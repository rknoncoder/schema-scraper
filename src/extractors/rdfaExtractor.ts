import * as cheerio from 'cheerio';
import type { Cheerio, CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';

const SCHEMA_CONTEXT = 'https://schema.org';

export function extractRdfa(html: string): object[] {
  const $ = cheerio.load(html);

  return $('[typeof]')
    .toArray()
    .filter(element => isTopLevelType($, element))
    .map(element => parseType($, $(element)));
}

function parseType($: CheerioAPI, typeElement: Cheerio<Element>): Record<string, unknown> {
  const schema: Record<string, unknown> = {
    '@context': SCHEMA_CONTEXT,
  };
  const type = typeElement.attr('typeof');
  const id = typeElement.attr('resource') ?? typeElement.attr('about');

  if (type) schema['@type'] = normalizeTermList(type);
  if (id) schema['@id'] = id.trim();

  const propertyElements = typeElement
    .find('[property]')
    .toArray()
    .filter((element): element is Element =>
      belongsToType($, element, typeElement[0])
    );

  for (const element of propertyElements) {
    const property = $(element).attr('property');
    if (!property) continue;

    addProperty(schema, normalizeProperty(property), readPropertyValue($, $(element)));
  }

  return schema;
}

function readPropertyValue($: CheerioAPI, element: Cheerio<Element>): unknown {
  if (element.is('[typeof]')) {
    return parseType($, element);
  }

  const content = element.attr('content');
  const resource = element.attr('resource');
  const href = element.attr('href');
  const src = element.attr('src');
  const datetime = element.attr('datetime');

  return (content ?? resource ?? href ?? src ?? datetime ?? element.text()).trim();
}

function addProperty(target: Record<string, unknown>, key: string, value: unknown): void {
  if (!(key in target)) {
    target[key] = value;
    return;
  }

  const existing = target[key];
  target[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
}

function isTopLevelType($: CheerioAPI, element: Element): boolean {
  return $(element).parents('[typeof]').length === 0;
}

function belongsToType($: CheerioAPI, element: Element, typeElement: Element | undefined): boolean {
  const ownerType = $(element).parents('[typeof]').first()[0];
  return ownerType === typeElement;
}

function normalizeTermList(value: string): string | string[] {
  const terms = value
    .split(/\s+/)
    .map(type => type.trim())
    .filter(Boolean)
    .map(lastTerm);

  return terms.length === 1 ? terms[0] : terms;
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

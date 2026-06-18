import { SchemaSource, TreeNode } from './treeNode';

export function buildSourceTree(
  value: unknown,
  source: SchemaSource,
  index = 1
): TreeNode {
  return buildNode(value, source, `Schema #${index}`, `schemas[${index - 1}]`);
}

function buildNode(
  value: unknown,
  source: SchemaSource,
  label: string,
  path: string
): TreeNode {
  if (Array.isArray(value)) {
    return {
      id: path,
      label,
      type: 'array',
      source,
      children: value.map((item, index) =>
        buildNode(item, source, `[${index}]`, `${path}[${index}]`)
      ),
      meta: {
        path,
        schemaType: sharedArraySchemaType(value),
      },
    };
  }

  if (isRecord(value)) {
    return {
      id: path,
      label,
      type: 'object',
      source,
      children: Object.entries(value).map(([key, child]) =>
        buildNode(child, source, key, `${path}.${key}`)
      ),
      meta: {
        path,
        schemaType: schemaType(value),
        idRef: typeof value['@id'] === 'string' ? value['@id'] : undefined,
      },
    };
  }

  return {
    id: path,
    label,
    type: 'field',
    source,
    value: primitiveValue(value),
    children: [],
    meta: { path },
  };
}

function schemaType(value: Record<string, unknown>): string | undefined {
  const type = value['@type'];
  if (typeof type === 'string') return type;
  if (Array.isArray(type) && type.length > 0) return type.map(String).join(', ');
  return undefined;
}

function sharedArraySchemaType(value: unknown[]): string | undefined {
  const types = value
    .filter(isRecord)
    .map(schemaType)
    .filter((type): type is string => typeof type === 'string');

  if (types.length === 0) return undefined;
  return types.every(type => type === types[0]) ? types[0] : undefined;
}

function primitiveValue(value: unknown): string | number | boolean | undefined {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (value === null) return 'null';
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

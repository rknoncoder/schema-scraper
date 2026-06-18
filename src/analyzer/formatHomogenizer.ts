import type { SchemaSource, TreeNode } from '../tree/treeNode';

const SCHEMA_CONTEXT = 'https://schema.org';

type JsonObject = Record<string, unknown>;

export interface ASTNode {
  id: string;
  label: string;
  type: 'schema' | 'field';
  source: string;
  value?: string;
  children: ASTNode[];
  meta: {
    path: string;
    schemaType?: string;
  };
}

export interface SchemaLikeBlock {
  source?: SchemaSource;
  data?: unknown;
  tree?: TreeNode;
}

export function homogenizeAST(node: ASTNode): unknown {
  if (node.type === 'field' && node.children.length === 0) {
    return node.value;
  }

  const result: JsonObject = {};

  if (node.meta?.schemaType) {
    result['@type'] = node.meta.schemaType;
  }

  for (const child of node.children) {
    const key = child.label;
    const value = homogenizeAST(child);

    if (key === 'itemListElement') {
      const values = Array.isArray(result[key]) ? result[key] : [];
      values.push(value);
      result[key] = values;
      continue;
    }

    assignObjectProperty(result, key, value);
  }

  return result;
}

export function homogenizeMicrodataAst(
  rawMicrodataNodes: TreeNode | TreeNode[]
): JsonObject[] {
  const nodes = Array.isArray(rawMicrodataNodes)
    ? rawMicrodataNodes
    : [rawMicrodataNodes];

  return nodes
    .map(node => homogenizeTreeNode(node))
    .filter(isJsonObject)
    .map(addRootSchemaDefaults);
}

export function homogenizeSchemaFormat(blocks: SchemaLikeBlock[]): JsonObject[] {
  return blocks.flatMap(block => {
    if (isJsonObject(block.data)) return [block.data];

    if (Array.isArray(block.data)) {
      return block.data.filter(isJsonObject);
    }

    if (block.tree && block.source === 'microdata') {
      return homogenizeMicrodataAst(block.tree);
    }

    if (block.tree && block.source === 'rdfa') {
      return homogenizeMicrodataAst(block.tree);
    }

    return [];
  });
}

function homogenizeTreeNode(node: TreeNode): unknown {
  if (node.type === 'field') return node.value;
  if (node.type === 'array') return homogenizeArrayNode(node);
  return homogenizeObjectNode(node);
}

function homogenizeArrayNode(node: TreeNode): unknown[] {
  return node.children.map(child => homogenizeTreeNode(child));
}

function homogenizeObjectNode(node: TreeNode): JsonObject {
  const result: JsonObject = {};

  applyNodeMetadata(result, node);

  for (const child of node.children) {
    assignObjectProperty(result, child.label, homogenizeTreeNode(child));
  }

  return result;
}

function assignObjectProperty(
  target: JsonObject,
  key: string,
  value: unknown
): void {
  if (!(key in target)) {
    target[key] = value;
    return;
  }

  if (key.startsWith('@')) {
    target[key] = value;
    return;
  }

  target[key] = Array.isArray(target[key])
    ? [...target[key], value]
    : [target[key], value];
}

function applyNodeMetadata(target: JsonObject, node: TreeNode): void {
  const schemaType = node.meta?.schemaType;
  if (schemaType && target['@type'] === undefined) {
    target['@type'] = schemaType;
  }

  const idRef = node.meta?.idRef;
  if (idRef && target['@id'] === undefined) {
    target['@id'] = idRef;
  }
}

function addRootSchemaDefaults(schema: JsonObject): JsonObject {
  return schema['@context'] === undefined
    ? { '@context': SCHEMA_CONTEXT, ...schema }
    : schema;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

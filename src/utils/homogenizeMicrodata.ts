const SCHEMA_CONTEXT = 'https://schema.org';

type PathToken =
  | { kind: 'property'; key: string }
  | { kind: 'index'; index: number };

type JsonObject = Record<string, unknown>;

interface PathParts {
  rootKey: string;
  tokens: PathToken[];
}

export function homogenizeMicrodata(rawMicrodataNodes: any[]): JsonObject[] {
  const roots = new Map<string, JsonObject>();

  const nodesWithPaths = rawMicrodataNodes
    .map(node => ({ node, path: readPath(node) }))
    .filter((entry): entry is { node: any; path: string } =>
      typeof entry.path === 'string' && entry.path.length > 0
    )
    .map(entry => ({
      ...entry,
      parts: splitRootPath(parsePath(entry.path)),
    }))
    .sort((left, right) => left.parts.tokens.length - right.parts.tokens.length);

  for (const { node, parts } of nodesWithPaths) {
    const root = getRoot(roots, parts.rootKey);

    if (parts.tokens.length === 0) {
      applySchemaMetadata(root, node, true);
      continue;
    }

    assignNode(root, parts.tokens, node);
  }

  return [...roots.values()];
}

function readPath(node: any): string | undefined {
  return firstString(
    node?.meta?.path,
    node?.metaPath,
    node?.propertyPath,
    node?.path,
    node?.id
  );
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string =>
    typeof value === 'string' && value.trim().length > 0
  );
}

function parsePath(path: string): PathToken[] {
  return splitPathSegments(path).flatMap(parsePathSegment);
}

function splitPathSegments(path: string): string[] {
  const segments: string[] = [];
  let current = '';
  let bracketDepth = 0;

  for (const char of path.trim()) {
    if (char === '.' && bracketDepth === 0) {
      if (current) segments.push(current);
      current = '';
      continue;
    }

    if (char === '[') bracketDepth += 1;
    if (char === ']') bracketDepth = Math.max(0, bracketDepth - 1);
    current += char;
  }

  if (current) segments.push(current);
  return segments;
}

function parsePathSegment(segment: string): PathToken[] {
  const tokens: PathToken[] = [];
  const property = segment.match(/^[^\[]+/)?.[0];

  if (property) {
    tokens.push({
      kind: 'property',
      key: unquoteSegment(property),
    });
  }

  const indexPattern = /\[(\d+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = indexPattern.exec(segment)) !== null) {
    tokens.push({
      kind: 'index',
      index: Number.parseInt(match[1], 10),
    });
  }

  return tokens;
}

function unquoteSegment(value: string): string {
  return value.replace(/^['"]|['"]$/g, '');
}

function splitRootPath(tokens: PathToken[]): PathParts {
  if (
    tokens.length >= 2 &&
    tokens[0].kind === 'property' &&
    tokens[1].kind === 'index' &&
    isRootContainer(tokens[0].key)
  ) {
    return {
      rootKey: `${tokens[0].key}[${tokens[1].index}]`,
      tokens: tokens.slice(2),
    };
  }

  return {
    rootKey: '__root__',
    tokens,
  };
}

function isRootContainer(key: string): boolean {
  return /^(schema|schemas|script|scripts|node|nodes|item|items|microdata|microdataNodes)$/i
    .test(key);
}

function getRoot(roots: Map<string, JsonObject>, rootKey: string): JsonObject {
  let root = roots.get(rootKey);

  if (!root) {
    root = {
      '@context': SCHEMA_CONTEXT,
    };
    roots.set(rootKey, root);
  }

  return root;
}

function assignNode(root: JsonObject, tokens: PathToken[], node: any): void {
  let current: unknown = root;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const nextToken = tokens[index + 1];
    const isLast = index === tokens.length - 1;

    if (token.kind === 'property') {
      current = assignPropertyToken(current, token, nextToken, node, isLast);
      continue;
    }

    current = assignIndexToken(current, token, nextToken, node, isLast);
  }
}

function assignPropertyToken(
  current: unknown,
  token: Extract<PathToken, { kind: 'property' }>,
  nextToken: PathToken | undefined,
  node: any,
  isLast: boolean
): unknown {
  if (!isJsonObject(current)) return current;

  if (isLast) {
    const value = nodeValue(node);
    const nextValue = value === undefined ? makeContainerForNode(node) : value;
    assignProperty(current, token.key, nextValue, node);
    return current[token.key];
  }

  if (nextToken?.kind === 'index') {
    current[token.key] = Array.isArray(current[token.key])
      ? current[token.key]
      : [];
    return current[token.key];
  }

  current[token.key] = isJsonObject(current[token.key])
    ? current[token.key]
    : {};
  applySchemaMetadata(current[token.key], node, false);
  return current[token.key];
}

function assignIndexToken(
  current: unknown,
  token: Extract<PathToken, { kind: 'index' }>,
  nextToken: PathToken | undefined,
  node: any,
  isLast: boolean
): unknown {
  if (!Array.isArray(current)) return current;

  if (isLast) {
    const value = nodeValue(node);
    current[token.index] = value === undefined ? makeContainerForNode(node) : value;
    applySchemaMetadata(current[token.index], node, false);
    return current[token.index];
  }

  const existing = current[token.index];
  if (nextToken?.kind === 'index') {
    current[token.index] = Array.isArray(existing) ? existing : [];
  } else {
    current[token.index] = isJsonObject(existing) ? existing : {};
  }

  applySchemaMetadata(current[token.index], node, false);
  return current[token.index];
}

function assignProperty(
  target: JsonObject,
  key: string,
  value: unknown,
  node: any
): void {
  if (!(key in target)) {
    target[key] = value;
    applySchemaMetadata(target[key], node, false);
    return;
  }

  if (isJsonObject(target[key]) && isJsonObject(value)) {
    Object.assign(target[key], value);
    applySchemaMetadata(target[key], node, false);
    return;
  }

  target[key] = Array.isArray(target[key])
    ? [...target[key], value]
    : [target[key], value];
}

function nodeValue(node: any): unknown {
  if (Object.prototype.hasOwnProperty.call(node ?? {}, 'value')) {
    return node.value;
  }

  if (Object.prototype.hasOwnProperty.call(node ?? {}, 'data')) {
    return node.data;
  }

  return undefined;
}

function makeContainerForNode(node: any): unknown {
  if (node?.type === 'array') return [];
  return {};
}

function applySchemaMetadata(value: unknown, node: any, isRoot: boolean): void {
  if (!isJsonObject(value)) return;

  if (isRoot && value['@context'] === undefined) {
    value['@context'] = SCHEMA_CONTEXT;
  }

  const schemaType = firstString(
    node?.meta?.schemaType,
    node?.schemaType,
    node?.itemType,
    node?.typeName
  );
  if (schemaType && value['@type'] === undefined) {
    value['@type'] = schemaType;
  }

  const idRef = firstString(node?.meta?.idRef, node?.idRef, node?.itemId);
  if (idRef && value['@id'] === undefined) {
    value['@id'] = idRef;
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

import chalk from 'chalk';

export interface RenderOptions {
  maxDepth?: number;
  showTypes?: boolean;
  color?: boolean;
  showContext?: boolean;
}

interface RenderState {
  lines: string[];
  maxDepth: number;
  showTypes: boolean;
  color: boolean;
  showContext: boolean;
  seen: WeakMap<object, string>;
}

export class TextReporter {
  public renderCliTree(rootEntity: any, options: RenderOptions = {}): void {
    console.log(this.renderTree(rootEntity, options));
  }

  public renderTree(rootEntity: any, options: RenderOptions = {}): string {
    const state: RenderState = {
      lines: [],
      maxDepth: options.maxDepth ?? Infinity,
      showTypes: options.showTypes ?? true,
      color: options.color ?? true,
      showContext: options.showContext ?? false,
      seen: new WeakMap<object, string>(),
    };

    const rootType = schemaTypeLabel(rootEntity) ?? 'Unknown';
    state.lines.push(this.color(state, 'cyan', `Resolved Schema Tree (Root: ${rootType})`));
    this.renderNode(rootEntity, '', true, 0, '$', state);

    return state.lines.join('\n');
  }

  private renderNode(
    node: any,
    prefix: string,
    isLast: boolean,
    currentDepth: number,
    path: string,
    state: RenderState,
    label?: string
  ): void {
    if (currentDepth > state.maxDepth) {
      state.lines.push(`${prefix}${branch(isLast)}${this.color(state, 'gray', '...')}`);
      return;
    }

    if (isExplicitRef(node)) {
      state.lines.push(
        `${prefix}${branch(isLast)}${label ? `${label}: ` : ''}${this.color(state, 'yellow', `\u2192 ref: ${String(node.$ref)}`)}`
      );
      return;
    }

    if (isPrimitive(node)) {
      const scalar = this.color(state, 'green', JSON.stringify(node));
      state.lines.push(`${prefix}${branch(isLast)}${label ? `${label}: ` : ''}${scalar}`);
      return;
    }

    const previousPath = state.seen.get(node);
    if (previousPath) {
      state.lines.push(
        `${prefix}${branch(isLast)}${label ? `${label}: ` : ''}${this.color(state, 'yellow', `\u21bb circular pointer: ${previousPath}`)}`
      );
      return;
    }

    state.seen.set(node, path);

    if (Array.isArray(node)) {
      this.renderArray(node, prefix, isLast, currentDepth, path, state, label);
      return;
    }

    this.renderObject(node, prefix, isLast, currentDepth, path, state, label);
  }

  private renderArray(
    node: any[],
    prefix: string,
    isLast: boolean,
    currentDepth: number,
    path: string,
    state: RenderState,
    label?: string
  ): void {
    if (label) {
      state.lines.push(`${prefix}${branch(isLast)}${label}`);
      prefix += childPrefix(isLast);
    }

    node.forEach((item, index) => {
      const isLastItem = index === node.length - 1;
      const marker = this.formatArrayIndex(index, item, state);

      if (isPrimitive(item) || isExplicitRef(item)) {
        this.renderNode(item, prefix, isLastItem, currentDepth + 1, `${path}[${index}]`, state, marker);
        return;
      }

      state.lines.push(`${prefix}${branch(isLastItem)}${marker}`);
      const nextPrefix = prefix + childPrefix(isLastItem);
      this.renderNode(item, nextPrefix, true, currentDepth + 1, `${path}[${index}]`, state);
    });
  }

  private renderObject(
    node: Record<string, unknown>,
    prefix: string,
    isLast: boolean,
    currentDepth: number,
    path: string,
    state: RenderState,
    label?: string
  ): void {
    if (label) {
      state.lines.push(`${prefix}${branch(isLast)}${label}`);
      prefix += childPrefix(isLast);
    }

    const keys = Object.keys(node).filter(key => state.showContext || key !== '@context');

    keys.forEach((key, index) => {
      const isLastKey = index === keys.length - 1;
      const value = node[key];
      const childLabel = this.formatPropertyLabel(key, value, state);

      if (isPrimitive(value) || isExplicitRef(value)) {
        this.renderNode(value, prefix, isLastKey, currentDepth + 1, `${path}.${key}`, state, childLabel);
        return;
      }

      state.lines.push(`${prefix}${branch(isLastKey)}${childLabel}`);
      const nextPrefix = prefix + childPrefix(isLastKey);
      this.renderNode(value, nextPrefix, true, currentDepth + 1, `${path}.${key}`, state);
    });
  }

  private formatPropertyLabel(key: string, value: unknown, state: RenderState): string {
    let label = this.color(state, 'white', key);
    const valueType = schemaTypeLabel(value);

    if (state.showTypes && valueType) {
      label += ` ${this.color(state, 'blue', `[${valueType}]`)}`;
    }

    return label;
  }

  private formatArrayIndex(index: number, value: unknown, state: RenderState): string {
    let label = this.color(state, 'magenta', `[${index}]`);
    const valueType = schemaTypeLabel(value);

    if (state.showTypes && valueType) {
      label += ` ${this.color(state, 'blue', `[${valueType}]`)}`;
    }

    return label;
  }

  private color(
    state: RenderState,
    colorName: 'blue' | 'cyan' | 'gray' | 'green' | 'magenta' | 'white' | 'yellow',
    value: string
  ): string {
    return state.color ? chalk[colorName](value) : value;
  }
}

function branch(isLast: boolean): string {
  return isLast ? '\u2514\u2500\u2500 ' : '\u251c\u2500\u2500 ';
}

function childPrefix(isLast: boolean): string {
  return isLast ? '    ' : '\u2502   ';
}

function isPrimitive(value: unknown): boolean {
  return value === null || value === undefined || typeof value !== 'object';
}

function isExplicitRef(value: unknown): value is { $ref: unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.prototype.hasOwnProperty.call(value, '$ref')
  );
}

function schemaTypeLabel(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;

  const schemaType = (value as Record<string, unknown>)['@type'];
  if (typeof schemaType === 'string') return schemaType;
  if (Array.isArray(schemaType) && schemaType.length > 0) {
    return schemaType.map(String).join(', ');
  }

  return undefined;
}

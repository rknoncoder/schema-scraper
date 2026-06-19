#!/usr/bin/env ts-node
import fs from 'node:fs';
import path from 'node:path';
import {
  processRawPayload,
  scrapeJsonLdInput,
  scrapeSchema,
  TextReporter,
  verifyGraphResolutionHealth,
  type AuditActionResult,
  type GraphResolutionHealthReport,
  type ScrapeResult,
  type ScrapeRenderMode,
} from './src';
import {
  buildGraphEntityMap,
  consolidateGraphEntities,
  resolveGraph,
  selectBestRootIndex,
  selectUnlinkedRootEntities,
  type GraphEntity,
} from './src';
import chalk from 'chalk';

type ExportFormat = 'json' | 'html';

interface CliOptions {
  url?: string;
  compact: boolean;
  format?: ExportFormat;
  graphReady: boolean;
  jsonLd?: string;
  jsonLdFile?: string;
  output?: string;
  renderMode?: ScrapeRenderMode;
  stdin: boolean;
  tree: boolean;
}

interface ResolvedAuditReport {
  url: string;
  finalUrl?: string;
  generatedAt: string;
  entitiesForGraphResolver: GraphEntity[];
  resolvedEntities: GraphEntity[];
  detectedSyntaxErrors: AuditActionResult['detectedSyntaxErrors'];
  primaryRoot: GraphEntity | null;
  orphanRoots: GraphEntity[];
  health: GraphResolutionHealthReport | null;
}

async function main(argv = process.argv): Promise<void> {
  const options = parseArgs(argv.slice(2));

  if (!options.url && !hasJsonLdInput(options)) {
    console.error('Please pass --url <url>, --jsonld-file <path>, --jsonld <code>, or --stdin.');
    process.exitCode = 1;
    return;
  }

  try {
    const extractedData = await loadScrapeInput(options);

    if (options.output || options.format) {
      const report = buildResolvedAuditReport(extractedData);
      const format = options.format ?? inferFormatFromOutput(options.output) ?? 'json';
      const content = format === 'html'
        ? renderHtmlReport(report)
        : JSON.stringify(report, null, options.compact ? 0 : 2);

      if (options.output) {
        writeOutputFile(options.output, content);
        console.log(`Exported ${format.toUpperCase()} schema report: ${options.output}`);
      } else {
        console.log(content);
      }

      return;
    }

    if (options.tree) {
      const report = buildResolvedAuditReport(extractedData);

      if (!report.primaryRoot) {
        console.log('No schema entities found.');
        return;
      }

      const reporter = new TextReporter();
      console.log(chalk.bold.green('\n======================================================='));
      console.log(chalk.bold.green('PRIMARY SEMANTIC ENTITY TREE'));
      console.log(chalk.bold.green('======================================================='));
      reporter.renderCliTree(report.primaryRoot, { showTypes: true });

      if (report.orphanRoots.length > 0) {
        console.log(chalk.bold.yellow('\n======================================================='));
        console.log(chalk.bold.yellow('UNLINKED ROOT SCHEMAS DETECTED (POTENTIAL ORPHANS)'));
        console.log(chalk.bold.yellow('======================================================='));

        report.orphanRoots.forEach((orphanTree, index) => {
          console.log(chalk.yellow(`\nOrphan Schema #${index + 1}`));
          reporter.renderCliTree(orphanTree, { showTypes: true });
        });
      }

      verifyGraphResolutionHealth(report.entitiesForGraphResolver, report.primaryRoot);
      return;
    }

    const output = options.graphReady
      ? processRawPayload(extractedData)
      : extractedData;

    console.log(JSON.stringify(output, null, options.compact ? 0 : 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Schema scrape failed.');
    process.exitCode = 1;
  }
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    compact: false,
    graphReady: false,
    stdin: false,
    tree: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--compact') {
      options.compact = true;
      continue;
    }

    if (arg === '--graph-ready') {
      options.graphReady = true;
      continue;
    }

    if (arg === '--stdin') {
      options.stdin = true;
      continue;
    }

    if (arg === '--jsonld-file' || arg === '--input') {
      options.jsonLdFile = args[index + 1];
      index += 1;
      continue;
    }

    if (arg.startsWith('--jsonld-file=')) {
      options.jsonLdFile = arg.slice('--jsonld-file='.length);
      continue;
    }

    if (arg.startsWith('--input=')) {
      options.jsonLdFile = arg.slice('--input='.length);
      continue;
    }

    if (arg === '--jsonld') {
      options.jsonLd = args[index + 1];
      index += 1;
      continue;
    }

    if (arg.startsWith('--jsonld=')) {
      options.jsonLd = arg.slice('--jsonld='.length);
      continue;
    }

    if (arg === '--rendered') {
      options.renderMode = 'rendered';
      continue;
    }

    if (arg === '--dual-pass') {
      options.renderMode = 'dual-pass';
      continue;
    }

    if (arg === '--static') {
      options.renderMode = 'static';
      continue;
    }

    if (arg === '--format') {
      options.format = parseFormat(args[index + 1]);
      index += 1;
      continue;
    }

    if (arg.startsWith('--format=')) {
      options.format = parseFormat(arg.slice('--format='.length));
      continue;
    }

    if (arg === '-o' || arg === '--output') {
      options.output = args[index + 1];
      index += 1;
      continue;
    }

    if (arg.startsWith('--output=')) {
      options.output = arg.slice('--output='.length);
      continue;
    }

    if (arg === '--tree') {
      options.tree = true;
      continue;
    }

    if (arg === '--url') {
      options.url = args[index + 1];
      index += 1;
      continue;
    }

    if (arg.startsWith('--url=')) {
      options.url = arg.slice('--url='.length);
    }
  }

  return options;
}

async function loadScrapeInput(options: CliOptions): Promise<ScrapeResult> {
  if (options.jsonLdFile) {
    const absolutePath = path.resolve(options.jsonLdFile);
    return scrapeJsonLdInput(
      fs.readFileSync(absolutePath, 'utf8'),
      `file://${absolutePath}`
    );
  }

  if (options.stdin) {
    return scrapeJsonLdInput(fs.readFileSync(0, 'utf8'), 'stdin://jsonld');
  }

  if (options.jsonLd) {
    return scrapeJsonLdInput(options.jsonLd, 'inline://jsonld');
  }

  if (!options.url) {
    throw new Error('No input source provided.');
  }

  return scrapeSchema(options.url, {
    renderMode: options.renderMode,
  });
}

function hasJsonLdInput(options: CliOptions): boolean {
  return Boolean(options.jsonLdFile || options.jsonLd || options.stdin);
}

function buildResolvedAuditReport(extractedData: ScrapeResult): ResolvedAuditReport {
  const graphOutput = processRawPayload(extractedData);
  const entities = consolidateGraphEntities(
    graphOutput.entitiesForGraphResolver as GraphEntity[]
  );
  const entityMap = buildGraphEntityMap(entities);
  const resolvedTreeArray = resolveGraph(entities, entityMap);
  const bestRootIndex = selectBestRootIndex(resolvedTreeArray);
  const primaryRoot = bestRootIndex >= 0
    ? resolvedTreeArray[bestRootIndex]
    : null;
  const orphanRoots = bestRootIndex >= 0
    ? selectUnlinkedRootEntities(resolvedTreeArray, bestRootIndex)
    : resolvedTreeArray;
  const health = primaryRoot
    ? verifyGraphResolutionHealth(entities, primaryRoot, { log: false, color: false })
    : null;

  return {
    url: extractedData.url,
    finalUrl: extractedData.finalUrl,
    generatedAt: new Date().toISOString(),
    entitiesForGraphResolver: entities,
    resolvedEntities: resolvedTreeArray,
    detectedSyntaxErrors: graphOutput.detectedSyntaxErrors,
    primaryRoot,
    orphanRoots,
    health,
  };
}

function parseFormat(value: string | undefined): ExportFormat {
  if (value === 'json' || value === 'html') return value;
  throw new Error('Invalid --format. Use "json" or "html".');
}

function inferFormatFromOutput(output: string | undefined): ExportFormat | undefined {
  if (!output) return undefined;

  const extension = path.extname(output).toLowerCase();
  if (extension === '.html' || extension === '.htm') return 'html';
  if (extension === '.json') return 'json';
  return undefined;
}

function writeOutputFile(outputPath: string, content: string): void {
  const directory = path.dirname(outputPath);
  if (directory && directory !== '.') {
    fs.mkdirSync(directory, { recursive: true });
  }

  fs.writeFileSync(outputPath, content, 'utf8');
}

function renderHtmlReport(report: ResolvedAuditReport): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Schema Scraper Interactive Report</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f8fb;
      --panel: #ffffff;
      --border: #d9e2ec;
      --text: #17202a;
      --muted: #5d6b7a;
      --accent: #1f6feb;
      --type-bg: #e6f3ff;
      --type-text: #075985;
      --value: #137333;
      --ref: #b45309;
      --code-bg: #101820;
      --code-text: #eef6ff;
    }
    body {
      margin: 32px;
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    }
    h1, h2, h3 { margin: 0 0 12px; }
    .meta { color: var(--muted); margin: 4px 0; }
    .toolbar { display: flex; gap: 8px; flex-wrap: wrap; margin: 20px 0; }
    button {
      border: 1px solid var(--border);
      background: var(--panel);
      color: var(--text);
      border-radius: 6px;
      padding: 7px 10px;
      cursor: pointer;
    }
    button:hover { border-color: var(--accent); color: var(--accent); }
    section {
      margin: 24px 0;
      padding: 22px;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 8px;
    }
    ul.schema-tree {
      list-style: none;
      margin: 0;
      padding-left: 18px;
    }
    li.tree-node {
      margin: 6px 0;
      line-height: 1.45;
      position: relative;
    }
    .node-row { display: inline-flex; align-items: baseline; gap: 6px; }
    .node-toggle {
      cursor: pointer;
      color: var(--accent);
      user-select: none;
      font-weight: 700;
      width: 18px;
      display: inline-block;
    }
    .node-toggle::before { content: "\\25BE"; }
    .node-toggle.collapsed::before { content: "\\25B8"; }
    .node-spacer { width: 18px; display: inline-block; }
    .node-key { font-weight: 600; color: var(--muted); }
    .node-key-structural {
      color: var(--accent);
      font-style: italic;
      font-weight: 800;
    }
    .node-index {
      background: #faf5ff;
      border: 1px solid #e9d5ff;
      border-radius: 4px;
      color: #8b5cf6;
      font-family: Consolas, "SFMono-Regular", monospace;
      font-size: 0.85rem;
      font-weight: 700;
      padding: 1px 4px;
    }
    .node-type {
      background: var(--type-bg);
      color: var(--type-text);
      border-radius: 4px;
      padding: 1px 6px;
      font-size: 0.84rem;
      font-weight: 700;
    }
    .node-value {
      color: var(--value);
      font-family: Consolas, "SFMono-Regular", monospace;
      overflow-wrap: anywhere;
    }
    .node-ref {
      color: var(--ref);
      font-family: Consolas, "SFMono-Regular", monospace;
      font-weight: 700;
    }
    .source-provenance-badge {
      border-radius: 4px;
      font-size: 0.72rem;
      font-weight: 800;
      margin-left: 6px;
      padding: 1px 6px;
      text-transform: uppercase;
    }
    .source-static { background: #f1f5f9; color: #475569; }
    .source-rendered { background: #fef3c7; color: #b45309; }
    .source-merged { background: #dcfce7; color: #15803d; }
    .source-mixed { background: #e0e7ff; color: #3730a3; }
    .nested-container {
      display: block;
      margin-top: 4px;
      margin-left: 8px;
      padding-left: 14px;
      border-left: 2px dashed #cbd5e1;
    }
    .nested-container.hidden { display: none; }
    .visual-connected-tree ul {
      list-style-type: none;
      margin: 0;
      padding-left: 14px;
      position: relative;
    }
    .visual-connected-tree li {
      margin: 0;
      padding: 6px 0 6px 20px;
      position: relative;
    }
    .visual-connected-tree .nested-container {
      border-left: 0;
      display: block;
      margin-left: 6px;
      margin-top: 4px;
      padding-left: 14px;
      position: relative;
    }
    .visual-connected-tree .nested-container::before {
      border-left: 1px dashed var(--border);
      bottom: 0;
      content: "";
      left: 0;
      position: absolute;
      top: 0;
      width: 1px;
    }
    .visual-connected-tree .nested-container.hidden { display: none; }
    .visual-connected-tree li::before {
      border-top: 1px dashed var(--border);
      content: "";
      height: 1px;
      left: 0;
      position: absolute;
      top: 18px;
      width: 20px;
    }
    .visual-connected-tree li:last-child::after {
      background: var(--panel);
      bottom: 0;
      content: "";
      left: -14px;
      position: absolute;
      top: 18px;
      width: 3px;
    }
    .visual-connected-tree .node-toggle {
      align-items: center;
      display: inline-flex;
      gap: 6px;
      width: auto;
    }
    .schema-link-map {
      background: #fbfdff;
      border: 1px solid var(--border);
      border-radius: 8px;
      min-height: 520px;
      overflow: auto;
      position: relative;
    }
    .schema-link-map::before {
      bottom: 18px;
      color: rgba(255, 153, 124, 0.35);
      content: "Schema Map";
      font-size: 2.1rem;
      left: 24px;
      pointer-events: none;
      position: absolute;
      z-index: 0;
    }
    .schema-link-map svg {
      display: block;
      min-height: 520px;
      position: relative;
      width: 100%;
      z-index: 1;
    }
    .schema-link-map .map-edge {
      stroke: #8ec5e8;
      stroke-width: 1.6;
    }
    .schema-link-map .map-edge-label {
      fill: #64748b;
      font-family: Consolas, "SFMono-Regular", monospace;
      font-size: 12px;
    }
    .schema-link-map .map-node circle {
      stroke: rgba(255,255,255,0.95);
      stroke-width: 3;
    }
    .schema-link-map .map-node text {
      fill: #0f172a;
      font-size: 14px;
      paint-order: stroke;
      stroke: rgba(255,255,255,0.9);
      stroke-width: 4px;
      stroke-linejoin: round;
    }
    .schema-link-map .map-empty {
      color: var(--muted);
      padding: 18px;
    }
    .schema-map-summary {
      color: var(--muted);
      font-size: 0.86rem;
      padding: 12px 14px 0;
      position: relative;
      z-index: 1;
    }
    pre {
      overflow: auto;
      padding: 16px;
      background: var(--code-bg);
      color: var(--code-text);
      border-radius: 6px;
      line-height: 1.45;
    }
    details { margin-top: 12px; }
    summary { cursor: pointer; font-weight: 700; }
    .status { font-weight: 800; }
    .ok { color: #137333; }
    .warn { color: #b06000; }
    .alert-card {
      background: #fff5f5;
      border: 1px solid #feb2b2;
      border-radius: 8px;
      padding: 24px;
      margin-bottom: 24px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }
    .alert-title {
      color: #9b2c2c;
      font-weight: 700;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .error-log {
      font-family: Consolas, "SFMono-Regular", monospace;
      background: #2d3748;
      color: #fff;
      padding: 12px;
      border-radius: 6px;
      overflow-x: auto;
      margin: 8px 0;
      white-space: pre-wrap;
    }
    .fix-suggestion {
      color: #c53030;
      font-size: 0.9rem;
      font-weight: 600;
      margin-top: 4px;
    }
  </style>
</head>
<body>
  <h1>Schema Scraper Interactive Report</h1>
  <p class="meta"><strong>URL:</strong> ${escapeHtml(report.url)}</p>
  <p class="meta"><strong>Final URL:</strong> ${escapeHtml(report.finalUrl ?? report.url)}</p>
  <p class="meta"><strong>Generated:</strong> ${escapeHtml(report.generatedAt)}</p>

  <div class="toolbar">
    <button type="button" id="expand-all">Expand all</button>
    <button type="button" id="collapse-all">Collapse all</button>
  </div>

  <div id="diagnostic-panel"></div>

  <section>
    <h2>Schema Relationship Map</h2>
    <p class="meta">Node-link visualization of schema objects and the properties connecting them.</p>
    <div id="schema-link-map-root" class="schema-link-map"></div>
  </section>

  <section>
    <h2>Primary Semantic Entity Tree</h2>
    <div id="primary-tree-root"></div>
  </section>

  <section>
    <h2>Unlinked Root Schemas</h2>
    <div id="orphan-tree-root"></div>
  </section>

  <section>
    <h2>Complete Resolved Graph Forest</h2>
    <p class="meta">Every top-level entity found on the page, with known in-page references expanded.</p>
    <div id="resolved-forest-root"></div>
  </section>

  <section>
    <h2>Graph Structural Tree View</h2>
    <p class="meta">Alternative visualization mapping nested properties with parent-child connection lines.</p>
    <div id="visual-tree-root" class="visual-connected-tree"></div>
  </section>

  <section>
    <h2>Syntax Errors</h2>
    <pre>${escapeHtml(JSON.stringify(report.detectedSyntaxErrors, null, 2))}</pre>
  </section>

  <section>
    <h2>Graph Health</h2>
    <p class="status ${report.health?.status === 'success' ? 'ok' : 'warn'}">${escapeHtml(report.health?.status ?? 'not-run')}</p>
    <pre>${escapeHtml(JSON.stringify(report.health, null, 2))}</pre>
  </section>

  <section>
    <h2>Graph-Ready Entities</h2>
    <details>
      <summary>Show raw graph-ready JSON</summary>
      <pre>${escapeHtml(JSON.stringify(report.entitiesForGraphResolver, null, 2))}</pre>
    </details>
  </section>
  <script>
    const reportData = ${escapeScriptJson(report)};

    function appendText(parent, className, text) {
      const span = document.createElement('span');
      span.className = className;
      span.textContent = text;
      parent.appendChild(span);
      return span;
    }

    function isArrayIndex(key) {
      return /^\\[\\d+\\]$/.test(key);
    }

    function keyClassName(key) {
      if (isArrayIndex(key)) return 'node-index';
      return key === '@type' || key === '@id' || key === '@context'
        ? 'node-key node-key-structural'
        : 'node-key';
    }

    function appendTypeBadge(parent, value) {
      if (!value || typeof value !== 'object' || Array.isArray(value) || !value['@type']) return;
      const type = Array.isArray(value['@type']) ? value['@type'].join(', ') : String(value['@type']);
      appendText(parent, 'node-type', type);
    }

    function appendSourceBadge(parent, meta) {
      if (!meta || !meta.sourceMode) return;
      const span = document.createElement('span');
      span.className = 'source-provenance-badge source-' + meta.sourceMode;
      span.textContent = meta.sourceMode + (meta.extractionChannel ? ' / ' + meta.extractionChannel : '');
      parent.appendChild(span);
    }

    function metaForValue(value, parentMeta) {
      if (value && typeof value === 'object' && !Array.isArray(value) && value._meta) {
        return value._meta;
      }

      return parentMeta;
    }

    function visibleObjectKeys(value) {
      return Object.keys(value).filter(key => key !== '@context' && key !== '_meta');
    }

    function createPrimitiveArrayRow(index, value) {
      const li = document.createElement('li');
      li.className = 'tree-node';
      appendText(li, 'node-index', '[' + index + ']:');
      appendText(li, 'node-value', ' ' + JSON.stringify(value));
      return li;
    }

    function createPropertyRow(key, value, parentMeta = null) {
      const li = document.createElement('li');
      li.className = 'tree-node';
      const currentMeta = metaForValue(value, parentMeta);

      if (value && typeof value === 'object' && !Array.isArray(value) && '$ref' in value) {
        appendText(li, keyClassName(key), key + ':');
        appendText(li, 'node-ref', ' -> ref: ' + value.$ref);
        return li;
      }

      if (!value || typeof value !== 'object') {
        appendText(li, keyClassName(key), key + ':');
        appendText(li, 'node-value', ' ' + JSON.stringify(value));
        if (key === '@type') appendSourceBadge(li, currentMeta);
        return li;
      }

      const toggle = document.createElement('span');
      toggle.className = 'node-toggle';
      appendText(toggle, keyClassName(key), key);
      appendTypeBadge(toggle, value);
      appendSourceBadge(toggle, currentMeta);
      li.appendChild(toggle);
      const childContainer = document.createElement('div');
      childContainer.className = 'nested-container';
      li.appendChild(childContainer);

      toggle.addEventListener('click', event => {
        event.stopPropagation();
        toggle.classList.toggle('collapsed');
        childContainer.classList.toggle('hidden');
      });

      if (Array.isArray(value)) {
        value.forEach((item, index) => {
          if (item !== null && typeof item === 'object') {
            childContainer.appendChild(createPropertyRow('[' + index + ']', item, currentMeta));
            return;
          }

          childContainer.appendChild(createPrimitiveArrayRow(index, item));
        });
      } else {
        visibleObjectKeys(value).forEach(key => {
          childContainer.appendChild(createPropertyRow(key, value[key], currentMeta));
        });
      }

      return li;
    }

    function renderEntityTree(rootEntity, container) {
      container.textContent = '';
      if (!rootEntity) {
        const p = document.createElement('p');
        p.className = 'meta';
        p.textContent = 'No entity data present.';
        container.appendChild(p);
        return;
      }

      const ul = document.createElement('ul');
      ul.className = 'schema-tree';
      const rootMeta = rootEntity && rootEntity._meta ? rootEntity._meta : null;
      visibleObjectKeys(rootEntity).forEach(key => {
        ul.appendChild(createPropertyRow(key, rootEntity[key], rootMeta));
      });
      container.appendChild(ul);
    }

    function renderOrphans(values, container) {
      container.textContent = '';
      if (!values || values.length === 0) {
        const p = document.createElement('p');
        p.className = 'meta';
        p.textContent = 'No orphan schemas detected.';
        container.appendChild(p);
        return;
      }

      values.forEach((orphan, index) => {
        const h3 = document.createElement('h3');
        h3.style.margin = '20px 0 8px 0';
        h3.style.color = 'var(--accent)';
        h3.textContent = 'Orphan Schema #' + (index + 1) + ' (' + (orphan['@type'] || 'Unknown') + ')';
        container.appendChild(h3);
        const wrapper = document.createElement('div');
        container.appendChild(wrapper);
        renderEntityTree(orphan, wrapper);
      });
    }

    function renderResolvedForest(values, container) {
      container.textContent = '';
      if (!values || values.length === 0) {
        const p = document.createElement('p');
        p.className = 'meta';
        p.textContent = 'No resolved entities present.';
        container.appendChild(p);
        return;
      }

      values.forEach((entity, index) => {
        const h3 = document.createElement('h3');
        h3.style.margin = '20px 0 8px 0';
        h3.style.color = 'var(--accent)';
        h3.textContent = 'Resolved Entity #' + (index + 1) + ' (' + (entity['@type'] || 'Unknown') + ')';
        container.appendChild(h3);
        const wrapper = document.createElement('div');
        container.appendChild(wrapper);
        renderEntityTree(entity, wrapper);
      });
    }

    function renderSchemaRelationshipMap(rootEntity, container) {
      container.textContent = '';
      if (!rootEntity || typeof rootEntity !== 'object') {
        const p = document.createElement('p');
        p.className = 'map-empty';
        p.textContent = 'No schema relationship data present.';
        container.appendChild(p);
        return;
      }

      const graph = buildRelationshipGraph(rootEntity, 90);
      if (graph.nodes.length === 0) {
        const p = document.createElement('p');
        p.className = 'map-empty';
        p.textContent = 'No schema relationships detected.';
        container.appendChild(p);
        return;
      }

      layoutRelationshipGraph(graph);
      const summary = document.createElement('p');
      summary.className = 'schema-map-summary';
      summary.textContent = graph.nodes.length + ' nodes / ' + graph.links.length + ' links';
      container.appendChild(summary);
      drawRelationshipGraph(graph, container);
    }

    function buildRelationshipGraph(rootEntity, maxNodes) {
      const nodes = [];
      const links = [];
      const seen = new WeakMap();

      function addNode(value, depth) {
        if (seen.has(value)) return seen.get(value);

        const node = {
          id: 'node-' + nodes.length,
          depth,
          label: schemaMapNodeLabel(value),
          type: schemaMapType(value),
          color: schemaMapColor(schemaMapType(value)),
          x: 0,
          y: 0,
        };

        nodes.push(node);
        seen.set(value, node);
        return node;
      }

      function visit(value, depth) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        if (nodes.length >= maxNodes) return null;

        const parentNode = addNode(value, depth);

        visibleObjectKeys(value).forEach(key => {
          if (key.charAt(0) === '@') return;
          const childValue = value[key];

          if (Array.isArray(childValue)) {
            childValue.forEach(item => {
              if (!isRelationshipObject(item) || nodes.length >= maxNodes) return;
              const childNode = visit(item, depth + 1);
              if (childNode) links.push({ source: parentNode, target: childNode, label: key });
            });
            return;
          }

          if (!isRelationshipObject(childValue) || nodes.length >= maxNodes) return;
          const childNode = visit(childValue, depth + 1);
          if (childNode) links.push({ source: parentNode, target: childNode, label: key });
        });

        return parentNode;
      }

      visit(rootEntity, 0);

      return {
        nodes,
        links: dedupeLinks(links),
      };
    }

    function isRelationshipObject(value) {
      return Boolean(
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        !('$ref' in value) &&
        (value['@type'] || value['@id'] || value.name || value.url)
      );
    }

    function dedupeLinks(links) {
      const seen = new Set();
      return links.filter(link => {
        const key = link.source.id + '|' + link.target.id + '|' + link.label;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    function schemaMapType(value) {
      if (!value || typeof value !== 'object') return 'Schema';
      const type = value['@type'];
      if (Array.isArray(type) && type.length > 0) return String(type[0]);
      return typeof type === 'string' && type.length > 0 ? type : 'Schema';
    }

    function schemaMapNodeLabel(value) {
      const type = schemaMapType(value);
      const name = typeof value.name === 'string' && value.name.length > 0
        ? value.name
        : undefined;
      const price = value.price
        ? String(value.price) + (value.priceCurrency ? ' ' + String(value.priceCurrency) : '')
        : undefined;
      const rating = value.ratingValue
        ? 'rating ' + String(value.ratingValue)
        : undefined;
      const suffix = name || price || rating || stringTail(value['@id']) || stringTail(value.url);
      return suffix ? type + ': ' + truncateText(suffix, 42) : type;
    }

    function schemaMapColor(type) {
      if (type === 'Product') return '#d78bd7';
      if (type === 'Offer') return '#ff9b9b';
      if (type === 'Organization') return '#8d5a4b';
      if (type === 'Brand') return '#c7dc8c';
      if (type === 'AggregateRating') return '#ff9b9b';
      if (type === 'VideoObject') return '#9ec5fe';
      if (type === 'ItemList' || type === 'ListItem') return '#86d1bd';
      if (type === 'ImageObject') return '#a7c7e7';
      return '#b8a4e3';
    }

    function stringTail(value) {
      if (typeof value !== 'string' || value.length === 0) return undefined;
      const cleaned = value.replace(/[#/?=&]+/g, '/').split('/').filter(Boolean);
      return cleaned.length > 0 ? cleaned[cleaned.length - 1] : value;
    }

    function truncateText(value, maxLength) {
      const text = String(value);
      return text.length > maxLength ? text.slice(0, maxLength - 1) + '...' : text;
    }

    function layoutRelationshipGraph(graph) {
      const width = 980;
      const height = Math.max(520, 420 + graph.nodes.length * 7);
      const centerX = width / 2;
      const centerY = height / 2;
      const byDepth = new Map();

      graph.width = width;
      graph.height = height;

      graph.nodes.forEach(node => {
        const bucket = byDepth.get(node.depth) || [];
        bucket.push(node);
        byDepth.set(node.depth, bucket);
      });

      graph.nodes.forEach(node => {
        if (node.depth === 0) {
          node.x = centerX;
          node.y = centerY;
          return;
        }

        const bucket = byDepth.get(node.depth) || [node];
        const index = bucket.indexOf(node);
        const radius = Math.min(120 + node.depth * 130, Math.min(width, height) * 0.44);
        const angleStep = (Math.PI * 2) / Math.max(bucket.length, 1);
        const angle = -Math.PI / 2 + angleStep * index + node.depth * 0.28;
        node.x = centerX + Math.cos(angle) * radius;
        node.y = centerY + Math.sin(angle) * radius;
      });
    }

    function drawRelationshipGraph(graph, container) {
      const svg = createSvgElement('svg');
      svg.setAttribute('viewBox', '0 0 ' + graph.width + ' ' + graph.height);
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', 'Schema relationship node map');

      const defs = createSvgElement('defs');
      const marker = createSvgElement('marker');
      marker.setAttribute('id', 'schema-arrow');
      marker.setAttribute('markerWidth', '8');
      marker.setAttribute('markerHeight', '8');
      marker.setAttribute('refX', '7');
      marker.setAttribute('refY', '4');
      marker.setAttribute('orient', 'auto');
      const arrow = createSvgElement('path');
      arrow.setAttribute('d', 'M0,0 L8,4 L0,8 Z');
      arrow.setAttribute('fill', '#8ec5e8');
      marker.appendChild(arrow);
      defs.appendChild(marker);
      svg.appendChild(defs);

      graph.links.forEach(link => drawSchemaLink(svg, link));
      graph.nodes.forEach(node => drawSchemaNode(svg, node));

      container.appendChild(svg);
    }

    function drawSchemaLink(svg, link) {
      const points = shortenLine(link.source.x, link.source.y, link.target.x, link.target.y, 18);
      const line = createSvgElement('line');
      line.setAttribute('class', 'map-edge');
      line.setAttribute('x1', points.x1);
      line.setAttribute('y1', points.y1);
      line.setAttribute('x2', points.x2);
      line.setAttribute('y2', points.y2);
      line.setAttribute('marker-end', 'url(#schema-arrow)');
      svg.appendChild(line);

      const label = createSvgElement('text');
      label.setAttribute('class', 'map-edge-label');
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('x', (points.x1 + points.x2) / 2);
      label.setAttribute('y', (points.y1 + points.y2) / 2 - 6);
      label.textContent = link.label;
      svg.appendChild(label);
    }

    function drawSchemaNode(svg, node) {
      const group = createSvgElement('g');
      group.setAttribute('class', 'map-node');
      group.setAttribute('transform', 'translate(' + node.x + ' ' + node.y + ')');

      const circle = createSvgElement('circle');
      circle.setAttribute('r', node.depth === 0 ? '12' : '10');
      circle.setAttribute('fill', node.color);
      group.appendChild(circle);

      const title = createSvgElement('title');
      title.textContent = node.label;
      group.appendChild(title);

      const text = createSvgElement('text');
      text.setAttribute('x', '14');
      text.setAttribute('y', '5');
      text.textContent = node.label;
      group.appendChild(text);

      svg.appendChild(group);
    }

    function shortenLine(x1, y1, x2, y2, padding) {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const length = Math.sqrt(dx * dx + dy * dy) || 1;
      const ox = dx / length * padding;
      const oy = dy / length * padding;

      return {
        x1: x1 + ox,
        y1: y1 + oy,
        x2: x2 - ox,
        y2: y2 - oy,
      };
    }

    function createSvgElement(name) {
      return document.createElementNS('http://www.w3.org/2000/svg', name);
    }

    function renderDiagnostics(errors, container) {
      container.textContent = '';

      if (!errors || errors.length === 0) {
        const successBox = document.createElement('section');
        successBox.style.borderColor = '#c6f6d5';
        successBox.style.background = '#f0fff4';
        const title = document.createElement('h2');
        title.style.color = '#22543d';
        title.style.margin = '0';
        title.textContent = 'Schema Syntax Status: Passed (No Syntax Errors)';
        successBox.appendChild(title);
        container.appendChild(successBox);
        return;
      }

      const alertCard = document.createElement('div');
      alertCard.className = 'alert-card';

      const title = document.createElement('h2');
      title.className = 'alert-title';
      title.textContent = 'Critical Syntax Errors Detected (' + errors.length + ')';
      alertCard.appendChild(title);

      const description = document.createElement('p');
      description.className = 'meta';
      description.style.color = '#742a2a';
      description.textContent = 'Strict parsers and Googlebot may drop these specific structured-data blocks completely during crawls.';
      alertCard.appendChild(description);

      errors.forEach(error => {
        const item = document.createElement('div');
        item.style.marginTop = '16px';
        item.style.borderTop = '1px solid #fed7d7';
        item.style.paddingTop = '12px';

        const typeRow = document.createElement('p');
        typeRow.style.margin = '0 0 6px';
        appendText(typeRow, 'node-key', 'Type: ');
        appendText(typeRow, 'node-type', error.type || 'UNKNOWN');
        item.appendChild(typeRow);

        const messageRow = document.createElement('p');
        messageRow.style.margin = '0 0 8px';
        appendText(messageRow, 'node-key', 'Message: ');
        const message = document.createElement('span');
        message.textContent = error.message || 'No parser message provided.';
        messageRow.appendChild(message);
        item.appendChild(messageRow);

        const snippet = document.createElement('div');
        snippet.className = 'error-log';
        snippet.textContent = error.snippet || '';
        item.appendChild(snippet);

        const fix = document.createElement('div');
        fix.className = 'fix-suggestion';
        fix.textContent = 'Recommendation: ' + (error.suggestedFix || 'Review the structured-data block syntax.');
        item.appendChild(fix);

        alertCard.appendChild(item);
      });

      container.appendChild(alertCard);
    }

    function setCollapsed(collapsed) {
      document.querySelectorAll('.node-toggle').forEach(toggle => {
        toggle.classList.toggle('collapsed', collapsed);
      });
      document.querySelectorAll('.nested-container').forEach(container => {
        container.classList.toggle('hidden', collapsed);
      });
    }

    renderDiagnostics(reportData.detectedSyntaxErrors, document.getElementById('diagnostic-panel'));
    renderEntityTree(reportData.primaryRoot, document.getElementById('primary-tree-root'));
    renderOrphans(reportData.orphanRoots, document.getElementById('orphan-tree-root'));
    renderResolvedForest(reportData.resolvedEntities, document.getElementById('resolved-forest-root'));
    renderSchemaRelationshipMap(reportData.primaryRoot, document.getElementById('schema-link-map-root'));
    renderResolvedForest(reportData.resolvedEntities, document.getElementById('visual-tree-root'));
    document.getElementById('expand-all').addEventListener('click', () => setCollapsed(false));
    document.getElementById('collapse-all').addEventListener('click', () => setCollapsed(true));
  </script>
</body>
</html>`;
}

function escapeScriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

if (require.main === module) {
  void main();
}

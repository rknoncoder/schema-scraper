#!/usr/bin/env ts-node
import fs from 'node:fs';
import path from 'node:path';
import {
  auditSchemaQuality,
  processRawPayload,
  scrapeJsonLdInput,
  scrapeSchema,
  TextReporter,
  verifyGraphResolutionHealth,
  type AuditActionResult,
  type GraphResolutionHealthReport,
  type QualityWarning,
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
  rawEntitiesForGraphResolver: GraphEntity[];
  entitiesForGraphResolver: GraphEntity[];
  resolvedEntities: GraphEntity[];
  scrapeWarnings: string[];
  detectedSyntaxErrors: AuditActionResult['detectedSyntaxErrors'];
  qualityWarnings: QualityWarning[];
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
  const rawEntities = graphOutput.entitiesForGraphResolver as GraphEntity[];
  const entities = consolidateGraphEntities(
    rawEntities
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
  const qualityWarnings = auditSchemaQuality(entities);

  return {
    url: extractedData.url,
    finalUrl: extractedData.finalUrl,
    generatedAt: new Date().toISOString(),
    rawEntitiesForGraphResolver: rawEntities,
    entitiesForGraphResolver: entities,
    resolvedEntities: resolvedTreeArray,
    scrapeWarnings: extractedData.warnings ?? [],
    detectedSyntaxErrors: graphOutput.detectedSyntaxErrors,
    qualityWarnings,
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
    .report-tabs {
      border-bottom: 1px solid var(--border);
      display: flex;
      gap: 6px;
      margin: 24px 0 18px;
    }
    .report-tab {
      border-bottom-left-radius: 0;
      border-bottom-right-radius: 0;
      font-weight: 700;
      margin-bottom: -1px;
    }
    .report-tab.active {
      border-color: var(--accent);
      border-bottom-color: var(--panel);
      color: var(--accent);
    }
    .tab-panel { display: none; }
    .tab-panel.active { display: block; }
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
    .map-toolbar {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 14px 0;
    }
    .map-mode.active {
      border-color: var(--accent);
      color: var(--accent);
      font-weight: 800;
    }
    .zoom-label {
      color: var(--muted);
      font-family: Consolas, "SFMono-Regular", monospace;
      font-size: 0.9rem;
      min-width: 58px;
      text-align: center;
    }
    .schema-link-map {
      background: #fbfdff;
      border: 1px solid var(--border);
      border-radius: 8px;
      display: flex;
      flex-direction: column;
      height: 72vh;
      min-height: 560px;
      overflow: hidden;
      position: relative;
    }
    .schema-link-map.dragging,
    .schema-link-map.dragging * {
      cursor: grabbing;
      user-select: none;
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
      height: auto;
      position: relative;
      width: auto;
      z-index: 1;
    }
    .schema-link-map-viewport {
      flex: 1;
      height: 100%;
      overflow: auto;
      position: relative;
      cursor: grab;
      z-index: 1;
    }
    .schema-link-map-canvas {
      min-height: 100%;
      min-width: 100%;
      transform-origin: 0 0;
      transition: transform 120ms ease-out;
      width: max-content;
    }
    .schema-link-map .map-edge {
      stroke: #8ec5e8;
      stroke-width: 1.6;
      stroke-dasharray: 420;
      stroke-dashoffset: 420;
      animation: draw-map-edge 520ms ease-out forwards;
    }
    .schema-link-map .map-edge-label {
      fill: #64748b;
      font-family: Consolas, "SFMono-Regular", monospace;
      font-size: 12px;
      opacity: 0;
      animation: fade-map-label 260ms ease-out 220ms forwards;
      transition: font-size 120ms ease-out;
    }
    .schema-link-map .map-node {
      cursor: pointer;
      opacity: 0;
      animation: pop-map-node 260ms ease-out forwards;
    }
    .schema-link-map .map-node circle {
      stroke: rgba(255,255,255,0.95);
      stroke-width: 3;
      transition: filter 140ms ease-out, stroke-width 140ms ease-out;
    }
    .schema-link-map .map-node:hover circle,
    .schema-link-map .map-node.selected circle {
      filter: drop-shadow(0 4px 8px rgba(15,23,42,0.22));
      stroke-width: 5;
    }
    .schema-link-map .map-node text {
      fill: #0f172a;
      font-size: 14px;
      paint-order: stroke;
      stroke: rgba(255,255,255,0.9);
      stroke-width: 4px;
      stroke-linejoin: round;
      transition: font-size 120ms ease-out;
    }
    .schema-link-map.zoomed-in .map-edge-label {
      font-size: 14px;
    }
    .schema-link-map.zoomed-in .map-node text {
      font-size: 16px;
    }
    .schema-map-detail {
      background: #f8fafc;
      border: 1px solid var(--border);
      border-radius: 8px;
      margin-top: 14px;
      padding: 14px;
    }
    .schema-map-detail.hidden { display: none; }
    .schema-map-detail h3 {
      color: var(--accent);
      margin-bottom: 8px;
    }
    .schema-map-detail dl {
      display: grid;
      gap: 6px 12px;
      grid-template-columns: max-content minmax(0, 1fr);
      margin: 0;
    }
    .schema-map-detail dt {
      color: var(--muted);
      font-weight: 700;
    }
    .schema-map-detail dd {
      font-family: Consolas, "SFMono-Regular", monospace;
      margin: 0;
      overflow-wrap: anywhere;
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
    @keyframes draw-map-edge {
      to { stroke-dashoffset: 0; }
    }
    @keyframes fade-map-label {
      to { opacity: 1; }
    }
    @keyframes pop-map-node {
      from { opacity: 0; }
      to { opacity: 1; }
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

  <nav class="report-tabs" role="tablist" aria-label="Report views">
    <button type="button" class="report-tab active" data-tab="health" role="tab" aria-selected="true">Health Diagnostics</button>
    <button type="button" class="report-tab" data-tab="semantic" role="tab" aria-selected="false">Semantic Graph</button>
    <button type="button" class="report-tab" data-tab="map" role="tab" aria-selected="false">Relationship Map</button>
  </nav>

  <div id="tab-panel-health" class="tab-panel active" role="tabpanel">
    <div id="diagnostic-panel"></div>
    <div id="scrape-warning-panel"></div>
    <div id="quality-panel"></div>

    <section>
      <h2>Syntax Errors</h2>
      <pre>${escapeHtml(JSON.stringify(report.detectedSyntaxErrors, null, 2))}</pre>
    </section>

    <section>
      <h2>Graph Health</h2>
      <p class="status ${report.health?.status === 'success' ? 'ok' : 'warn'}">${escapeHtml(report.health?.status ?? 'not-run')}</p>
      <pre>${escapeHtml(JSON.stringify(report.health, null, 2))}</pre>
    </section>
  </div>

  <div id="tab-panel-semantic" class="tab-panel" role="tabpanel">
    <div class="toolbar">
      <button type="button" id="expand-all">Expand all</button>
      <button type="button" id="collapse-all">Collapse all</button>
    </div>

    <section>
      <h2>Primary Semantic Entity Tree</h2>
      <div id="primary-tree-root" class="visual-connected-tree"></div>
    </section>

    <section>
      <h2>Unlinked Root Schemas</h2>
      <div id="orphan-tree-root" class="visual-connected-tree"></div>
    </section>

    <section>
      <h2>Complete Resolved Graph Forest</h2>
      <p class="meta">Every top-level entity found on the page, with known in-page references expanded.</p>
      <div id="resolved-forest-root" class="visual-connected-tree"></div>
    </section>

    <section>
      <h2>Raw Extracted Schema Array View</h2>
      <p class="meta">Browser-like indexed view of every schema entity before dedupe and graph consolidation.</p>
      <div id="visual-tree-root" class="visual-connected-tree"></div>
    </section>

    <section>
      <h2>Graph-Ready Entities</h2>
      <details>
        <summary>Show consolidated graph-ready JSON</summary>
        <pre>${escapeHtml(JSON.stringify(report.entitiesForGraphResolver, null, 2))}</pre>
      </details>
      <details>
        <summary>Show raw pre-dedupe graph-ready JSON</summary>
        <pre>${escapeHtml(JSON.stringify(report.rawEntitiesForGraphResolver, null, 2))}</pre>
      </details>
    </section>
  </div>

  <div id="tab-panel-map" class="tab-panel" role="tabpanel">
    <section>
      <h2>Schema Relationship Map</h2>
      <p class="meta">Node-link visualization of schema objects and the properties connecting them.</p>
      <div class="map-toolbar">
        <button type="button" id="schema-map-full" class="map-mode active">Full graph</button>
        <button type="button" id="schema-map-primary" class="map-mode">Primary graph</button>
        <button type="button" id="schema-map-zoom-out">Zoom out</button>
        <span id="schema-map-zoom-label" class="zoom-label">100%</span>
        <button type="button" id="schema-map-zoom-in">Zoom in</button>
        <button type="button" id="schema-map-zoom-reset">Reset</button>
      </div>
      <div id="schema-link-map-root" class="schema-link-map"></div>
      <div id="schema-map-detail" class="schema-map-detail hidden"></div>
    </section>
  </div>
  <script>
    const reportData = ${escapeScriptJson(report)};
    const mapZoomState = { value: 1 };
    const mapViewState = { mode: 'full' };

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

    function createPropertyRow(key, value, parentMeta = null, collapsed = false) {
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
      toggle.className = collapsed ? 'node-toggle collapsed' : 'node-toggle';
      appendText(toggle, keyClassName(key), key);
      appendTypeBadge(toggle, value);
      appendSourceBadge(toggle, currentMeta);
      li.appendChild(toggle);
      const childContainer = document.createElement('div');
      childContainer.className = collapsed ? 'nested-container hidden' : 'nested-container';
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

    function renderRawSchemaArray(values, container) {
      container.textContent = '';
      if (!values || values.length === 0) {
        const p = document.createElement('p');
        p.className = 'meta';
        p.textContent = 'No raw schema entities present.';
        container.appendChild(p);
        return;
      }

      const summary = document.createElement('p');
      summary.className = 'meta';
      summary.textContent = 'Array(' + values.length + ')';
      container.appendChild(summary);

      const ul = document.createElement('ul');
      ul.className = 'schema-tree';
      values.forEach((entity, index) => {
        const meta = entity && entity._meta ? entity._meta : null;
        ul.appendChild(createPropertyRow('[' + index + ']', entity, meta, true));
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

    function renderSchemaRelationshipMap(rootInput, container, scopeLabel) {
      container.textContent = '';
      clearSchemaMapNodeDetail();
      const roots = normalizeRelationshipRoots(rootInput);
      if (roots.length === 0) {
        const p = document.createElement('p');
        p.className = 'map-empty';
        p.textContent = 'No schema relationship data present.';
        container.appendChild(p);
        return;
      }

      const graph = buildRelationshipGraph(roots, 180);
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
      summary.textContent = scopeLabel + ': ' + graph.nodes.length + ' nodes / ' + graph.links.length + ' links';
      container.appendChild(summary);

      const viewport = document.createElement('div');
      viewport.className = 'schema-link-map-viewport';
      const canvas = document.createElement('div');
      canvas.id = 'schema-link-map-zoom-layer';
      canvas.className = 'schema-link-map-canvas';
      canvas.dataset.baseWidth = String(graph.width);
      canvas.dataset.baseHeight = String(graph.height);
      viewport.appendChild(canvas);
      container.appendChild(viewport);

      drawRelationshipGraph(graph, canvas);
      setSchemaMapZoom(1);
      bindSchemaMapGestures(viewport);
    }

    function normalizeRelationshipRoots(rootInput) {
      if (Array.isArray(rootInput)) {
        return rootInput.filter(value => value && typeof value === 'object' && !Array.isArray(value));
      }

      return rootInput && typeof rootInput === 'object' ? [rootInput] : [];
    }

    function buildRelationshipGraph(rootEntities, maxNodes) {
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
          details: schemaMapNodeDetails(value),
          x: 0,
          y: 0,
        };

        nodes.push(node);
        seen.set(value, node);
        return node;
      }

      function addVirtualForestNode() {
        const node = {
          id: 'node-' + nodes.length,
          depth: 0,
          label: 'Resolved Schema Forest',
          type: 'Graph',
          color: schemaMapColor('Graph'),
          details: [
            { key: 'nodes', value: String(rootEntities.length) },
          ],
          x: 0,
          y: 0,
        };
        nodes.push(node);
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

      if (rootEntities.length === 1) {
        visit(rootEntities[0], 0);
      } else {
        const forestNode = addVirtualForestNode();
        rootEntities.forEach((rootEntity, index) => {
          if (nodes.length >= maxNodes) return;
          const rootNode = visit(rootEntity, 1);
          if (rootNode) {
            links.push({
              source: forestNode,
              target: rootNode,
              label: 'root ' + (index + 1),
            });
          }
        });
      }

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

    function schemaMapNodeDetails(value) {
      if (!value || typeof value !== 'object') return [];
      const details = [];
      addSchemaMapDetail(details, 'type', schemaMapType(value));
      addSchemaMapDetail(details, 'name', value.name);
      addSchemaMapDetail(details, '@id', value['@id']);
      addSchemaMapDetail(details, 'url', value.url);
      addSchemaMapDetail(details, 'sku', value.sku);
      addSchemaMapDetail(details, 'gtin', value.gtin || value.gtin8 || value.gtin12 || value.gtin13 || value.gtin14);

      if (value._meta) {
        addSchemaMapDetail(details, 'source', value._meta.sourceMode);
        addSchemaMapDetail(details, 'channel', value._meta.extractionChannel);
      }

      return details;
    }

    function addSchemaMapDetail(details, key, value) {
      if (value === undefined || value === null || value === '') return;
      details.push({
        key,
        value: Array.isArray(value) ? value.join(', ') : String(value),
      });
    }

    function schemaMapColor(type) {
      if (type === 'Graph') return '#334155';
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
      svg.setAttribute('width', graph.width);
      svg.setAttribute('height', graph.height);
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
      group.setAttribute('tabindex', '0');
      group.setAttribute('role', 'button');
      group.setAttribute('aria-label', node.label);
      group.style.animationDelay = Math.min(node.depth * 45, 360) + 'ms';

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

      group.addEventListener('click', event => {
        event.stopPropagation();
        renderSchemaMapNodeDetail(node, group);
      });

      group.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        renderSchemaMapNodeDetail(node, group);
      });

      svg.appendChild(group);
    }

    function renderSchemaMapNodeDetail(node, selectedGroup) {
      document.querySelectorAll('.map-node.selected').forEach(element => {
        element.classList.remove('selected');
      });
      selectedGroup.classList.add('selected');

      const panel = document.getElementById('schema-map-detail');
      if (!panel) return;

      panel.textContent = '';
      panel.classList.remove('hidden');

      const title = document.createElement('h3');
      title.textContent = node.label;
      panel.appendChild(title);

      const list = document.createElement('dl');
      (node.details || []).forEach(detail => {
        const term = document.createElement('dt');
        term.textContent = detail.key;
        const description = document.createElement('dd');
        description.textContent = detail.value;
        list.appendChild(term);
        list.appendChild(description);
      });

      panel.appendChild(list);
    }

    function clearSchemaMapNodeDetail() {
      const panel = document.getElementById('schema-map-detail');
      if (!panel) return;
      panel.textContent = '';
      panel.classList.add('hidden');
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

    function renderScrapeWarnings(warnings, container) {
      container.textContent = '';
      if (!warnings || warnings.length === 0) return;

      const warningCard = document.createElement('div');
      warningCard.className = 'alert-card';
      warningCard.style.background = '#fff7ed';
      warningCard.style.borderColor = '#fed7aa';

      const title = document.createElement('h2');
      title.className = 'alert-title';
      title.style.color = '#9a3412';
      title.textContent = 'Scrape Warnings (' + warnings.length + ')';
      warningCard.appendChild(title);

      warnings.forEach(warning => {
        const p = document.createElement('p');
        p.className = 'meta';
        p.style.color = '#9a3412';
        p.textContent = warning;
        warningCard.appendChild(p);
      });

      container.appendChild(warningCard);
    }

    function renderQualityWarnings(warnings, container) {
      container.textContent = '';

      if (!warnings || warnings.length === 0) {
        const successBox = document.createElement('section');
        successBox.style.borderColor = '#bfdbfe';
        successBox.style.background = '#eff6ff';
        const title = document.createElement('h2');
        title.style.color = '#1d4ed8';
        title.style.margin = '0';
        title.textContent = 'Semantic Sanity Warnings: None';
        successBox.appendChild(title);
        container.appendChild(successBox);
        return;
      }

      const warningCard = document.createElement('div');
      warningCard.className = 'alert-card';
      warningCard.style.background = '#fffbeb';
      warningCard.style.borderColor = '#fde68a';

      const title = document.createElement('h2');
      title.className = 'alert-title';
      title.style.color = '#92400e';
      title.textContent = 'Semantic Sanity Warnings (' + warnings.length + ')';
      warningCard.appendChild(title);

      warnings.forEach(warning => {
        const item = document.createElement('div');
        item.style.marginTop = '12px';
        item.style.borderTop = '1px solid #fde68a';
        item.style.paddingTop = '10px';

        const summary = document.createElement('p');
        summary.style.margin = '0 0 4px';
        appendText(summary, 'node-key', warning.entityType + '.' + warning.property + ': ');
        const message = document.createElement('span');
        message.textContent = warning.message;
        summary.appendChild(message);
        item.appendChild(summary);

        warningCard.appendChild(item);
      });

      container.appendChild(warningCard);
    }

    function setActiveReportTab(tabName) {
      document.querySelectorAll('.report-tab').forEach(tab => {
        const isActive = tab.dataset.tab === tabName;
        tab.classList.toggle('active', isActive);
        tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });

      document.querySelectorAll('.tab-panel').forEach(panel => {
        panel.classList.toggle('active', panel.id === 'tab-panel-' + tabName);
      });
    }

    function setSchemaMapZoom(value, focusPoint) {
      const nextZoom = Math.min(2.5, Math.max(0.35, value));
      const zoomLayer = document.getElementById('schema-link-map-zoom-layer');
      const zoomLabel = document.getElementById('schema-map-zoom-label');
      const viewport = document.querySelector('.schema-link-map-viewport');
      const mapRoot = document.getElementById('schema-link-map-root');
      mapZoomState.value = nextZoom;

      if (zoomLayer) {
        zoomLayer.style.transform = 'scale(' + nextZoom + ')';
        const baseWidth = Number(zoomLayer.dataset.baseWidth || 0);
        const baseHeight = Number(zoomLayer.dataset.baseHeight || 0);
        if (baseWidth > 0) zoomLayer.style.width = Math.ceil(baseWidth * nextZoom) + 'px';
        if (baseHeight > 0) zoomLayer.style.height = Math.ceil(baseHeight * nextZoom) + 'px';
      }

      if (viewport && focusPoint) {
        viewport.scrollLeft = focusPoint.contentX * nextZoom - focusPoint.viewportX;
        viewport.scrollTop = focusPoint.contentY * nextZoom - focusPoint.viewportY;
      }

      if (mapRoot) {
        mapRoot.classList.toggle('zoomed-in', nextZoom >= 1.25);
      }

      if (zoomLabel) {
        zoomLabel.textContent = Math.round(nextZoom * 100) + '%';
      }
    }

    function adjustSchemaMapZoom(delta) {
      setSchemaMapZoom(mapZoomState.value + delta, schemaMapViewportCenterFocus());
    }

    function resetSchemaMapView() {
      const viewport = document.querySelector('.schema-link-map-viewport');
      setSchemaMapZoom(1);
      if (viewport) {
        viewport.scrollLeft = 0;
        viewport.scrollTop = 0;
      }
    }

    function schemaMapViewportCenterFocus() {
      const viewport = document.querySelector('.schema-link-map-viewport');
      if (!viewport) return undefined;
      const viewportX = viewport.clientWidth / 2;
      const viewportY = viewport.clientHeight / 2;

      return {
        viewportX,
        viewportY,
        contentX: (viewport.scrollLeft + viewportX) / mapZoomState.value,
        contentY: (viewport.scrollTop + viewportY) / mapZoomState.value,
      };
    }

    function bindSchemaMapGestures(viewport) {
      const panState = {
        active: false,
        startX: 0,
        startY: 0,
        scrollLeft: 0,
        scrollTop: 0,
      };

      viewport.addEventListener('wheel', event => {
        event.preventDefault();
        const rect = viewport.getBoundingClientRect();
        const viewportX = event.clientX - rect.left;
        const viewportY = event.clientY - rect.top;
        const focusPoint = {
          viewportX,
          viewportY,
          contentX: (viewport.scrollLeft + viewportX) / mapZoomState.value,
          contentY: (viewport.scrollTop + viewportY) / mapZoomState.value,
        };
        const zoomFactor = event.deltaY < 0 ? 1.12 : 0.88;
        setSchemaMapZoom(mapZoomState.value * zoomFactor, focusPoint);
      }, { passive: false });

      viewport.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        panState.active = true;
        panState.startX = event.clientX;
        panState.startY = event.clientY;
        panState.scrollLeft = viewport.scrollLeft;
        panState.scrollTop = viewport.scrollTop;
        viewport.setPointerCapture(event.pointerId);
        const mapRoot = document.getElementById('schema-link-map-root');
        if (mapRoot) mapRoot.classList.add('dragging');
      });

      viewport.addEventListener('pointermove', event => {
        if (!panState.active) return;
        viewport.scrollLeft = panState.scrollLeft - (event.clientX - panState.startX);
        viewport.scrollTop = panState.scrollTop - (event.clientY - panState.startY);
      });

      viewport.addEventListener('pointerup', event => {
        if (!panState.active) return;
        panState.active = false;
        viewport.releasePointerCapture(event.pointerId);
        const mapRoot = document.getElementById('schema-link-map-root');
        if (mapRoot) mapRoot.classList.remove('dragging');
      });

      viewport.addEventListener('pointercancel', () => {
        panState.active = false;
        const mapRoot = document.getElementById('schema-link-map-root');
        if (mapRoot) mapRoot.classList.remove('dragging');
      });
    }

    function renderCurrentSchemaMap() {
      const container = document.getElementById('schema-link-map-root');
      const isPrimary = mapViewState.mode === 'primary';
      renderSchemaRelationshipMap(
        isPrimary ? reportData.primaryRoot : reportData.resolvedEntities,
        container,
        isPrimary ? 'Primary graph' : 'Full graph'
      );
    }

    function setSchemaMapMode(mode) {
      mapViewState.mode = mode;
      document.querySelectorAll('.map-mode').forEach(button => {
        button.classList.toggle('active', button.id === 'schema-map-' + mode);
      });
      renderCurrentSchemaMap();
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
    renderScrapeWarnings(reportData.scrapeWarnings, document.getElementById('scrape-warning-panel'));
    renderQualityWarnings(reportData.qualityWarnings, document.getElementById('quality-panel'));
    renderEntityTree(reportData.primaryRoot, document.getElementById('primary-tree-root'));
    renderOrphans(reportData.orphanRoots, document.getElementById('orphan-tree-root'));
    renderResolvedForest(reportData.resolvedEntities, document.getElementById('resolved-forest-root'));
    renderCurrentSchemaMap();
    renderRawSchemaArray(reportData.rawEntitiesForGraphResolver, document.getElementById('visual-tree-root'));
    document.querySelectorAll('.report-tab').forEach(tab => {
      tab.addEventListener('click', () => setActiveReportTab(tab.dataset.tab));
    });
    document.getElementById('expand-all').addEventListener('click', () => setCollapsed(false));
    document.getElementById('collapse-all').addEventListener('click', () => setCollapsed(true));
    document.getElementById('schema-map-full').addEventListener('click', () => setSchemaMapMode('full'));
    document.getElementById('schema-map-primary').addEventListener('click', () => setSchemaMapMode('primary'));
    document.getElementById('schema-map-zoom-out').addEventListener('click', () => adjustSchemaMapZoom(-0.15));
    document.getElementById('schema-map-zoom-in').addEventListener('click', () => adjustSchemaMapZoom(0.15));
    document.getElementById('schema-map-zoom-reset').addEventListener('click', () => resetSchemaMapView());
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

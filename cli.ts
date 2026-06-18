#!/usr/bin/env ts-node
import fs from 'node:fs';
import path from 'node:path';
import {
  processRawPayload,
  scrapeSchema,
  TextReporter,
  verifyGraphResolutionHealth,
  type AuditActionResult,
  type GraphResolutionHealthReport,
  type ScrapeResult,
} from './src';
import {
  buildGraphEntityMap,
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
  output?: string;
  tree: boolean;
}

interface ResolvedAuditReport {
  url: string;
  finalUrl?: string;
  generatedAt: string;
  entitiesForGraphResolver: GraphEntity[];
  detectedSyntaxErrors: AuditActionResult['detectedSyntaxErrors'];
  primaryRoot: GraphEntity | null;
  orphanRoots: GraphEntity[];
  health: GraphResolutionHealthReport | null;
}

async function main(argv = process.argv): Promise<void> {
  const options = parseArgs(argv.slice(2));

  if (!options.url) {
    console.error('Please pass --url <url>.');
    process.exitCode = 1;
    return;
  }

  try {
    const extractedData = await scrapeSchema(options.url);

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

function buildResolvedAuditReport(extractedData: ScrapeResult): ResolvedAuditReport {
  const graphOutput = processRawPayload(extractedData);
  const entities = graphOutput.entitiesForGraphResolver as GraphEntity[];
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
    .node-key { font-weight: 650; color: #334155; }
    .node-index { font-weight: 650; color: #8b5cf6; font-family: Consolas, "SFMono-Regular", monospace; }
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
    .nested-container {
      display: block;
      margin-top: 4px;
      margin-left: 8px;
      padding-left: 14px;
      border-left: 2px dashed #cbd5e1;
    }
    .nested-container.hidden { display: none; }
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
    <h2>Primary Semantic Entity Tree</h2>
    <div id="primary-tree-root"></div>
  </section>

  <section>
    <h2>Unlinked Root Schemas</h2>
    <div id="orphan-tree-root"></div>
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
      return isArrayIndex(key) ? 'node-index' : 'node-key';
    }

    function appendTypeBadge(parent, value) {
      if (!value || typeof value !== 'object' || Array.isArray(value) || !value['@type']) return;
      const type = Array.isArray(value['@type']) ? value['@type'].join(', ') : String(value['@type']);
      appendText(parent, 'node-type', type);
    }

    function createPropertyRow(key, value) {
      const li = document.createElement('li');
      li.className = 'tree-node';

      if (value && typeof value === 'object' && !Array.isArray(value) && '$ref' in value) {
        appendText(li, keyClassName(key), key + ':');
        appendText(li, 'node-ref', ' → ref: ' + value.$ref);
        return li;
      }

      if (!value || typeof value !== 'object') {
        appendText(li, keyClassName(key), key + ':');
        appendText(li, 'node-value', ' ' + JSON.stringify(value));
        return li;
      }

      const toggle = document.createElement('span');
      toggle.className = 'node-toggle';
      appendText(toggle, keyClassName(key), key);
      appendTypeBadge(toggle, value);
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
          childContainer.appendChild(createPropertyRow('[' + index + ']', item));
        });
      } else {
        Object.keys(value).forEach(key => {
          if (key === '@context') return;
          childContainer.appendChild(createPropertyRow(key, value[key]));
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
      Object.keys(rootEntity).forEach(key => {
        if (key === '@context') return;
        ul.appendChild(createPropertyRow(key, rootEntity[key]));
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

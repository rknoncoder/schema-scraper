#!/usr/bin/env ts-node
import fs from 'node:fs';
import path from 'node:path';
import {
  auditSchemaQuality,
  auditSchemaArchitecture,
  auditFormatMigration,
  processRawPayload,
  scrapeJsonLdInput,
  scrapeSchema,
  TextReporter,
  verifyGraphResolutionHealth,
  type AuditActionResult,
  type GoogleAuditResult,
  type ScrapeResult,
  type ScrapeRenderMode,
} from './src';
import {
  buildGraphEntityMap,
  consolidateGraphEntities,
  resolveGraph,
  selectBestRootIndex,
  selectUnlinkedRootEntities,
  auditGoogleEligibility,
  type GraphEntity,
} from './src';
import { renderHtmlReport, type ResolvedAuditReport } from './src/reporter/htmlReport';
import {
  buildRawJsonLdBlockMap,
  DEFAULT_RAW_MAP_MAX_NODES,
} from './src/reporter/rawJsonLdBlockMap';
import chalk from 'chalk';

export { renderHtmlReport, type ResolvedAuditReport };

type ExportFormat = 'json' | 'html';

interface CliOptions {
  configFile?: string;
  url?: string;
  urls: string[];
  urlFile?: string;
  compact: boolean;
  concurrency: number;
  deepRender: boolean;
  format?: ExportFormat;
  graphReady: boolean;
  googleRichResults: boolean;
  includeRawMap: boolean;
  jsonLd?: string;
  jsonLdFile?: string;
  output?: string;
  outputDir?: string;
  rawMapMaxNodes: number;
  renderMode?: ScrapeRenderMode;
  stdin: boolean;
  timeoutMs?: number;
  tree: boolean;
}

interface SchemaScraperConfig {
  url?: string;
  urls?: string[];
  urlFile?: string;
  output?: string;
  outputDir?: string;
  format?: ExportFormat;
  renderMode?: ScrapeRenderMode;
  deepRender?: boolean;
  timeoutMs?: number;
  compact?: boolean;
  graphReady?: boolean;
  googleRichResults?: boolean;
  includeRawMap?: boolean;
  rawMapMaxNodes?: number;
  tree?: boolean;
  concurrency?: number;
}

interface BatchAuditResult {
  url: string;
  status: 'success' | 'failed';
  output?: string;
  finalUrl?: string;
  schemaCount?: number;
  jsonLdBlockCount?: number;
  resolvedEntityCount?: number;
  syntaxErrorCount?: number;
  scrapeWarningCount?: number;
  error?: string;
}

async function main(argv = process.argv): Promise<void> {
  let options: CliOptions;

  try {
    options = loadCliOptions(argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Invalid CLI configuration.');
    process.exitCode = 1;
    return;
  }

  if (hasBatchInput(options)) {
    try {
      await runBatchAudits(options);
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'Batch schema audit failed.');
      process.exitCode = 1;
    }
    return;
  }

  if (!options.url && !hasJsonLdInput(options)) {
    console.error('Please pass --url <url>, --url-file <path>, --jsonld-file <path>, --jsonld <code>, or --stdin.');
    process.exitCode = 1;
    return;
  }

  try {
    const extractedData = await loadScrapeInput(options);

    if (options.output || options.format) {
      const report = buildResolvedAuditReport(extractedData, {
        includeGoogleRichResults: options.googleRichResults,
        includeRawMap: options.includeRawMap,
        rawMapMaxNodes: options.rawMapMaxNodes,
      });
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

    const output = buildStdoutPayload(extractedData, options);

    console.log(JSON.stringify(output, null, options.compact ? 0 : 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Schema scrape failed.');
    process.exitCode = 1;
  }
}

function loadCliOptions(args: string[]): CliOptions {
  const configFile = findConfigPath(args);
  const config = configFile ? readConfigFile(configFile) : {};
  return parseArgs(args, optionsFromConfig(config, configFile));
}

function parseArgs(args: string[], initialOptions = createDefaultOptions()): CliOptions {
  const options: CliOptions = {
    ...initialOptions,
    urls: [...initialOptions.urls],
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--config') {
      options.configFile = args[index + 1];
      index += 1;
      continue;
    }

    if (arg.startsWith('--config=')) {
      options.configFile = arg.slice('--config='.length);
      continue;
    }

    if (arg === '--url-file') {
      options.urlFile = args[index + 1];
      index += 1;
      continue;
    }

    if (arg.startsWith('--url-file=')) {
      options.urlFile = arg.slice('--url-file='.length);
      continue;
    }

    if (arg === '--output-dir') {
      options.outputDir = args[index + 1];
      index += 1;
      continue;
    }

    if (arg.startsWith('--output-dir=')) {
      options.outputDir = arg.slice('--output-dir='.length);
      continue;
    }

    if (arg === '--concurrency') {
      options.concurrency = parsePositiveInteger(args[index + 1], 'concurrency');
      index += 1;
      continue;
    }

    if (arg.startsWith('--concurrency=')) {
      options.concurrency = parsePositiveInteger(arg.slice('--concurrency='.length), 'concurrency');
      continue;
    }

    if (arg === '--url') {
      options.url = args[index + 1];
      index += 1;
      continue;
    }

    if (arg.startsWith('--url=')) {
      options.url = arg.slice('--url='.length);
      continue;
    }

    parseStandardArg(args, index, options);
    if (arg === '--jsonld-file' || arg === '--input' || arg === '--jsonld' || arg === '--timeout' || arg === '--format' || arg === '-o' || arg === '--output' || arg === '--raw-map-max-nodes') {
      index += 1;
    }
  }

  return options;
}

function createDefaultOptions(): CliOptions {
  return {
    compact: false,
    concurrency: 1,
    deepRender: false,
    graphReady: false,
    googleRichResults: false,
    includeRawMap: true,
    rawMapMaxNodes: DEFAULT_RAW_MAP_MAX_NODES,
    stdin: false,
    tree: false,
    urls: [],
  };
}

function parseStandardArg(args: string[], index: number, options: CliOptions): void {
  const arg = args[index];

  if (arg === '--compact') {
    options.compact = true;
    return;
  }

  if (arg === '--graph-ready') {
    options.graphReady = true;
    return;
  }

  if (arg === '--google-rich-results' || arg === '--include-google-rich-results') {
    options.googleRichResults = true;
    return;
  }

  if (arg === '--include-raw-map') {
    options.includeRawMap = true;
    return;
  }

  if (arg === '--no-raw-map') {
    options.includeRawMap = false;
    return;
  }

  if (arg === '--stdin') {
    options.stdin = true;
    return;
  }

  if (arg === '--jsonld-file' || arg === '--input') {
    options.jsonLdFile = args[index + 1];
    return;
  }

  if (arg.startsWith('--jsonld-file=')) {
    options.jsonLdFile = arg.slice('--jsonld-file='.length);
    return;
  }

  if (arg.startsWith('--input=')) {
    options.jsonLdFile = arg.slice('--input='.length);
    return;
  }

  if (arg === '--jsonld') {
    options.jsonLd = args[index + 1];
    return;
  }

  if (arg.startsWith('--jsonld=')) {
    options.jsonLd = arg.slice('--jsonld='.length);
    return;
  }

  if (arg === '--rendered') {
    options.renderMode = 'rendered';
    return;
  }

  if (arg === '--dual-pass') {
    options.renderMode = 'dual-pass';
    return;
  }

  if (arg === '--deep-render') {
    options.deepRender = true;
    return;
  }

  if (arg === '--timeout') {
    options.timeoutMs = parseTimeout(args[index + 1]);
    return;
  }

  if (arg.startsWith('--timeout=')) {
    options.timeoutMs = parseTimeout(arg.slice('--timeout='.length));
    return;
  }

  if (arg === '--raw-map-max-nodes') {
    options.rawMapMaxNodes = parsePositiveInteger(args[index + 1], 'raw-map-max-nodes');
    return;
  }

  if (arg.startsWith('--raw-map-max-nodes=')) {
    options.rawMapMaxNodes = parsePositiveInteger(arg.slice('--raw-map-max-nodes='.length), 'raw-map-max-nodes');
    return;
  }

  if (arg === '--static') {
    options.renderMode = 'static';
    return;
  }

  if (arg === '--format') {
    options.format = parseFormat(args[index + 1]);
    return;
  }

  if (arg.startsWith('--format=')) {
    options.format = parseFormat(arg.slice('--format='.length));
    return;
  }

  if (arg === '-o' || arg === '--output') {
    options.output = args[index + 1];
    return;
  }

  if (arg.startsWith('--output=')) {
    options.output = arg.slice('--output='.length);
    return;
  }

  if (arg === '--tree') {
    options.tree = true;
  }
}

function optionsFromConfig(config: SchemaScraperConfig, configFile?: string): CliOptions {
  const options: CliOptions = {
    configFile,
    compact: false,
    concurrency: 1,
    deepRender: false,
    graphReady: false,
    googleRichResults: false,
    includeRawMap: true,
    rawMapMaxNodes: DEFAULT_RAW_MAP_MAX_NODES,
    stdin: false,
    tree: false,
    urls: [],
  };

  if (typeof config.url === 'string') options.url = config.url;
  if (Array.isArray(config.urls)) {
    options.urls = config.urls.filter((url): url is string => typeof url === 'string');
  }
  if (typeof config.urlFile === 'string') options.urlFile = config.urlFile;
  if (typeof config.output === 'string') options.output = config.output;
  if (typeof config.outputDir === 'string') options.outputDir = config.outputDir;
  if (config.format) options.format = parseFormat(config.format);
  if (config.renderMode) options.renderMode = parseRenderMode(config.renderMode);
  if (typeof config.deepRender === 'boolean') options.deepRender = config.deepRender;
  if (typeof config.timeoutMs === 'number') options.timeoutMs = parsePositiveInteger(String(config.timeoutMs), 'timeoutMs');
  if (typeof config.compact === 'boolean') options.compact = config.compact;
  if (typeof config.graphReady === 'boolean') options.graphReady = config.graphReady;
  if (typeof config.googleRichResults === 'boolean') options.googleRichResults = config.googleRichResults;
  if (typeof config.includeRawMap === 'boolean') options.includeRawMap = config.includeRawMap;
  if (typeof config.rawMapMaxNodes === 'number') options.rawMapMaxNodes = parsePositiveInteger(String(config.rawMapMaxNodes), 'rawMapMaxNodes');
  if (typeof config.tree === 'boolean') options.tree = config.tree;
  if (typeof config.concurrency === 'number') options.concurrency = parsePositiveInteger(String(config.concurrency), 'concurrency');

  return options;
}

function findConfigPath(args: string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--config') return args[index + 1];
    if (arg.startsWith('--config=')) return arg.slice('--config='.length);
  }

  const defaultConfigPath = path.resolve('schema-scraper.config.json');
  return fs.existsSync(defaultConfigPath) ? defaultConfigPath : undefined;
}

function readConfigFile(configPath: string): SchemaScraperConfig {
  const absolutePath = path.resolve(configPath);
  const parsed = JSON.parse(fs.readFileSync(absolutePath, 'utf8')) as unknown;

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Config file must contain a JSON object: ${absolutePath}`);
  }

  return parsed as SchemaScraperConfig;
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
    deepRender: options.deepRender,
    renderMode: options.renderMode,
    timeoutMs: options.timeoutMs,
  });
}

function hasJsonLdInput(options: CliOptions): boolean {
  return Boolean(options.jsonLdFile || options.jsonLd || options.stdin);
}

function hasBatchInput(options: CliOptions): boolean {
  return Boolean(options.urlFile || options.urls.length > 0);
}

async function runBatchAudits(options: CliOptions): Promise<void> {
  if (hasJsonLdInput(options)) {
    throw new Error('Batch mode cannot be combined with JSON-LD file, inline JSON-LD, or stdin input.');
  }

  if (options.tree || options.graphReady) {
    throw new Error('Batch mode writes report files; do not combine it with --tree or --graph-ready.');
  }

  if (options.output) {
    throw new Error('Batch mode writes multiple files. Use --output-dir instead of --output.');
  }

  const urls = collectBatchUrls(options);
  if (urls.length === 0) {
    throw new Error('Batch mode did not find any URLs to audit.');
  }

  const format = options.format ?? 'html';
  const outputDir = path.resolve(options.outputDir ?? `reports-${timestampForPath(new Date())}`);
  fs.mkdirSync(outputDir, { recursive: true });

  const results: BatchAuditResult[] = new Array(urls.length);
  let nextIndex = 0;
  const workerCount = Math.min(options.concurrency, urls.length);

  async function worker(): Promise<void> {
    while (nextIndex < urls.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await auditBatchUrl(urls[index], index, outputDir, format, options);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, worker));

  const summary = {
    generatedAt: new Date().toISOString(),
    outputDir,
    format,
    total: results.length,
    succeeded: results.filter(result => result.status === 'success').length,
    failed: results.filter(result => result.status === 'failed').length,
    results,
  };

  writeOutputFile(
    path.join(outputDir, 'batch-report.json'),
    JSON.stringify(summary, null, options.compact ? 0 : 2)
  );

  const failedUrls = results
    .filter(result => result.status === 'failed')
    .map(result => result.url);
  if (failedUrls.length > 0) {
    writeOutputFile(path.join(outputDir, 'failed-urls.txt'), `${failedUrls.join('\n')}\n`);
    process.exitCode = 1;
  }

  console.log(`Batch audit complete: ${summary.succeeded}/${summary.total} succeeded.`);
  console.log(`Reports written to: ${outputDir}`);
}

async function auditBatchUrl(
  url: string,
  index: number,
  outputDir: string,
  format: ExportFormat,
  options: CliOptions
): Promise<BatchAuditResult> {
  const outputPath = path.join(
    outputDir,
    `${String(index + 1).padStart(3, '0')}-${slugifyUrl(url)}.${extensionForFormat(format)}`
  );

  try {
    const extractedData = await scrapeSchema(url, {
      deepRender: options.deepRender,
      renderMode: options.renderMode,
      timeoutMs: options.timeoutMs,
    });
    const report = buildResolvedAuditReport(extractedData, {
      includeGoogleRichResults: options.googleRichResults,
      includeRawMap: options.includeRawMap,
      rawMapMaxNodes: options.rawMapMaxNodes,
    });
    const content = format === 'html'
      ? renderHtmlReport(report)
      : JSON.stringify(report, null, options.compact ? 0 : 2);

    writeOutputFile(outputPath, content);

    return {
      url,
      status: 'success',
      output: outputPath,
      finalUrl: report.finalUrl,
      schemaCount: extractedData.schemas.length,
      jsonLdBlockCount: report.jsonLdDiagnostics?.jsonLdBlockCount ?? 0,
      resolvedEntityCount: report.resolvedEntities.length,
      syntaxErrorCount: report.detectedSyntaxErrors.length,
      scrapeWarningCount: report.scrapeWarnings.length,
    };
  } catch (error) {
    return {
      url,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function collectBatchUrls(options: CliOptions): string[] {
  return uniqueStrings([
    ...options.urls,
    ...(options.url ? [options.url] : []),
    ...(options.urlFile ? readUrlFile(options.urlFile) : []),
  ]);
}

function readUrlFile(urlFile: string): string[] {
  return fs.readFileSync(path.resolve(urlFile), 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'));
}

function slugifyUrl(url: string): string {
  let parsed: URL | undefined;
  try {
    parsed = new URL(url);
  } catch {
    parsed = undefined;
  }

  const base = parsed
    ? `${parsed.hostname}${parsed.pathname}`
    : url;

  const slug = base
    .replace(/^www\./, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

  return slug.slice(0, 90) || 'schema-report';
}

function timestampForPath(date: Date): string {
  return date.toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, '');
}

interface BuildResolvedAuditReportOptions {
  includeGoogleRichResults?: boolean;
  includeRawMap?: boolean;
  rawMapMaxNodes?: number;
}

function buildResolvedAuditReport(
  extractedData: ScrapeResult,
  options: BuildResolvedAuditReportOptions = {}
): ResolvedAuditReport {
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
  const architectureFindings = auditSchemaArchitecture(rawEntities, resolvedTreeArray);
  const formatMigrationFindings = auditFormatMigration(rawEntities);

  const report: ResolvedAuditReport = {
    url: extractedData.url,
    finalUrl: extractedData.finalUrl,
    generatedAt: new Date().toISOString(),
    rawEntitiesForGraphResolver: rawEntities,
    strictGoogleEntities: graphOutput.strictGoogleEntities as GraphEntity[],
    strictGoogleDiscardedCount: graphOutput.detectedSyntaxErrors.length,
    entitiesForGraphResolver: entities,
    resolvedEntities: resolvedTreeArray,
    scrapeWarnings: extractedData.warnings ?? [],
    detectedSyntaxErrors: graphOutput.detectedSyntaxErrors,
    qualityWarnings,
    architectureFindings,
    formatMigrationFindings,
    primaryRoot,
    orphanRoots,
    health,
    staticRenderedDiff: extractedData.staticRenderedDiff ?? null,
    jsonLdDiagnostics: extractedData.jsonLdDiagnostics,
    rawJsonLdBlockMap: options.includeRawMap === false
      ? null
      : buildRawJsonLdBlockMap(extractedData.schemas, {
        maxNodes: options.rawMapMaxNodes,
      }),
  };

  if (options.includeGoogleRichResults) {
    report.googleRichResults = auditGoogleEligibility(resolvedTreeArray);
  }

  return report;
}

function buildStdoutPayload(
  extractedData: ScrapeResult,
  options: CliOptions
): ScrapeResult | AuditActionResult | (Record<string, unknown> & { googleRichResults: GoogleAuditResult[] }) {
  if (!options.googleRichResults) {
    return options.graphReady
      ? processRawPayload(extractedData)
      : extractedData;
  }

  const report = buildResolvedAuditReport(extractedData, {
    includeGoogleRichResults: true,
    includeRawMap: options.includeRawMap,
    rawMapMaxNodes: options.rawMapMaxNodes,
  });
  const basePayload = options.graphReady
    ? processRawPayload(extractedData)
    : extractedData;

  return {
    ...basePayload,
    googleRichResults: report.googleRichResults ?? [],
  };
}

function parseFormat(value: string | undefined): ExportFormat {
  if (value === 'json' || value === 'html') return value;
  throw new Error('Invalid --format. Use "json" or "html".');
}

function parseRenderMode(value: string): ScrapeRenderMode {
  if (value === 'static' || value === 'rendered' || value === 'dual-pass') return value;
  throw new Error('Invalid renderMode in config. Use "static", "rendered", or "dual-pass".');
}

function parseTimeout(value: string | undefined): number {
  return parsePositiveInteger(value, 'timeout');
}

function parsePositiveInteger(value: string | undefined, label: string): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid --${label}. Use a positive integer value.`);
  }

  return parsed;
}

function inferFormatFromOutput(output: string | undefined): ExportFormat | undefined {
  if (!output) return undefined;

  const extension = path.extname(output).toLowerCase();
  if (extension === '.html' || extension === '.htm') return 'html';
  if (extension === '.json') return 'json';
  return undefined;
}

function extensionForFormat(format: ExportFormat): string {
  return format === 'html' ? 'html' : 'json';
}

function writeOutputFile(outputPath: string, content: string): void {
  const directory = path.dirname(outputPath);
  if (directory && directory !== '.') {
    fs.mkdirSync(directory, { recursive: true });
  }

  fs.writeFileSync(outputPath, content, 'utf8');
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

if (require.main === module) {
  void main();
}


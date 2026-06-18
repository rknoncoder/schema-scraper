export {
  extractSchemasFromHtml,
  scrapeSchema,
} from './scraper';
export {
  auditUrl,
  processRawPayload,
  verifyGraphResolutionHealth,
} from './commands/auditAction';
export { TextReporter } from './reporter/textReporter';
export {
  buildGraphEntityMap,
  consolidateGraphEntities,
  resolveGraph,
  resolveNode,
  selectBestRootEntity,
  selectBestRootIndex,
  selectUnlinkedRootEntities,
} from './tree/graphResolver';
export type {
  RawSchemaBlock,
  ScrapeResult,
} from './scraper';
export type {
  AuditActionResult,
  GraphResolutionHealthOptions,
  GraphResolutionHealthReport,
} from './commands/auditAction';
export type { RenderOptions } from './reporter/textReporter';
export type {
  GraphEntity,
  ReferenceNode,
  ResolvedGraphNode,
} from './tree/graphResolver';
export type {
  SchemaSource,
  TreeNode,
} from './tree/treeNode';
export { homogenizeMicrodata } from './utils/homogenizeMicrodata';
export {
  homogenizeAST,
  homogenizeMicrodataAst,
  homogenizeSchemaFormat,
} from './analyzer/formatHomogenizer';
export { validateAndParseJSON } from './analyzer/syntaxValidator';
export type {
  ASTNode,
  SchemaLikeBlock,
} from './analyzer/formatHomogenizer';
export type {
  SyntaxErrorDetail,
  ValidationReport,
} from './analyzer/syntaxValidator';

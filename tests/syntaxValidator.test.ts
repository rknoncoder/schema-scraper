import { describe, expect, it } from 'vitest';
import { extractSchemasFromHtml, validateAndParseJSON } from '../src';

describe('syntax validator', () => {
  it('returns valid parsed data for strict JSON', () => {
    const report = validateAndParseJSON('{ "@type": "Product", "name": "Shoe" }');

    expect(report.status).toBe('valid');
    expect(report.parsedData).toMatchObject({
      '@type': 'Product',
      name: 'Shoe',
    });
    expect(report.error).toBeUndefined();
  });

  it('isolates recoverable trailing comma syntax as a warning', () => {
    const report = validateAndParseJSON('{ "@type": "Product", "name": "Shoe", }');

    expect(report.status).toBe('warning');
    expect(report.parsedData).toMatchObject({
      '@type': 'Product',
      name: 'Shoe',
    });
    expect(report.error).toMatchObject({
      type: 'TRAILING_COMMA',
      suggestedFix: expect.stringContaining('trailing comma'),
    });
  });

  it('recovers raw line breaks inside strings while keeping a warning', () => {
    const report = validateAndParseJSON(`{
      "@type": "Product",
      "description": "Line one
Line two"
    }`);

    expect(report.status).toBe('warning');
    expect(report.parsedData).toMatchObject({
      '@type': 'Product',
      description: 'Line one\nLine two',
    });
    expect(report.error).toMatchObject({
      type: 'RAW_LINE_BREAK',
      suggestedFix: expect.stringContaining('\\n'),
    });
  });

  it('attaches syntax details to extracted JSON-LD blocks before homogenizing', () => {
    const schemas = extractSchemasFromHtml(`
      <script type="application/ld+json">
        { "@type": "Product", "name": "Shoe", }
      </script>
    `);

    expect(schemas).toHaveLength(1);
    expect(schemas[0].source).toBe('json-ld');
    expect(schemas[0].syntaxStatus).toBe('warning');
    expect(schemas[0].syntaxError?.type).toBe('TRAILING_COMMA');
    expect(schemas[0].data).toMatchObject({
      '@type': 'Product',
      name: 'Shoe',
    });
  });
});

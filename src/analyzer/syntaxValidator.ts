import JSON5 from 'json5';

export interface SyntaxErrorDetail {
  type: 'TRAILING_COMMA' | 'UNESCAPED_QUOTE' | 'RAW_LINE_BREAK' | 'MANGLED_JSON';
  message: string;
  snippet: string;
  suggestedFix: string;
}

export interface ValidationReport {
  status: 'valid' | 'warning' | 'critical';
  parsedData: any | null;
  error?: SyntaxErrorDetail;
}

export function validateAndParseJSON(rawText: string): ValidationReport {
  const trimmed = rawText.trim();

  try {
    const validData = JSON.parse(trimmed);
    return {
      status: 'valid',
      parsedData: validData,
    };
  } catch (strictError: any) {
    const message = strictError?.message || 'Invalid JSON.';
    const detail = classifySyntaxError(trimmed, message);

    try {
      return {
        status: 'warning',
        parsedData: JSON5.parse(trimmed),
        error: detail,
      };
    } catch {
      return {
        status: 'critical',
        parsedData: null,
        error: detail,
      };
    }
  }
}

function classifySyntaxError(raw: string, message: string): SyntaxErrorDetail {
  const type = detectSyntaxErrorType(raw);

  return {
    type,
    message,
    snippet: snippetAroundError(raw, message),
    suggestedFix: suggestedFixFor(type),
  };
}

function detectSyntaxErrorType(raw: string): SyntaxErrorDetail['type'] {
  if (hasTrailingComma(raw)) return 'TRAILING_COMMA';
  if (hasRawLineBreakInsideString(raw)) return 'RAW_LINE_BREAK';
  if (hasLikelyUnescapedQuote(raw)) return 'UNESCAPED_QUOTE';
  return 'MANGLED_JSON';
}

function hasTrailingComma(raw: string): boolean {
  return scanOutsideStrings(raw, (char, index) => {
    if (char !== ',') return false;
    const next = nextNonWhitespace(raw, index + 1);
    return next === '}' || next === ']';
  });
}

function hasRawLineBreakInsideString(raw: string): boolean {
  let inString = false;
  let escaped = false;

  for (const char of raw) {
    if (!inString) {
      if (char === '"') inString = true;
      continue;
    }

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = false;
      continue;
    }

    if (char === '\n' || char === '\r') return true;
  }

  return false;
}

function hasLikelyUnescapedQuote(raw: string): boolean {
  let inString = false;
  let escaped = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];

    if (!inString) {
      if (char === '"') inString = true;
      continue;
    }

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (char !== '"') continue;

    const next = nextNonWhitespace(raw, index + 1);
    if (next === undefined || next === ':' || next === ',' || next === '}' || next === ']') {
      inString = false;
      continue;
    }

    return true;
  }

  return false;
}

function scanOutsideStrings(
  raw: string,
  predicate: (char: string, index: number) => boolean
): boolean {
  let inString = false;
  let escaped = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (predicate(char, index)) return true;
  }

  return false;
}

function nextNonWhitespace(raw: string, start: number): string | undefined {
  for (let index = start; index < raw.length; index += 1) {
    if (!/\s/.test(raw[index])) return raw[index];
  }

  return undefined;
}

function snippetAroundError(raw: string, message: string): string {
  const position = parseErrorPosition(message);
  if (position === undefined) return truncate(raw, 200);

  const start = Math.max(0, position - 80);
  const end = Math.min(raw.length, position + 80);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < raw.length ? '...' : '';

  return `${prefix}${raw.slice(start, end)}${suffix}`;
}

function parseErrorPosition(message: string): number | undefined {
  const match = message.match(/\bposition\s+(\d+)\b/);
  if (!match) return undefined;

  const position = Number.parseInt(match[1], 10);
  return Number.isFinite(position) ? position : undefined;
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength
    ? `${value.slice(0, maxLength)}...`
    : value;
}

function suggestedFixFor(type: SyntaxErrorDetail['type']): string {
  switch (type) {
    case 'TRAILING_COMMA':
      return 'Remove the trailing comma preceding the closing object brace or array bracket.';
    case 'UNESCAPED_QUOTE':
      return 'Escape quotation marks inside string values with a backslash.';
    case 'RAW_LINE_BREAK':
      return 'Escape manual row returns inside text values with explicit \\n tokens.';
    case 'MANGLED_JSON':
      return 'Re-verify script output configuration; brackets or key/value structure are broken.';
  }
}

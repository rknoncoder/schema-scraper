const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS ?? 15000);
const MAX_RESPONSE_BYTES = Number(process.env.MAX_RESPONSE_BYTES ?? 5_000_000);

const ACCEPTED_CONTENT_TYPES = [
  'text/html',
  'application/xhtml+xml',
  'application/xml',
  'text/xml',
];

const BROWSER_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'User-Agent': [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    'AppleWebKit/537.36 (KHTML, like Gecko)',
    'Chrome/125.0.0.0 Safari/537.36',
  ].join(' '),
};

export interface FetchResult {
  html: string;
  finalUrl: string;
}

export interface FetchHtmlOptions {
  timeoutMs?: number;
}

export async function fetchHtml(
  url: string,
  options: FetchHtmlOptions = {}
): Promise<FetchResult> {
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: BROWSER_HEADERS,
      redirect: 'follow',
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Fetch failed with HTTP ${response.status}.`);
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!isAcceptedContentType(contentType)) {
      throw new Error(
        `Invalid content type received: ${contentType || 'unknown'}. Aborting parsing to protect memory.`
      );
    }

    const contentLength = response.headers.get('content-length');
    if (contentLength && Number(contentLength) > MAX_RESPONSE_BYTES) {
      throw new Error(
        `Response body is too large (${contentLength} bytes). Maximum allowed is ${MAX_RESPONSE_BYTES} bytes.`
      );
    }

    return {
      html: await readTextWithLimit(response),
      finalUrl: response.url || url,
    };
  } catch (error) {
    throw new Error(`Fetch failed for ${url}: ${fetchErrorMessage(error, timeoutMs)}`, {
      cause: error,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function readTextWithLimit(response: Response): Promise<string> {
  if (!response.body) return response.text();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        throw new Error(
          `Response body exceeded ${MAX_RESPONSE_BYTES} bytes. Aborting parsing to protect memory.`
        );
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const buffer = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(buffer);
}

function isAcceptedContentType(contentType: string): boolean {
  const normalized = contentType.toLowerCase();
  if (normalized.length === 0) return true;
  return ACCEPTED_CONTENT_TYPES.some(type => normalized.includes(type));
}

function fetchErrorMessage(error: unknown, timeoutMs = REQUEST_TIMEOUT_MS): string {
  if (!error || typeof error !== 'object') {
    return String(error);
  }

  const err = error as Error & {
    cause?: {
      code?: string;
      address?: string;
      port?: number;
      message?: string;
    };
  };

  if (err.name === 'AbortError') {
    return `request timed out after ${timeoutMs}ms`;
  }

  const cause = err.cause;
  if (cause?.code) {
    const endpoint = cause.address && cause.port
      ? ` ${cause.address}:${cause.port}`
      : '';
    return `${cause.code}${endpoint}${cause.message ? ` (${cause.message})` : ''}`;
  }

  return err.message || 'unknown network error';
}

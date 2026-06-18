const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS ?? 20000);

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

export async function fetchHtml(url: string): Promise<FetchResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: BROWSER_HEADERS,
      redirect: 'follow',
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Fetch failed with HTTP ${response.status}.`);
    }

    return {
      html: await response.text(),
      finalUrl: response.url || url,
    };
  } catch (error) {
    throw new Error(`Fetch failed for ${url}: ${fetchErrorMessage(error)}`, {
      cause: error,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function fetchErrorMessage(error: unknown): string {
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
    return `request timed out after ${REQUEST_TIMEOUT_MS}ms`;
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

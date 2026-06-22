import type { FetchResult } from './fetcher';

const RENDER_TIMEOUT_MS = Number(process.env.RENDER_TIMEOUT_MS ?? 30000);

interface PuppeteerModule {
  launch(options: Record<string, unknown>): Promise<BrowserLike>;
}

interface BrowserLike {
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
}

interface PageLike {
  content(): Promise<string>;
  evaluate?(pageFunction: (...args: unknown[]) => unknown, ...args: unknown[]): Promise<unknown>;
  goto(url: string, options: Record<string, unknown>): Promise<unknown>;
  setDefaultNavigationTimeout?(timeout: number): void;
  setDefaultTimeout?(timeout: number): void;
  setUserAgent(userAgent: string): Promise<void>;
  waitForTimeout?(timeout: number): Promise<void>;
  waitForNetworkIdle?(options: Record<string, unknown>): Promise<unknown>;
  url(): string;
}

const BROWSER_USER_AGENT = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  'AppleWebKit/537.36 (KHTML, like Gecko)',
  'Chrome/125.0.0.0 Safari/537.36',
].join(' ');

export interface FetchRenderedHtmlOptions {
  timeoutMs?: number;
  deepRender?: boolean;
}

export async function fetchRenderedHtml(
  url: string,
  options: FetchRenderedHtmlOptions = {}
): Promise<FetchResult> {
  const timeoutMs = options.timeoutMs ?? RENDER_TIMEOUT_MS;
  const puppeteer = await loadPuppeteer();
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(BROWSER_USER_AGENT);
    page.setDefaultNavigationTimeout?.(timeoutMs);
    page.setDefaultTimeout?.(timeoutMs);
    await gotoRenderedPage(page, url, timeoutMs);
    if (options.deepRender) {
      await performDeepRender(page, timeoutMs);
    }

    return {
      html: await page.content(),
      finalUrl: page.url() || url,
    };
  } catch (error) {
    throw new Error(`Rendered fetch failed for ${url}: ${renderErrorMessage(error)}`, {
      cause: error,
    });
  } finally {
    await browser.close();
  }
}

async function gotoRenderedPage(
  page: PageLike,
  url: string,
  timeoutMs: number
): Promise<void> {
  try {
    await page.goto(url, {
      waitUntil: 'networkidle0',
      timeout: timeoutMs,
    });
    return;
  } catch (error) {
    if (!isNavigationTimeout(error)) throw error;
  }

  await page.goto(url, {
    waitUntil: 'domcontentloaded',
    timeout: timeoutMs,
  });

  if (page.waitForNetworkIdle) {
    await page.waitForNetworkIdle({
      idleTime: 1000,
      timeout: Math.min(5000, timeoutMs),
      concurrency: 2,
    }).catch(() => undefined);
  }
}

async function performDeepRender(page: PageLike, timeoutMs: number): Promise<void> {
  if (!page.evaluate) return;

  const scrollSteps = 6;
  for (let index = 0; index < scrollSteps; index += 1) {
    await page.evaluate(() => {
      window.scrollBy(0, Math.max(window.innerHeight, 900));
    });
    if (page.waitForTimeout) {
      await page.waitForTimeout(400);
    }
  }

  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });

  if (page.waitForNetworkIdle) {
    await page.waitForNetworkIdle({
      idleTime: 800,
      timeout: Math.min(5000, timeoutMs),
      concurrency: 2,
    }).catch(() => undefined);
  }
}

async function loadPuppeteer(): Promise<PuppeteerModule> {
  try {
    const dynamicImport = new Function('moduleName', 'return import(moduleName)') as (
      moduleName: string
    ) => Promise<unknown>;
    return await dynamicImport('puppeteer') as PuppeteerModule;
  } catch (error) {
    throw new Error(
      'Rendered extraction requires Puppeteer. Install it with: npm install puppeteer --save',
      { cause: error }
    );
  }
}

function renderErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNavigationTimeout(error: unknown): boolean {
  return error instanceof Error && /timeout/i.test(error.message);
}

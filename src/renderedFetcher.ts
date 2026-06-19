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
  goto(url: string, options: Record<string, unknown>): Promise<unknown>;
  setUserAgent(userAgent: string): Promise<void>;
  url(): string;
}

const BROWSER_USER_AGENT = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  'AppleWebKit/537.36 (KHTML, like Gecko)',
  'Chrome/125.0.0.0 Safari/537.36',
].join(' ');

export async function fetchRenderedHtml(url: string): Promise<FetchResult> {
  const puppeteer = await loadPuppeteer();
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(BROWSER_USER_AGENT);
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: RENDER_TIMEOUT_MS,
    });

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

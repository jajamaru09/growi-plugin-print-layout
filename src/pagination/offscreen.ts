import type { CapturedContent } from '../capture';

const ASSET_WAIT_MS = 10000;

const createMeasuringHost = (contentWidthPx: number): HTMLDivElement => {
  const host = document.createElement('div');
  host.style.position = 'absolute';
  host.style.left = '-100000px';
  host.style.top = '0';
  host.style.width = `${contentWidthPx}px`;
  host.style.visibility = 'hidden';
  host.style.pointerEvents = 'none';
  return host;
};

const waitForAssets = async (scope: HTMLElement): Promise<void> => {
  const pending = [
    document.fonts?.ready.catch(() => undefined),
    ...Array.from(scope.querySelectorAll('img')).map((img) => img.decode().catch(() => undefined)),
  ];
  let timer: number | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = window.setTimeout(resolve, ASSET_WAIT_MS);
  });
  await Promise.race([Promise.all(pending), timeout]);
  window.clearTimeout(timer);
};

/**
 * Lays copies of the blocks out off-screen at the printable width, in a box that mirrors the content
 * box of renderPages (same classes, width and flow-root), and hands them to `read` once images and
 * fonts are ready. `content` itself is not touched; the copies are removed afterwards.
 */
export async function withLaidOutClones<T>(
  content: CapturedContent,
  contentWidthPx: number,
  read: (wiki: HTMLElement, clones: HTMLElement[]) => T,
): Promise<T> {
  const host = createMeasuringHost(contentWidthPx);
  const wiki = document.createElement('div');
  wiki.className = content.root.className;
  wiki.classList.add('wiki');
  wiki.style.display = 'flow-root';
  // captureWiki already removed GROWI's edit chrome, so these are the same DOM renderPages prints.
  const clones = content.blocks.map((block) => block.cloneNode(true) as HTMLElement);
  wiki.append(...clones);
  host.appendChild(wiki);
  document.body.appendChild(host);
  try {
    await waitForAssets(wiki);
    return read(wiki, clones);
  } finally {
    host.remove();
  }
}

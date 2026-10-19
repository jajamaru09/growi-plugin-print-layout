// Ported from growi-plugin-drawio-converter (src/exporter/mxgraph.ts, src/dom/diagram-meta.ts).
import { log } from '../log';

export const WRAPPER_SELECTOR = '[class*="drawio-viewer-with-edit-button"]';

const RENDER_TIMEOUT_MS = 15000;

interface DrawioGraph {
  getSvg(
    background: string | null,
    scale: number,
    border: number,
    nocrop: boolean,
    crisp: boolean | null,
    ignoreSelection: boolean,
    showText: boolean,
    imgExport: unknown,
    linkTarget: string | null,
    hasShadow: boolean,
    incExtFonts: boolean,
    keepTheme: boolean,
  ): SVGSVGElement;
}

interface DrawioViewer {
  graph?: DrawioGraph;
}

interface GraphViewerGlobal {
  createViewerForElement(element: Element, callback?: (viewer: DrawioViewer) => void): void;
}

const graphViewer = (): GraphViewerGlobal | undefined =>
  (window as unknown as { GraphViewer?: GraphViewerGlobal }).GraphViewer;

/** Returns the `data-mxgraph` attribute and the mxfile XML inside it, or null. */
export function extractXmlFromWrapper(wrapper: HTMLElement): { attr: string; xml: string } | null {
  const attr = wrapper.querySelector<HTMLElement>('.mxgraph')?.getAttribute('data-mxgraph');
  if (!attr) return null;
  try {
    const parsed = JSON.parse(attr) as { xml?: unknown };
    if (typeof parsed.xml !== 'string' || parsed.xml.length === 0) return null;
    return { attr, xml: parsed.xml };
  } catch (e) {
    log('data-mxgraph parse failed:', e);
    return null;
  }
}

const createOffscreenHost = (mxgraphDataAttr: string): HTMLDivElement => {
  const div = document.createElement('div');
  div.className = 'mxgraph';
  div.setAttribute('data-mxgraph', mxgraphDataAttr);
  div.style.position = 'fixed';
  div.style.left = '-9999px';
  div.style.top = '-9999px';
  div.style.width = '1200px';
  div.style.height = '900px';
  div.style.visibility = 'hidden';
  div.style.pointerEvents = 'none';
  return div;
};

const svgFromViewer = (viewer: DrawioViewer): SVGSVGElement | null => {
  const graph = viewer?.graph;
  if (!graph || typeof graph.getSvg !== 'function') {
    log('renderToSvg: viewer.graph.getSvg is not a function');
    return null;
  }
  return graph.getSvg(null, 1, 0, false, null, true, true, null, null, false, true, false);
};

/**
 * Renders the diagram with a fresh GROWI drawio viewer in an off-screen element
 * and returns its SVG, or null on any failure.
 */
export function renderToSvg(mxgraphDataAttr: string): Promise<SVGSVGElement | null> {
  return new Promise((resolve) => {
    const gv = graphViewer();
    if (!gv) {
      log('renderToSvg: GraphViewer is not loaded');
      resolve(null);
      return;
    }
    const div = createOffscreenHost(mxgraphDataAttr);
    document.body.appendChild(div);

    let settled = false;
    const settle = (svg: SVGSVGElement | null): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      div.remove();
      resolve(svg);
    };
    const timeout = window.setTimeout(() => {
      log(`renderToSvg: timed out waiting for viewer callback (${RENDER_TIMEOUT_MS}ms)`);
      settle(null);
    }, RENDER_TIMEOUT_MS);

    try {
      gv.createViewerForElement(div, (viewer) => {
        if (settled) return;
        try {
          settle(svgFromViewer(viewer));
        } catch (e) {
          log('renderToSvg: getSvg threw:', e);
          settle(null);
        }
      });
    } catch (e) {
      log('renderToSvg: createViewerForElement threw:', e);
      settle(null);
    }
  });
}

/** Default `toStaticSvg` for captureWiki: re-renders the wrapper's diagram as a stable SVG. */
export async function toStaticDrawioSvg(wrapper: HTMLElement): Promise<SVGSVGElement | null> {
  const extracted = extractXmlFromWrapper(wrapper);
  if (!extracted) return null;
  return renderToSvg(extracted.attr);
}

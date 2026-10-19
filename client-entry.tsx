import { createRoot, type Root } from 'react-dom/client';
import { MOUNT_ID, PLUGIN_ID } from './src/constants';
import { PrintLayoutEditor } from './src/editor/PrintLayoutEditor';
import type { PluginRegistration } from './src/hub-types';
import { removePrintStyle } from './src/print';

let editorRoot: Root | null = null;
let openPageId: string | null = null;

export function registerToHub(plugin: PluginRegistration): void {
  const hub = (window as any).growiPluginHub;
  if (hub?.register) {
    hub.register(plugin);
  } else {
    (window as any).growiPluginHub ??= { _queue: [] };
    (window as any).growiPluginHub._queue.push(plugin);
  }
}

// Unmounting cancels the editor's in-flight load and pagination, so nothing renders after close.
export function closeEditor(): void {
  editorRoot?.unmount();
  editorRoot = null;
  openPageId = null;
  document.getElementById(MOUNT_ID)?.remove();
  removePrintStyle();
}

export function openEditor(pageId: string): void {
  closeEditor();
  const el = document.createElement('div');
  el.id = MOUNT_ID;
  el.style.position = 'fixed';
  el.style.inset = '0';
  el.style.zIndex = '2000';
  el.style.background = '#e9ecef';
  document.body.appendChild(el);
  openPageId = pageId;
  editorRoot = createRoot(el);
  editorRoot.render(<PrintLayoutEditor pageId={pageId} onClose={closeEditor} />);
}

export function activate(): void {
  registerToHub({
    id: PLUGIN_ID,
    label: '印刷レイアウト',
    icon: 'print',
    order: 50,
    onPageChange: (ctx) => {
      if (ctx.mode === 'edit' || (openPageId != null && ctx.pageId !== openPageId)) {
        closeEditor();
      }
    },
    onAction: (pageId) => openEditor(pageId),
    onDisable: closeEditor,
  });
}

export function deactivate(): void {
  closeEditor();
  (window as any).growiPluginHub?.unregister?.(PLUGIN_ID);
}

if ((window as any).pluginActivators == null) {
  (window as any).pluginActivators = {};
}
(window as any).pluginActivators[PLUGIN_ID] = { activate, deactivate };

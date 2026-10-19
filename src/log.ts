import { PLUGIN_ID } from './constants';

interface HubLogger {
  log?: (pluginId: string, ...args: unknown[]) => void;
}

/** Logs through extension-hub; a no-op when the hub is not loaded. */
export function log(...args: unknown[]): void {
  (window as unknown as { growiPluginHub?: HubLogger }).growiPluginHub?.log?.(PLUGIN_ID, ...args);
}

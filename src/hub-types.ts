// Minimal type definitions for extension-hub integration
// Full types: https://gitea.drupal-yattemiyo.com/growi-plugins/growi-plugin-extension-hub

export interface GrowiPageContext {
  pageId: string;
  mode: 'view' | 'edit';
  revisionId?: string;
  path?: string;
}

export interface PluginRegistration {
  id: string;
  label: string;
  icon?: string;
  order?: number;
  required?: boolean;
  menuItem?: boolean;
  onAction?: (pageId: string) => void;
  onPageChange?: (ctx: GrowiPageContext) => void | Promise<void>;
  onDisable?: () => void;
  badge?: number | null;
  badgeColor?: string;
}

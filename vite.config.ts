/**
 * vite.config.ts — Vite ビルド設定
 *
 * Vite は高速なフロントエンドビルドツール。
 * 開発時はネイティブESモジュールを使った超高速HMR（Hot Module Replacement）を提供し、
 * 本番ビルド時は Rollup でバンドルして最適化されたファイルを生成する。
 */

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    // JSXトランスフォーム（TSX → JS変換）と開発時のFast Refreshを有効にする。
    // 調整画面（src/editor）は React コンポーネントで作られている。
    react(),
  ],
  build: {
    // dist/.vite/manifest.json を生成する。
    // GROWIはこのファイルを参照してビルド後のファイル名（ハッシュ付き）を特定する。
    // このオプションがないとGROWIがプラグインのJSファイルを見つけられない。
    manifest: true,

    rollupOptions: {
      // ビルドのエントリーポイントを指定（プロジェクトルートからの相対パス）。
      // ここに指定したファイルが dist/ に出力される。
      input: ['client-entry.tsx'],

      // エントリーポイントのエクスポートをすべて保持する設定。
      // これがないと Rollup の tree-shaking（未使用コード除去）により
      // activate / deactivate 関数が「使われていない」と判断されて
      // 消えてしまい、空のファイルが生成される。
      preserveEntrySignatures: 'strict',
    },
  },
});

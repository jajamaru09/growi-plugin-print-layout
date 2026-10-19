import { describe, expect, test } from 'vitest';

import { extractLayoutJson, serializeLayoutPage } from './page-body';
import { defaultLayout, parseLayout } from './validate';

const valid = {
  ...defaultLayout('page1', 'rev1'),
  breaks: [{ anchor: { tag: 'h2', textHash: 'deadbeef', occurrence: 0 } }],
  images: [
    {
      anchor: { kind: 'drawio' as const, key: 'k', occurrence: 0 },
      widthPercent: 60,
    },
  ],
};

describe('layout page body', () => {
  test('serialize -> extract -> parse round-trips and the body starts with the fixed notice line', () => {
    const md = serializeLayoutPage(valid);
    expect(md.split('\n')[0]).toBe(
      'このページは印刷レイアウトプラグインの設定です。手で編集しないでください。',
    );
    expect(parseLayout(extractLayoutJson(md)).layout).toEqual(valid);
  });

  test('extractLayoutJson returns null for broken JSON', () => {
    expect(extractLayoutJson('notice\n\n```json\n{ broken\n```\n')).toBeNull();
  });

  test('extractLayoutJson returns null for a body without a json fence', () => {
    expect(extractLayoutJson('just text\n```js\n{}\n```')).toBeNull();
  });
});

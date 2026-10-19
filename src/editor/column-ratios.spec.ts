import { afterEach, expect, test } from 'vitest';
import { captureWiki } from '../capture';
import { createColumnRatioApplier } from './column-ratios';

const COLUMNS_HTML =
  '<div class="wiki"><div style="display:flex"><div style="flex:1">left</div><div class="f2_item">right</div></div></div>';

const capture = async () => {
  document.body.innerHTML = COLUMNS_HTML;
  const source = document.querySelector<HTMLElement>('.wiki') as HTMLElement;
  return { source, content: await captureWiki(source, async () => null) };
};

const childFlex = (el: Element): string[] => Array.from(el.children).map((c) => (c as HTMLElement).style.flex);

afterEach(() => {
  document.body.innerHTML = '';
});

test('an adjusted column gets "<L> 1 0" on the left child and "<100-L> 1 0" on the right one', async () => {
  const { content } = await capture();
  createColumnRatioApplier(content.columns)({ 0: 30 });
  const [left, right] = Array.from(content.columns[0].element.children) as HTMLElement[];
  expect(left.style.flexGrow).toBe('30');
  expect(right.style.flexGrow).toBe('70');
  expect([left.style.flexShrink, right.style.flexShrink]).toEqual(['1', '1']);
  expect([left.style.flexBasis, right.style.flexBasis]).toEqual(['0px', '0px']);
});

test('the live page DOM is never touched', async () => {
  const { source, content } = await capture();
  const before = source.outerHTML;
  createColumnRatioApplier(content.columns)({ 0: 30 });
  expect(source.outerHTML).toBe(before);
});

test('removing an adjustment restores the captured inline flex of both children', async () => {
  const { content } = await capture();
  const original = childFlex(content.columns[0].element);
  const apply = createColumnRatioApplier(content.columns);
  apply({ 0: 30 });
  apply({});
  expect(childFlex(content.columns[0].element)).toEqual(original);
});

import { expect, test } from 'vitest';
import { stripInteractiveChrome } from './strip-chrome';

const el = (html: string): HTMLElement => {
  const host = document.createElement('div');
  host.innerHTML = html.trim();
  return host.firstElementChild as HTMLElement;
};

test('removes the edit button of a GROWI table wrapper and keeps the table', () => {
  const block = el(
    '<div class="editable-with-handsontable"><button class="handsontable-modal-trigger"><span>edit_note</span></button><table><tbody><tr><td>1</td></tr></tbody></table></div>',
  );

  stripInteractiveChrome(block);

  expect(block.querySelector('button')).toBeNull();
  expect(block.querySelector(':scope > table td')?.textContent).toBe('1');
});

test('removes a drawio edit button', () => {
  const block = el(
    '<div class="drawio-viewer-with-edit-button"><button class="btn btn-edit-drawio">Edit</button><div class="drawio-viewer"><svg></svg></div></div>',
  );

  stripInteractiveChrome(block);

  expect(block.querySelector('button')).toBeNull();
  expect(block.querySelector('svg')).not.toBeNull();
});

test('unwraps a button around an image, keeping the image and its siblings in place', () => {
  const block = el('<p>a<button class="border-0 bg-transparent p-0"><img src="/attachment/one"> x</button>b</p>');
  const img = block.querySelector('img');

  stripInteractiveChrome(block);

  expect(block.querySelector('button')).toBeNull();
  expect(block.querySelector(':scope > img')).toBe(img);
  expect(block.textContent).toBe('a xb');
});

test('removes the hover-only anchor link and edit button of a heading', () => {
  const block = el(
    '<h2 id="t" class="position-relative"><a href="#t" class="d-none d-md-inline revision-head-link position-absolute">#</a>Title<span class="revision-head-edit-button"><button type="button" class="border-0 bg-transparent p-0"><span class="material-symbols-outlined">edit_square</span></button></span></h2>',
  );

  stripInteractiveChrome(block);

  expect(block.innerHTML).toBe('Title');
});

test('leaves unrelated buttons alone', () => {
  const block = el('<div><button class="other">keep</button></div>');

  stripInteractiveChrome(block);

  expect(block.querySelector('button')?.textContent).toBe('keep');
});

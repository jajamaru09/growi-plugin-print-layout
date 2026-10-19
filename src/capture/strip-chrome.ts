import { WRAPPER_SELECTOR } from './drawio-static';

// Heading anchors and edit buttons are opacity 0 until hovered on GROWI 8.0.4.
const EDIT_BUTTON_SELECTOR = [
  '.editable-with-handsontable > button',
  '.btn-edit-drawio',
  `${WRAPPER_SELECTOR} > button`,
  '.revision-head-edit-button',
  '.revision-head-link',
].join(', ');

/**
 * Removes GROWI's edit buttons from a copy of wiki content and unwraps the
 * button GROWI puts around images. Mutates `root`; callers pass clones only.
 */
export function stripInteractiveChrome(root: HTMLElement): void {
  for (const button of Array.from(root.querySelectorAll(EDIT_BUTTON_SELECTOR))) {
    button.remove();
  }
  for (const button of Array.from(root.querySelectorAll('button'))) {
    if (button.querySelector('img') != null) button.replaceWith(...Array.from(button.childNodes));
  }
}

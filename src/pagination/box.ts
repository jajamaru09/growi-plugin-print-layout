export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const px = (v: string): number => Number.parseFloat(v) || 0;

export function borderInsets(el: Element): Insets {
  const cs = getComputedStyle(el);
  return {
    top: px(cs.borderTopWidth),
    right: px(cs.borderRightWidth),
    bottom: px(cs.borderBottomWidth),
    left: px(cs.borderLeftWidth),
  };
}

/** Border plus padding on each side: what separates the border box from the content box. */
export function contentInsets(el: Element): Insets {
  const cs = getComputedStyle(el);
  const border = borderInsets(el);
  return {
    top: border.top + px(cs.paddingTop),
    right: border.right + px(cs.paddingRight),
    bottom: border.bottom + px(cs.paddingBottom),
    left: border.left + px(cs.paddingLeft),
  };
}

/** Data attributes the plugin puts on captured and rendered content, and on its overlays. */
export const BLOCK_ATTR = 'data-pl-block';
export const IMAGE_ATTR = 'data-pl-image';
export const COLUMNS_ATTR = 'data-pl-columns';
export const FIT_ATTR = 'data-pl-fit';
export const SCALE_ATTR = 'data-pl-scale';
export const BREAK_ATTR = 'data-pl-break';
/** Marks the node that replaced a drawio wrapper; its value is the diagram key. */
export const DRAWIO_ATTR = 'data-print-layout-drawio';
/** Marks a captured wrapper pagination may cut between its children (see splitLeaves). */
export const SPLIT_ATTR = 'data-pl-split';
/** Index of the vertical band a split wrapper's child sits in; measure records it, renderPages cuts on it. */
export const LEAF_ATTR = 'data-pl-leaf';

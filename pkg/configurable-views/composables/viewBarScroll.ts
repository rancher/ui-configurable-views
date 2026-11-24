/**
 * Where each page's view bar tab strip was scrolled to, kept outside the bar - by page, as the Home and
 * a cluster's dashboard each have a bar, and views, of their own.
 *
 * The bar is drawn again from scratch when the page switches between Rancher's own page and a view of
 * widgets - they are laid out differently, and each has its own bar. Without this the new bar starts
 * at the beginning of the strip, so picking a tab far along it jumped the strip back to the start.
 */
export const viewBarScroll: Record<string, number> = {};

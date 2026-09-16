/**
 * pi-ui · DOM primitives shared by the pi-chat and pi-settings webviews.
 *
 * Both webviews are framework-free: they build DOM from template strings plus
 * `data-action` event delegation. These helpers are the parts that were
 * genuinely duplicated between them.
 */

/** Create an element, optionally with a class and text content. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * Escape a value for interpolation into HTML — valid for text nodes and for
 * single- or double-quoted attributes, since all five dangerous characters are
 * covered.
 */
export function escHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** Alias kept for call sites that spell the intent out. Identical behaviour. */
export const escAttr = escHtml;

/**
 * Delegated event listener — keeps the codebase on one listener per container
 * instead of one per row. Returns a disposer.
 */
export function delegate<K extends keyof HTMLElementEventMap>(
  root: HTMLElement,
  type: K,
  selector: string,
  handler: (event: HTMLElementEventMap[K], target: HTMLElement) => void,
): () => void {
  const listener = (event: Event) => {
    const node = event.target as HTMLElement | null;
    const hit = node?.closest?.(selector) as HTMLElement | null;
    if (hit && root.contains(hit)) handler(event as HTMLElementEventMap[K], hit);
  };
  root.addEventListener(type, listener);
  return () => root.removeEventListener(type, listener);
}

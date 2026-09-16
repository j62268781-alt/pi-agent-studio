/**
 * pi-ui · popup primitive
 *
 * `pi-chat/src/composer.ts` used to carry four near-identical copies of
 * "set min-width, right-align on overflow, flip vertically, close on outside
 * click and Escape" for the model / thinking / permission / sessions popups.
 * This is that behaviour in one place.
 *
 * Contract
 * - `popup` is a descendant of `wrap`, and `wrap` is `position: relative`.
 * - The stylesheet owns everything visual, keyed off the `is-open` class on
 *   both `wrap` and `popup` (so the trigger can light up too).
 * - The popup is absolutely positioned; this module only ever writes `left`,
 *   `top`, `bottom` and `min-width`.
 */

export const POPUP_OPEN_CLASS = "is-open";

export interface PopupOptions {
  /** Anchor element. The popup must be a descendant of it. */
  wrap: HTMLElement;
  /** The floating panel. */
  popup: HTMLElement;
  /** Floor for the panel width, in px. Never shrinks below the anchor's width. */
  minWidth?: number;
  /** Distance between anchor and panel, in px. */
  gap?: number;
  /** Preferred side; falls back to the other side when there is no room. */
  prefer?: "above" | "below";
}

export interface Popup {
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
  /** Re-measure and re-place. Safe to call while closed. */
  reposition(): void;
  destroy(): void;
}

const VIEWPORT_MARGIN = 8;

export function createPopup(options: PopupOptions): Popup {
  const { wrap, popup } = options;
  const gap = options.gap ?? 6;
  const prefer = options.prefer ?? "above";
  const minWidth = options.minWidth ?? 0;

  let opened = false;

  function reposition(): void {
    const wasOpen = opened;
    // Make the panel measurable without flashing it on screen.
    popup.classList.add(POPUP_OPEN_CLASS);
    popup.style.visibility = "hidden";

    const anchor = wrap.getBoundingClientRect();
    popup.style.minWidth = `${Math.max(minWidth, anchor.width)}px`;
    const panel = popup.getBoundingClientRect();

    // Horizontal: align to the anchor's left edge, right-align when that would
    // run off the viewport, then clamp so the panel never leaves the screen.
    let left = 0;
    if (anchor.left + panel.width > window.innerWidth - VIEWPORT_MARGIN) {
      left = anchor.width - panel.width;
    }
    if (anchor.left + left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN - anchor.left;

    // Vertical: flip away from the viewport edge when the preferred side has
    // no room for the panel.
    const roomAbove = anchor.top;
    const roomBelow = window.innerHeight - anchor.bottom;
    const needed = panel.height + gap + VIEWPORT_MARGIN;
    const canAbove = roomAbove >= needed;
    const canBelow = roomBelow >= needed;
    let side = prefer;
    if (side === "above" && !canAbove && canBelow) side = "below";
    else if (side === "below" && !canBelow && canAbove) side = "above";

    popup.style.left = `${left}px`;
    popup.style.right = "auto";
    if (side === "above") {
      popup.style.bottom = `${wrap.offsetHeight + gap}px`;
      popup.style.top = "auto";
    } else {
      popup.style.top = `${wrap.offsetHeight + gap}px`;
      popup.style.bottom = "auto";
    }

    popup.style.visibility = "";
    if (!wasOpen) popup.classList.remove(POPUP_OPEN_CLASS);
  }

  function onPointerDown(event: Event): void {
    const target = event.target as Node | null;
    if (target && (popup.contains(target) || wrap.contains(target))) return;
    close();
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    close();
  }

  function onViewportChange(): void {
    if (opened) reposition();
  }

  function open(): void {
    if (opened) return;
    opened = true;
    wrap.classList.add(POPUP_OPEN_CLASS);
    reposition();
    document.addEventListener("mousedown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
  }

  function close(): void {
    if (!opened) return;
    opened = false;
    wrap.classList.remove(POPUP_OPEN_CLASS);
    popup.classList.remove(POPUP_OPEN_CLASS);
    document.removeEventListener("mousedown", onPointerDown, true);
    document.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("resize", onViewportChange);
    window.removeEventListener("scroll", onViewportChange, true);
  }

  return {
    open,
    close,
    toggle: () => (opened ? close() : open()),
    isOpen: () => opened,
    reposition,
    destroy: () => {
      close();
      popup.classList.remove(POPUP_OPEN_CLASS);
    },
  };
}

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Uri } from "vscode";

/**
 * The design token layer lives in `pi-ui/tokens.css`. The two Vite webviews
 * (pi-chat, pi-settings) import it at build time, but the extension-side HTML
 * strings — the session / settings / package sidebars from board G — are
 * assembled at runtime and cannot import anything.
 *
 * STATUS: currently unused. It was read by the board-G loading screen, which
 * has been removed; it is kept because the board-G sidebars (G W1–W4) are the
 * next piece of work and will read it. Delete this file — and the
 * `!pi-ui/tokens.css` line in .vscodeignore — if that work is descoped.
 *
 * One source of truth for colour, and no second token table to keep in sync.
 */
let cache: string | null = null;

export function designTokensCss(extensionUri: Uri): string {
  if (cache === null) {
    try {
      const raw = readFileSync(join(extensionUri.fsPath, "pi-ui", "tokens.css"), "utf8");
      // The comments are documentation for maintainers, not for the runtime.
      cache = raw
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\n{2,}/g, "\n")
        .trim();
    } catch {
      cache = "";
    }
  }
  return cache;
}

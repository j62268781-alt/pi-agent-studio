import * as vscode from "vscode";

/** The extension ships a single webview UI: the sidebar view, plus the settings
 * panel which opens as an editor-area webview. The old `terminal` mode (running
 * the pi TUI inside a VS Code terminal) has been removed along with the
 * terminal-session tracking. */
export type UiMode = "webview" | "sidebar";

export function resolveUiMode(): UiMode {
  const value = vscode.workspace.getConfiguration("pi-agent-studio").get<string>("ui");
  return value === "webview" ? "webview" : "sidebar";
}

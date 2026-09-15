// Sidebar chat: hosts the pi-chat webview UI in a WebviewView (own `pi-chat`
// activity bar container, separate from the Pi sessions/settings container)
// instead of an editor-tab WebviewPanel. A single session runs in the
// background; closing/hiding the view keeps the RPC subprocess alive, and
// re-resolving the view re-attaches the same session. No RPC process is
// spawned until the user explicitly starts the chat (the view shows a
// starter screen with a button, or `pi-agent-studio.openInSidebar` is run),
// so merely opening the container costs nothing.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import * as vscode from "vscode";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import type { BridgeConfig } from "../bridge/types.ts";
import { getLocale, t } from "../i18n.ts";
import { getChatWebviewHtml, resolveChatBackground } from "./chat-webview.ts";
import { createChatSession, type ChatHost, type ChatSession } from "./chat-session.ts";

export const SIDEBAR_VIEW_ID = "pi-agent-studio.chatSidebar";

/** The background sidebar chat session, if one has been started. */
export function getSidebarSession(): ChatSession | undefined {
  return sidebarState?.session;
}

/** A sidebar chat target that can actually receive messages: a started session
 *  bound to a currently-visible view. Returns undefined if the view was closed
 *  (even though the session keeps running in the background). */
export function getSidebarChatTarget():
  | { session: ChatSession; view: vscode.WebviewView }
  | undefined {
  if (sidebarState?.session && sidebarState?.view) {
    return { session: sidebarState.session, view: sidebarState.view };
  }
  return undefined;
}

/** Focus the sidebar chat view (does not start a session). */
export function focusSidebarChat(): void {
  void sidebarState?.view?.show(false);
}

interface SidebarState {
  view?: vscode.WebviewView;
  session?: ChatSession;
}

interface SidebarChatOptions {
  extensionUri: vscode.Uri;
  bridgeConfig?: BridgeConfig;
  sessionFile?: string;
  newSession?: boolean;
}

let sidebarState: SidebarState | undefined;
let currentHost: ChatHost | undefined;
let pendingSession: Promise<ChatSession | undefined> | undefined;
let viewWaiters: Array<(view: vscode.WebviewView) => void> = [];

function waitForView(): Promise<vscode.WebviewView | undefined> {
  if (sidebarState?.view) return Promise.resolve(sidebarState.view);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      const i = viewWaiters.indexOf(settle);
      if (i >= 0) viewWaiters.splice(i, 1);
      resolve(undefined);
    }, 5000);
    const settle = (view: vscode.WebviewView) => {
      clearTimeout(timer);
      const i = viewWaiters.indexOf(settle);
      if (i >= 0) viewWaiters.splice(i, 1);
      resolve(view);
    };
    viewWaiters.push(settle);
  });
}

function getChatHtml(webview: vscode.Webview): string {
  const cfg = vscode.workspace.getConfiguration("pi-agent-studio");
  return getChatWebviewHtml(
    homedir(),
    sep,
    cfg.get<number>("chatFontSize"),
    getLocale(),
    cfg.get<string>("chatMermaidTheme"),
    resolveChatBackground(webview, cfg.get<string>("chatBackgroundImage")),
    cfg.get<number>("chatBackgroundOpacity"),
    cfg.get<string>("chatSendShortcut"),
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
  );
}

/** Fork change: the old "Start Chat" page is now a loading screen. The session auto-starts, so
 * this only shows for the ~1s the RPC subprocess needs to boot (plus a retry affordance if
 * starting fails). It hands off to the in-webview boot splash (index.html #boot-splash), which
 * stays up until the history has rendered — same π badge and dots on both. */
function getLoadingHtml(extensionUri: vscode.Uri): string {
  const zh = getLocale() === "zh-cn";
  const nonce = "loader" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  // Never let a missing asset take the whole view down (the packaged vsix must list
  // assets/icon.svg in .vscodeignore; if it is absent anyway, fall back to a text glyph).
  let logoSvg = "";
  try {
    logoSvg = readFileSync(join(extensionUri.fsPath, "assets", "icon.svg"), "utf8");
  } catch {
    logoSvg = "";
  }
  const logo = logoSvg || `<span style="font-size:34px;font-weight:600;font-style:italic">π</span>`;
  return `<!DOCTYPE html>
<html lang="${zh ? "zh-cn" : "en"}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<style>
html, body { height: 100%; }
body {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 18px; margin: 0; padding: 24px; box-sizing: border-box;
  background: var(--vscode-sideBar-background);
  color: var(--vscode-foreground);
  font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
}
.logo { width: 64px; height: 64px; display: flex; align-items: center; justify-content: center; }
.logo svg { width: 100%; height: 100%; display: block; border-radius: 14px; }
.dots { display: flex; gap: 7px; }
.dots span {
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--vscode-descriptionForeground);
  animation: pi-dot 1.2s infinite ease-in-out;
}
.dots span:nth-child(2) { animation-delay: 0.15s; }
.dots span:nth-child(3) { animation-delay: 0.3s; }
@keyframes pi-dot {
  0%, 80%, 100% { opacity: 0.25; transform: translateY(0); }
  40% { opacity: 1; transform: translateY(-5px); }
}
.hint { font-size: 12px; color: var(--vscode-descriptionForeground); }
.error { display: none; flex-direction: column; align-items: center; gap: 10px; text-align: center; }
.error .msg { font-size: 12px; color: var(--vscode-errorForeground); max-width: 360px; line-height: 1.5; }
.error button {
  padding: 5px 14px;
  background: var(--vscode-button-background); color: var(--vscode-button-foreground);
  border: none; border-radius: 2px; cursor: pointer; font-family: inherit; font-size: 12px;
}
.error button:hover { background: var(--vscode-button-hoverBackground); }
</style>
</head>
<body>
<div class="logo">${logo}</div>
<div class="dots" id="dots"><span></span><span></span><span></span></div>
<div class="hint" id="hint">${zh ? "正在启动会话…" : "Starting session…"}</div>
<div class="error" id="error">
  <div class="msg" id="error-msg"></div>
  <button id="retry">${zh ? "重试" : "Retry"}</button>
</div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
document.getElementById("retry").addEventListener("click", () => {
  document.getElementById("error").style.display = "none";
  document.getElementById("dots").style.display = "flex";
  document.getElementById("hint").style.display = "block";
  vscode.postMessage({ type: "startSession" });
});
window.addEventListener("message", (ev) => {
  const d = ev.data;
  if (d && d.type === "sessionFailed") {
    document.getElementById("dots").style.display = "none";
    document.getElementById("hint").style.display = "none";
    document.getElementById("error-msg").textContent = d.message || "Failed to start session.";
    document.getElementById("error").style.display = "flex";
  }
});
</script>
</body>
</html>`;
}

function makeHost(webviewView: vscode.WebviewView): ChatHost {
  let viewDisposed = false;
  const host: ChatHost = {
    postMessage: (msg) => {
      if (viewDisposed) return;
      void webviewView.webview.postMessage(msg);
    },
    onDidReceiveMessage: (listener) => webviewView.webview.onDidReceiveMessage(listener),
    onDidDispose: (listener) => webviewView.onDidDispose(listener),
  };
  webviewView.onDidDispose(() => {
    viewDisposed = true;
  });
  return host;
}

/** Resolve which session file the sidebar chat should bootstrap with.
 * Command-supplied `sessionFile` wins; `newSession` means start clean; otherwise resume the
 * most recently modified session recorded for the workspace so reopening the chat lands where
 * the last conversation left off. */
async function resolveInitialSessionFile(opts: SidebarChatOptions): Promise<string | undefined> {
  if (opts.sessionFile) return opts.sessionFile;
  if (opts.newSession) return undefined;
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!cwd) return undefined;
  try {
    const sessions = await SessionManager.list(cwd);
    let latest: SessionInfo | undefined;
    for (const s of sessions) {
      const t = s.modified instanceof Date ? s.modified.getTime() : 0;
      const best = latest?.modified instanceof Date ? latest.modified.getTime() : 0;
      if (!latest || t > best) latest = s;
    }
    return latest?.path;
  } catch {
    return undefined;
  }
}

function ensureSidebarSession(opts: SidebarChatOptions): Promise<ChatSession | undefined> {
  if (sidebarState?.session) return Promise.resolve(sidebarState.session);
  pendingSession ??= (async () => {
    const host = currentHost;
    if (!host) return undefined;
    try {
      const session = await createChatSession({
        extensionUri: opts.extensionUri,
        bridgeConfig: opts.bridgeConfig,
        sessionFile: opts.sessionFile,
        cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
        traceTag: "sidebar",
        host,
      });
      if (session) sidebarState = { ...sidebarState, session };
      return session;
    } finally {
      // Clear on success and failure alike so the loading screen's retry can start over.
      pendingSession = undefined;
    }
  })();
  return pendingSession;
}

async function startSidebarSession(
  webviewView: vscode.WebviewView,
  host: ChatHost,
  opts: SidebarChatOptions,
): Promise<void> {
  let session: ChatSession | undefined;
  try {
    session = await ensureSidebarSession(opts);
  } catch (e) {
    // Fork change: surface the failure on the loading screen; its retry button keeps the
    // manual path alive without resurrecting the always-there "Start Chat" page.
    void webviewView.webview.postMessage({
      type: "sessionFailed",
      message: e instanceof Error ? e.message : String(e),
    });
    return;
  }
  if (!session || sidebarState?.view !== webviewView) return;
  webviewView.webview.html = getChatHtml(webviewView.webview);
  session.attach(host);
}

/** Start the sidebar session with the initial-file resolution (command arg > most recent). */
async function startSidebarSessionWithInitialFile(
  webviewView: vscode.WebviewView,
  host: ChatHost,
  opts: SidebarChatOptions,
): Promise<void> {
  const sessionFile = await resolveInitialSessionFile(opts);
  await startSidebarSession(webviewView, host, sessionFile ? { ...opts, sessionFile } : opts);
}

export function createChatSidebarViewProvider(
  opts: SidebarChatOptions,
): vscode.WebviewViewProvider {
  return {
    resolveWebviewView(webviewView: vscode.WebviewView) {
      webviewView.webview.options = {
        enableScripts: true,
        retainContextWhenHidden: true,
      } as vscode.WebviewOptions & { retainContextWhenHidden?: boolean };
      webviewView.webview.html = sidebarState?.session
        ? getChatHtml(webviewView.webview)
        : getLoadingHtml(opts.extensionUri);

      const host = makeHost(webviewView);
      currentHost = host;
      sidebarState = { ...sidebarState, view: webviewView };

      const startSub = webviewView.webview.onDidReceiveMessage((msg) => {
        if (msg && typeof msg === "object" && (msg as { type?: unknown }).type === "startSession") {
          void startSidebarSessionWithInitialFile(webviewView, host, opts);
        }
      });

      const langSub = vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("pi-agent-studio.chatSendShortcut")) {
          webviewView.webview.postMessage({
            type: "sendShortcut",
            value:
              vscode.workspace
                .getConfiguration("pi-agent-studio")
                .get<string>("chatSendShortcut") ?? "enter",
          });
        }
        if (
          e.affectsConfiguration("pi-agent-studio.language") ||
          e.affectsConfiguration("pi-agent-studio.chatMermaidTheme")
        ) {
          if (sidebarState?.session) {
            webviewView.webview.html = getChatHtml(webviewView.webview);
            sidebarState.session.attach(host);
          } else if (sidebarState?.view === webviewView) {
            webviewView.webview.html = getLoadingHtml(opts.extensionUri);
          }
        }
      });

      if (sidebarState.session) {
        sidebarState.session.attach(host);
      } else {
        // Fork change: auto-start on first open — no manual "Start Chat" click needed. The
        // most recent session of the workspace is resumed so the history is right there; the
        // loading screen stays up only for the ~1s the RPC subprocess needs to boot (and as a
        // retry affordance if starting fails).
        void startSidebarSessionWithInitialFile(webviewView, host, opts);
      }

      webviewView.onDidDispose(() => {
        langSub.dispose();
        startSub.dispose();
        if (currentHost === host) currentHost = undefined;
        if (sidebarState?.view === webviewView) {
          // Keep the session running in the background; it re-attaches on re-resolve.
          sidebarState = { ...sidebarState, view: undefined };
        }
      });

      for (const w of viewWaiters) w(webviewView);
      viewWaiters = [];
    },
  };
}

export async function openSidebarChat(opts: SidebarChatOptions): Promise<void> {
  // NOTE: focus the VIEW, not the container. `workbench.view.extension.pi-chat`
  // is the activity-bar container command and misbehaves when the container is
  // dragged to the secondary sidebar (focus lands on the primary sidebar,
  // e.g. Explorer). `<viewId>.focus` resolves the view's actual location and
  // opens+focuses the hosting part (primary or secondary) itself.
  await vscode.commands.executeCommand(`${SIDEBAR_VIEW_ID}.focus`);
  const view = await waitForView();
  if (!view) return;

  if (!sidebarState?.session) {
    const host = currentHost;
    if (!host) return;
    await startSidebarSession(view, host, opts);
  }

  const session = sidebarState?.session;
  if (!session) return;

  if (opts.newSession) {
    if (session.sessionFile) {
      if (session.streaming) {
        void vscode.window.showWarningMessage(t("Stop the agent before starting a new session."));
        return;
      }
      await session.newSession();
    }
    void view.show(true);
    return;
  }

  if (opts.sessionFile && session.sessionFile !== opts.sessionFile) {
    if (session.streaming) {
      void vscode.window.showWarningMessage(t("Stop the agent before switching sessions."));
      return;
    }
    const choice = await vscode.window.showWarningMessage(
      t(
        "Switch the sidebar chat to the selected session? The current conversation stays open in the background.",
      ),
      { modal: true },
      t("Switch"),
    );
    if (choice !== t("Switch")) return;
    await session.switchTo(opts.sessionFile);
  }
  void view.show(true);
}

export function disposeSidebarChat(): void {
  if (sidebarState?.session) {
    sidebarState.session.dispose();
  }
  sidebarState = undefined;
  currentHost = undefined;
  pendingSession = undefined;
  viewWaiters = [];
}

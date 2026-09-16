import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import * as vscode from "vscode";
import { resolveEndpoint } from "./bridge/endpoint.ts";
import { createBridge } from "./bridge/server.ts";
import type { BridgeConfig } from "./bridge/types.ts";
import { isAbsolutePath } from "./bridge/utils.ts";
import { TERMINAL_TITLE } from "./constants.ts";
import { t } from "./i18n.ts";
import { upgradePiBinary, invalidatePiBinaryCache } from "./pi.ts";
import { resolveUiMode } from "./ui-mode.ts";
import { createChatTracker } from "./modules/chat/chat-tracker.ts";
import { disposeRpcTrace } from "./modules/chat/rpc-trace.ts";

let extensionUri: vscode.Uri;
let bridgeConfig: BridgeConfig | undefined;
let bridgeDispose: (() => Promise<void>) | undefined;
let bridgeRestartTimer: NodeJS.Timeout | undefined;

const BRIDGE_SETTING = "pi-agent-studio.bridgeSocket";
const BRIDGE_SETTLE_MS = 1000;

async function startBridge(
  context: vscode.ExtensionContext,
): Promise<{ config: BridgeConfig; fellBackReason?: string }> {
  await bridgeDispose?.();
  bridgeDispose = undefined;
  const endpoint = resolveEndpoint(
    vscode.workspace.getConfiguration("pi-agent-studio").get<string>("bridgeSocket", ""),
    vscode.env.sessionId,
  );
  let bridge;
  let fellBackReason: string | undefined;
  try {
    bridge = await createBridge(context, endpoint);
    if (endpoint.kind === "tcp" && endpoint.invalid)
      fellBackReason = t("the configured value is invalid");
    else if (bridge.fallbackFrom !== undefined)
      fellBackReason = t("port {0} is in use", bridge.fallbackFrom);
    else if (endpoint.kind === "socket" && !bridge.socketPath)
      fellBackReason = t("socket {0} is in use", endpoint.path);
  } catch (error) {
    bridge = await createBridge(context, {
      kind: "tcp",
      port: 0,
    });
    fellBackReason = t(
      "binding {0} failed ({1})",
      endpoint.kind === "socket" ? endpoint.path : String(endpoint.port),
      error instanceof Error ? error.message : String(error),
    );
  }
  bridgeDispose = () => bridge.dispose();
  const config: BridgeConfig = {
    url: bridge.url,
    socketPath: bridge.socketPath,
    token: bridge.token,
  };
  bridgeConfig = config;
  return { config, fellBackReason };
}

/** Wrap a lazy WebviewViewProvider factory so the implementing module (and its
 *  dependency tree, e.g. the pi SDK) is only imported when the user first opens
 *  the corresponding sidebar view, not at activation time. */
function lazyViewProvider(
  factory: () => Promise<vscode.WebviewViewProvider>,
): vscode.WebviewViewProvider {
  let pending: Promise<vscode.WebviewViewProvider> | undefined;
  const resolve = () => (pending ??= factory());
  return {
    async resolveWebviewView(
      webviewView: vscode.WebviewView,
      context: vscode.WebviewViewResolveContext,
      token: vscode.CancellationToken,
    ) {
      const provider = await resolve();
      return provider.resolveWebviewView(webviewView, context, token);
    },
  };
}

export async function activate(context: vscode.ExtensionContext) {
  extensionUri = context.extensionUri;

  const chatTracker = createChatTracker(context);
  const { fellBackReason } = await startBridge(context);
  if (fellBackReason) {
    const actual = bridgeConfig?.socketPath ?? bridgeConfig?.url ?? "a random port";
    void vscode.window.showWarningMessage(t("Pi bridge: {0} — using {1}.", fellBackReason, actual));
  }
  context.subscriptions.push({
    dispose: () => {
      clearTimeout(bridgeRestartTimer);
      const dispose = bridgeDispose;
      bridgeDispose = undefined;
      bridgeConfig = undefined;
      void dispose?.();
    },
  });

  const rewindProvider: vscode.TextDocumentContentProvider = {
    provideTextDocumentContent(uri: vscode.Uri): string {
      const parts = String(uri.path || "")
        .replace(/^\/+/, "")
        .split("/");
      if (parts[0] === "empty") return "";
      if (parts[0] === "snapshot" && parts[1] && parts[2]) {
        try {
          return readFileSync(join(homedir(), ".pi", "snapshots", parts[1], parts[2]), "utf8");
        } catch {
          return "";
        }
      }
      return "";
    },
  };
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider("pi-rewind", rewindProvider),
  );

  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.text = "$(pi-logo)";
  statusBarItem.command = "pi-agent-studio.openSettings";
  const updateStatusBarTooltip = () => {
    statusBarItem.tooltip = t("Open Pi Settings");
  };
  updateStatusBarTooltip();
  statusBarItem.show();

  const applyBridgeSetting = async () => {
    const value = vscode.workspace
      .getConfiguration("pi-agent-studio")
      .get<string>(BRIDGE_SETTING, "");
    const endpoint = resolveEndpoint(value, vscode.env.sessionId);
    if (endpoint.kind === "tcp" && endpoint.invalid) {
      void vscode.window.showWarningMessage(
        t(
          'Invalid pi-agent-studio.bridgeSocket value "{0}" — expected a number 1-65535 or an absolute socket path. Bridge not restarted.',
          value,
        ),
      );
      return;
    }
    if (endpoint.kind === "socket" && !isAbsolutePath(endpoint.path)) {
      void vscode.window.showWarningMessage(
        t(
          'Invalid pi-agent-studio.bridgeSocket path "{0}" — expected an absolute path (or \\.\\pipe\\ on Windows). Bridge not restarted.',
          endpoint.path,
        ),
      );
      return;
    }
    const { config, fellBackReason } = await startBridge(context);
  };

  context.subscriptions.push(
    statusBarItem,
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("pi-agent-studio.path")) invalidatePiBinaryCache();
      if (event.affectsConfiguration("pi-agent-studio.language")) updateStatusBarTooltip();
      if (!event.affectsConfiguration(BRIDGE_SETTING)) return;
      // Settings UI commits on every keystroke; restart only after the value
      // settles so typing does not churn the bridge.
      clearTimeout(bridgeRestartTimer);
      bridgeRestartTimer = setTimeout(() => {
        void applyBridgeSetting();
      }, BRIDGE_SETTLE_MS);
    }),
    vscode.commands.registerCommand("pi-agent-studio.open", async () => {
      const mode = resolveUiMode();
      if (mode === "webview") {
        const { openChatPanel } = await import("./modules/chat/chat-panel.ts");
        await openChatPanel({ extensionUri, bridgeConfig, tracker: chatTracker });
        return;
      }
      const { openSidebarChat } = await import("./modules/chat/chat-sidebar.ts");
      await openSidebarChat({ extensionUri, bridgeConfig });
    }),
    vscode.commands.registerCommand("pi-agent-studio.openInNewWindow", async () => {
      const mode = resolveUiMode();
      if (mode === "sidebar") return;
      const { openChatPanel } = await import("./modules/chat/chat-panel.ts");
      await openChatPanel({ extensionUri, bridgeConfig, tracker: chatTracker });
      try {
        await vscode.commands.executeCommand("workbench.action.moveEditorToNewWindow");
      } catch {
        // ignore
      }
    }),
    vscode.commands.registerCommand("pi-agent-studio.openInFolder", async (uri?: vscode.Uri) => {
      const cwd = resolveExplorerCwd(uri);
      if (!cwd) {
        void vscode.window.showErrorMessage(
          t("Pi: Unable to resolve a folder from the selected item."),
        );
        return;
      }
      const { openChatPanel } = await import("./modules/chat/chat-panel.ts");
      await openChatPanel({ extensionUri, bridgeConfig, tracker: chatTracker, cwd });
    }),
    vscode.commands.registerCommand("pi-agent-studio.openInSidebar", async () => {
      const { openSidebarChat } = await import("./modules/chat/chat-sidebar.ts");
      await openSidebarChat({ extensionUri, bridgeConfig });
    }),
    vscode.commands.registerCommand("pi-agent-studio.upgrade", upgradePiBinary),
    vscode.commands.registerCommand("pi-agent-studio.openSettings", async (tab?: string) => {
      const { openSettingsPanel } = await import("./modules/settings/settings-panel.ts");
      await openSettingsPanel(extensionUri, tab);
    }),
    vscode.commands.registerCommand("pi-agent-studio.openSettingsJson", async () => {
      const { ensureSettingsJsonExists } = await import("./modules/settings/settings-config.ts");
      const path = ensureSettingsJsonExists();
      const doc = await vscode.workspace.openTextDocument(path);
      await vscode.window.showTextDocument(doc);
    }),
    vscode.commands.registerCommand("pi-agent-studio.openModelsJson", async () => {
      const { ensureModelsJsonExists } = await import("./modules/models/models-config.ts");
      const path = ensureModelsJsonExists();
      const doc = await vscode.workspace.openTextDocument(path);
      await vscode.window.showTextDocument(doc);
    }),
    vscode.commands.registerCommand("pi-agent-studio.addSelectionToChat", async () => {
      const { addSelectionToChat } = await import("./modules/chat/add-to-chat.ts");
      await addSelectionToChat();
    }),
    vscode.commands.registerCommand("pi-agent-studio.addFileToChat", async (uri?: vscode.Uri) => {
      const { addFileToChat } = await import("./modules/chat/add-to-chat.ts");
      await addFileToChat(uri);
    }),
    vscode.commands.registerCommand("pi-agent-studio.generateGitCommitMessage", async (scm) => {
      const { generateCommitMsg } = await import("./modules/gitCommit/commitMessageGenerator.ts");
      generateCommitMsg(scm);
    }),
    vscode.commands.registerCommand("pi-agent-studio.abortGitCommitMessage", async () => {
      const { abortCommitGeneration } =
        await import("./modules/gitCommit/commitMessageGenerator.ts");
      abortCommitGeneration();
    }),
    vscode.window.registerWebviewViewProvider(
      "pi-agent-studio.chatSidebar",
      lazyViewProvider(async () => {
        const { createChatSidebarViewProvider } = await import("./modules/chat/chat-sidebar.ts");
        return createChatSidebarViewProvider({ extensionUri, bridgeConfig });
      }),
    ),
  );

  if (resolveUiMode() === "webview") {
    void chatTracker.restore(async (sessionFile, panelId) => {
      const { openChatPanel } = await import("./modules/chat/chat-panel.ts");
      await openChatPanel({
        extensionUri,
        bridgeConfig,
        tracker: chatTracker,
        sessionFile,
        panelId,
      });
    });
  }
}

export async function deactivate() {
  try {
    const { disposeAllChatPanels } = await import("./modules/chat/chat-panel.ts");
    disposeAllChatPanels();
  } catch {
    // chat module never loaded — nothing to dispose
  }
  try {
    const { disposeSidebarChat } = await import("./modules/chat/chat-sidebar.ts");
    disposeSidebarChat();
  } catch {
    // sidebar chat module never loaded — nothing to dispose
  }
  disposeRpcTrace();
  for (const terminal of vscode.window.terminals) {
    if (terminal.name === TERMINAL_TITLE) terminal.dispose();
  }
  clearTimeout(bridgeRestartTimer);
  const dispose = bridgeDispose;
  bridgeDispose = undefined;
  bridgeConfig = undefined;
  await dispose?.();
}

/**
 * Resolve a usable cwd from an Explorer-context command argument.
 *  - File   -> use its parent directory
 *  - Folder -> use as-is
 *  - Missing on disk -> return undefined
 *  - No uri (e.g. invoked from command palette) -> fall back to first workspace folder
 */
function resolveExplorerCwd(uri: vscode.Uri | undefined): string | undefined {
  if (!uri || uri.scheme !== "file") {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }
  const fsPath = uri.fsPath;
  try {
    const stat = statSync(fsPath);
    return stat.isDirectory() ? fsPath : dirname(fsPath);
  } catch {
    return undefined;
  }
}

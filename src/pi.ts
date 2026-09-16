import { accessSync, constants } from "node:fs";
import { join } from "node:path";
import * as vscode from "vscode";
import {
  BRIDGE_EXTENSION_PATH,
  BTW_EXTENSION_PATH,
  BUILTIN_AGENTS_DIR,
  PERMISSION_GATE_EXTENSION_PATH,
  QUESTIONNAIRE_EXTENSION_PATH,
  REWIND_CODE_EXTENSION_PATH,
  SUBAGENT_EXTENSION_PATH,
  TODO_EXTENSION_PATH,
} from "./constants.ts";
import { resolvePiBinary } from "./_resolve.ts";
import type { BridgeConfig } from "./bridge/types.ts";

let piPathCache: string | undefined;
let piExistsCache: boolean | undefined;

/** Invalidate the cached pi binary resolution; call when `pi-agent-studio.path` changes. */
export function invalidatePiBinaryCache(): void {
  piPathCache = undefined;
  piExistsCache = undefined;
}

export function findPiBinary(): string {
  if (piPathCache !== undefined) return piPathCache;
  const config = vscode.workspace.getConfiguration("pi-agent-studio");
  piPathCache = resolvePiBinary({
    customPath: config.get<string>("path") || undefined,
    workspaceDirs: (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath),
  });
  return piPathCache;
}

export function normalizePiSpawnTarget(
  piPath: string,
  args: readonly string[],
): { command: string; args: string[] } {
  if (process.platform !== "win32") {
    return { command: piPath, args: [...args] };
  }
  const lower = piPath.toLowerCase();
  if (lower.endsWith(".cmd") || lower.endsWith(".bat")) {
    return { command: "cmd.exe", args: ["/d", "/s", "/c", piPath, ...args] };
  }
  if (lower.endsWith(".ps1")) {
    const quoteSingle = (s: string) => `'${s.replace(/'/g, "''")}'`;
    const ps =
      `& ${quoteSingle(piPath)}` + (args.length ? " " + args.map(quoteSingle).join(" ") : "");
    return {
      command: "powershell.exe",
      args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", ps],
    };
  }
  return { command: piPath, args: [...args] };
}

export async function ensurePiBinary(): Promise<string | undefined> {
  const piPath = findPiBinary();

  if (piExistsCache === undefined) {
    try {
      accessSync(piPath, process.platform === "win32" ? constants.F_OK : constants.X_OK);
      piExistsCache = true;
    } catch {
      piExistsCache = false;
    }
  }

  if (piExistsCache) return piPath;
  // Installing / upgrading pi is the host machine's job, not the extension's —
  // without the binary the extension simply stays idle.
  return undefined;
}

/**
 * Build the pi CLI argument list (without the binary itself).
 */
export function createPiShellArgs(options: {
  extensionUri: vscode.Uri;
  sessionFile?: string;
  extraArgs?: string[];
}): string[] {
  const userArgs = vscode.workspace.getConfiguration("pi-agent-studio").get<string[]>("args") ?? [];
  const extensionArgs = [
    "-e",
    join(options.extensionUri.fsPath, BRIDGE_EXTENSION_PATH),
    "-e",
    join(options.extensionUri.fsPath, TODO_EXTENSION_PATH),
    "-e",
    join(options.extensionUri.fsPath, QUESTIONNAIRE_EXTENSION_PATH),
    "-e",
    join(options.extensionUri.fsPath, SUBAGENT_EXTENSION_PATH),
    "-e",
    join(options.extensionUri.fsPath, BTW_EXTENSION_PATH),
    "-e",
    join(options.extensionUri.fsPath, PERMISSION_GATE_EXTENSION_PATH),
    "-e",
    join(options.extensionUri.fsPath, REWIND_CODE_EXTENSION_PATH),
  ];
  const args = options.sessionFile
    ? [
        "--session",
        options.sessionFile,
        ...extensionArgs,
        ...userArgs,
        ...(options.extraArgs ?? []),
      ]
    : [...extensionArgs, ...userArgs, ...(options.extraArgs ?? [])];
  return args;
}

export function createPiEnvironment(
  bridgeConfig: BridgeConfig | undefined,
  extensionUri?: vscode.Uri,
): Record<string, string> | undefined {
  if (!bridgeConfig && !extensionUri) return undefined;
  const config = vscode.workspace.getConfiguration("pi-agent-studio");
  const statusBar = config.get<boolean>("statusBar") ?? true;
  const disabledTools = config.get<string[]>("disabledTools") ?? [];
  const permissionMode = config.get<string>("permission.mode") ?? "AskForApproval";
  const dangerousPatterns = config.get<string[]>("permission.dangerousPatterns") ?? [];
  const env: Record<string, string> = {
    PI_VSCODE_STATUS_BAR: statusBar ? "1" : "0",
    PI_VSCODE_DISABLED_TOOLS: JSON.stringify(disabledTools),
    PI_VSCODE_PERMISSION: JSON.stringify({ mode: permissionMode, patterns: dangerousPatterns }),
  };
  if (bridgeConfig) {
    env.PI_VSCODE_BRIDGE_TOKEN = bridgeConfig.token;
    if (bridgeConfig.socketPath) env.PI_VSCODE_BRIDGE_SOCKET = bridgeConfig.socketPath;
    else if (bridgeConfig.url) env.PI_VSCODE_BRIDGE_URL = bridgeConfig.url;
  }
  if (extensionUri) {
    env.PI_VSCODE_BUILTIN_AGENTS_DIR = join(extensionUri.fsPath, BUILTIN_AGENTS_DIR);
  }
  return env;
}

/** Build pi CLI args for a `pi --mode rpc` subprocess (chat webview). */
export function createRpcShellArgs(options: {
  extensionUri: vscode.Uri;
  sessionFile?: string;
  extraArgs?: string[];
}): string[] {
  const userArgs = vscode.workspace.getConfiguration("pi-agent-studio").get<string[]>("args") ?? [];
  const extensionArgs = [
    "-e",
    join(options.extensionUri.fsPath, BRIDGE_EXTENSION_PATH),
    "-e",
    join(options.extensionUri.fsPath, TODO_EXTENSION_PATH),
    "-e",
    join(options.extensionUri.fsPath, QUESTIONNAIRE_EXTENSION_PATH),
    "-e",
    join(options.extensionUri.fsPath, SUBAGENT_EXTENSION_PATH),
    "-e",
    join(options.extensionUri.fsPath, BTW_EXTENSION_PATH),
    "-e",
    join(options.extensionUri.fsPath, PERMISSION_GATE_EXTENSION_PATH),
    "-e",
    join(options.extensionUri.fsPath, REWIND_CODE_EXTENSION_PATH),
  ];
  const base = ["--mode", "rpc"];
  return options.sessionFile
    ? [
        "--session",
        options.sessionFile,
        ...extensionArgs,
        ...base,
        ...userArgs,
        ...(options.extraArgs ?? []),
      ]
    : [...extensionArgs, ...base, ...userArgs, ...(options.extraArgs ?? [])];
}

/** User-provided env overrides (merged over process.env by the spawner). */
export function createRpcEnvironment(
  bridgeConfig?: BridgeConfig,
  extensionUri?: vscode.Uri,
): Record<string, string> {
  const userEnv =
    vscode.workspace.getConfiguration("pi-agent-studio").get<Record<string, string>>("env") ?? {};
  const bridgeEnv = createPiEnvironment(bridgeConfig, extensionUri) ?? {};
  return { ...userEnv, ...bridgeEnv };
}

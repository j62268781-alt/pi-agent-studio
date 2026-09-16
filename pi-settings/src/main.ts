import codiconTtf from "@vscode/codicons/dist/codicon.ttf?inline";
import "pi-ui/tokens.css";
import "./style.css";
import { vscode } from "./globals";
import { t } from "./i18n";
import { renderModelsTab, handleOAuthProgress, setModelsTabActive } from "./tabs/models";
import { renderAgentsTab } from "./tabs/agents";
import { renderPromptsTab } from "./tabs/prompts";
import { renderSkillsTab } from "./tabs/skills";
import { renderMcpTab } from "./tabs/mcp";
import { renderCommitTab } from "./tabs/commit";
import { renderSysPromptTab } from "./tabs/sysprompt";
import { renderSettingsTab } from "./tabs/settings";

const codiconStyle = document.createElement("style");
codiconStyle.textContent =
  '@font-face{font-family:"codicon";font-display:block;src:url(' +
  codiconTtf +
  ') format("truetype")}';
document.head.prepend(codiconStyle);

if (typeof (window as any).__PI_FONTSIZE__ === "number" && (window as any).__PI_FONTSIZE__ > 0) {
  document.documentElement.style.setProperty("--fs", (window as any).__PI_FONTSIZE__ + "px");
}

function initStaticI18n() {
  const title = document.querySelector(".nav-title");
  if (title) title.textContent = t("Pi Settings");
  const reload = document.querySelector(
    '.nav-icon-btn[data-action="reload"]',
  ) as HTMLElement | null;
  if (reload) reload.title = t("Reload");
  const labels: Record<string, string> = {
    models: t("Models"),
    agents: t("Agents"),
    prompts: t("Prompt Templates"),
    skills: t("Skills"),
    mcp: t("MCP Servers"),
    commit: t("Commit Message"),
    sysprompt: t("System Prompt"),
    settings: t("Settings"),
  };
  const tabBtns = document.querySelectorAll(".nav-tab");
  for (const b of tabBtns) {
    const label = b.querySelector(".nav-label");
    const tab = (b as HTMLElement).dataset.tab;
    if (label && tab && labels[tab]) label.textContent = labels[tab];
  }
  const ph = document.querySelector(".tab-placeholder");
  if (ph) ph.textContent = t("Select a tab to get started");
}
initStaticI18n();

const nav = document.querySelector(".nav")!;
let content = document.getElementById("content")!;

// No collapse control. The settings UI only ever opens as an editor-area
// WebviewPanel (see openSettingsPanel), which settings-panel.ts moves into its
// own window — so the sidebar is never narrow enough to warrant one. Narrow
// containers get a CSS-only fallback instead; there is no toggle state to keep.

let activeTab = "models";
const tabData: Record<string, any> = {};

nav.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".nav-tab");
  if (!btn) return;
  const tab = btn.dataset.tab;
  if (!tab || tab === activeTab) return;
  switchTab(tab);
});

document.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".nav-icon-btn[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;
  if (action === "reload") vscode.postMessage({ type: "refresh", tab: activeTab });
});

function switchTab(tab: string) {
  const prev = nav.querySelector(".nav-tab.active");
  if (prev) prev.classList.remove("active");
  const next = nav.querySelector(`.nav-tab[data-tab="${tab}"]`);
  if (next) next.classList.add("active");
  activeTab = tab;
  setModelsTabActive(tab === "models");
  content.innerHTML = '<div class="tab-placeholder">' + t("Loading…") + "</div>";
  vscode.postMessage({ type: "tabLoad", tab });
}

function showToast(text: string, kind?: string) {
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();
  const toast = document.createElement("div");
  toast.className = "toast" + (kind ? " " + kind : "");
  toast.textContent = text;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 200);
  }, 3000);
}

window.addEventListener("message", (ev) => {
  const msg = ev.data;
  if (!msg || typeof msg.type !== "string") return;
  switch (msg.type) {
    case "init":
      if (msg.initialTab && msg.initialTab !== activeTab) switchTab(msg.initialTab);
      setModelsTabActive(activeTab === "models");
      vscode.postMessage({ type: "tabLoad", tab: activeTab });
      break;
    case "setTab":
      if (msg.tab && msg.tab !== activeTab) switchTab(msg.tab);
      break;
    case "error":
      showToast(msg.message || t("Unknown error"), "error");
      break;
    case "tabData":
      tabData[msg.tab] = msg.data;
      if (activeTab === msg.tab) renderTab(msg.tab, msg.data);
      break;
    case "oauthProgress":
      handleOAuthProgress(msg.event);
      break;
    case "saved":
      if (msg.what === "system") showToast(t("System prompt saved"), "success");
      else if (msg.what === "append") showToast(t("Append prompt saved"), "success");
      else if (msg.what === "commit") showToast(t("Commit message settings saved"), "success");
      else if (msg.what === "mcp") showToast(t("MCP settings saved"), "success");
      else if (msg.what === "settings")
        showToast(t("Settings saved — restart pi to apply"), "success");
      break;
    default:
      break;
  }
});

function renderTab(tab: string, data: any) {
  const fresh = content.cloneNode(false) as HTMLElement;
  content.replaceWith(fresh);
  content = fresh;
  const loader = tabRenderers[tab];
  if (loader) {
    loader(content, data);
  } else {
    content.innerHTML =
      '<div class="tab-placeholder">' + t('Tab "{0}" not yet implemented', tab) + "</div>";
  }
}

const tabRenderers: Record<string, (parent: HTMLElement, data: any) => void> = {
  models: renderModelsTab,
  agents: renderAgentsTab,
  prompts: renderPromptsTab,
  skills: renderSkillsTab,
  mcp: renderMcpTab,
  commit: renderCommitTab,
  sysprompt: renderSysPromptTab,
  settings: renderSettingsTab,
};

vscode.postMessage({ type: "ready" });

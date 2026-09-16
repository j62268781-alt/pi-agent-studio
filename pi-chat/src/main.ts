// pi-chat webview entry point
import codiconTtf from "@vscode/codicons/dist/codicon.ttf?inline";
import piLogoSvg from "../../assets/icon.svg?raw";
import "pi-ui/tokens.css";
import "./style.css";
import { setModelIconFns, vscode } from "./globals";
import { getModelIcon, modelIconHtml, escHtml } from "./model-icons";
import { t } from "./i18n";
import "./messages";
import "./composer";
import "./rewind";

const codiconStyle = document.createElement("style");
codiconStyle.textContent =
  '@font-face{font-family:"codicon";font-display:block;src:url(' +
  codiconTtf +
  ') format("truetype")}';
document.head.prepend(codiconStyle);

setModelIconFns(getModelIcon, modelIconHtml, escHtml);

if (typeof (window as any).__PI_FONTSIZE__ === "number" && (window as any).__PI_FONTSIZE__ > 0) {
  document.documentElement.style.setProperty("--chat-fs", (window as any).__PI_FONTSIZE__ + "px");
}

const piBgImage = (window as any).__PI_BG_IMAGE__;
if (piBgImage) {
  document.documentElement.style.setProperty(
    "--pi-bg-image",
    `url("${String(piBgImage).replace(/"/g, '\\"')}")`,
  );
  document.documentElement.style.setProperty("--pi-bg-blur", "blur(8px)");
  document.documentElement.style.setProperty("--pi-bg-on", "1");
}
const piBgOpacity = (window as any).__PI_BG_OPACITY__;
if (typeof piBgOpacity === "number") {
  document.documentElement.style.setProperty(
    "--pi-bg-opacity",
    String(Math.min(1, Math.max(0, piBgOpacity))),
  );
}

const inputEl = document.getElementById("input") as HTMLDivElement | null;
if (inputEl) {
  inputEl.setAttribute("data-placeholder", t("Ask anything…  (use / for commands, @ for files)"));
}
const modelSearchEl = document.getElementById("model-search") as HTMLInputElement | null;
if (modelSearchEl) {
  modelSearchEl.placeholder = t("Search models…");
}
const scrollBtn = document.getElementById("scroll-bottom-btn");
if (scrollBtn) scrollBtn.title = t("Scroll to bottom");
const ctxCopy = document.getElementById("ctx-copy");
if (ctxCopy) ctxCopy.textContent = t("Copy");
const ctxFork = document.getElementById("ctx-fork");
if (ctxFork) ctxFork.textContent = t("Fork from here");
const ctxRevert = document.getElementById("ctx-revert");
if (ctxRevert) ctxRevert.textContent = t("Revert here");

// Fork change: boot splash — stay up over the empty chat until the session history has actually
// rendered, then fade out. History's thinking blocks collapse on arrival (live thinking still
// auto-expands while streaming and folds when the turn ends); a 10s timer guards against a
// stuck handshake.
const splash = document.getElementById("boot-splash");
let splashGone = false;
let bootFailed = false;
const bootLogo = document.querySelector(".boot-logo");
if (bootLogo) bootLogo.innerHTML = piLogoSvg;
function dismissSplash() {
  if (splashGone || bootFailed) return;
  splashGone = true;
  if (!splash) return;
  splash.classList.add("is-done");
  // The element is kept rather than removed: a failed start needs to bring the
  // splash back for its failure card.
  setTimeout(function () {
    splash.style.display = "none";
  }, 400);
}

// The old extension-side loading screen is gone, so this splash is now the only
// surface for "the session failed to start" — and the retry affordance moved
// here with it. The host still posts `sessionFailed` and accepts `startSession`.
const bootCard = document.querySelector(".boot-card");
const bootError = document.getElementById("boot-error");
const bootErrorMsg = document.getElementById("boot-error-msg");
const bootRetry = document.getElementById("boot-retry");
const bootDots = document.querySelector<HTMLElement>(".boot-dots");
function showBootFailure(message: string) {
  bootFailed = true;
  if (splash) {
    splash.classList.remove("is-done");
    splash.style.display = "flex";
  }
  // Failure swaps the dots for the message and the retry button.
  if (bootDots) bootDots.style.display = "none";
  if (bootCard) bootCard.classList.add("is-failed");
  if (bootError) bootError.style.display = "flex";
  if (bootErrorMsg) bootErrorMsg.textContent = message || t("Failed to start the session.");
}
if (bootRetry) {
  bootRetry.textContent = t("Retry");
  bootRetry.addEventListener("click", function () {
    bootFailed = false;
    if (bootCard) bootCard.classList.remove("is-failed");
    if (bootError) bootError.style.display = "none";
    if (bootDots) bootDots.style.display = "flex";
    if (splash) splash.style.opacity = "1";
    vscode.postMessage({ type: "startSession" });
  });
}
window.addEventListener("message", function (ev) {
  const d = ev.data;
  if (!d || typeof d !== "object") return;
  if (d.type === "history") {
    document.querySelectorAll("details.thinking-block[open]").forEach(function (det) {
      det.removeAttribute("open");
    });
    dismissSplash();
  } else if (d.type === "sessionFailed") {
    showBootFailure(String(d.message || ""));
  } else if (d.type === "error" && !bootFailed) {
    dismissSplash();
  }
});
setTimeout(dismissSplash, 10000);

window.addEventListener("load", () => {
  vscode.postMessage({ type: "webviewReady" });
});

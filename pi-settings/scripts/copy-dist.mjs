import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, "dist", "index.html");
const dest = join(root, "..", "src", "modules", "settings", "settings-dist.html");
mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);
console.log("[pi-settings] copied dist/index.html -> src/modules/settings/settings-dist.html");

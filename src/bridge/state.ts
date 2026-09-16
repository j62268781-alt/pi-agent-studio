import { randomUUID } from "node:crypto";
import type { BridgeState } from "./types.ts";

const MAX_NOTIFICATIONS = 100;
const MAX_CODE_ACTIONS = 100;

export function createBridgeState(initialSelection: BridgeState["latestSelection"]): BridgeState {
  return {
    latestSelection: initialSelection,
    notifications: [],
    codeActions: new Map(),
    enqueue(type, data) {
      this.notifications.push({ id: randomUUID(), type, data, timestamp: Date.now() });
      if (this.notifications.length > MAX_NOTIFICATIONS) {
        this.notifications.splice(0, this.notifications.length - MAX_NOTIFICATIONS);
      }
    },
    cacheCodeAction(action, filePath) {
      const id = randomUUID();
      this.codeActions.set(id, { action, filePath });
      while (this.codeActions.size > MAX_CODE_ACTIONS) {
        const oldest = this.codeActions.keys().next().value;
        if (!oldest) break;
        this.codeActions.delete(oldest);
      }
      return id;
    },
    // Terminal-run pi instances no longer exist: the terminal UI mode and the
    // terminal/session tracking were removed. The handlers that consult these
    // safely ignore the empty results.
    reportTerminalSession() {},
    findTerminalSession() {
      return undefined;
    },
  };
}

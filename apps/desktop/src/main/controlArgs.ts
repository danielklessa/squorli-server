import type { ControlAction } from "@squorli/web/platform/bridge";
import { KEYLESS_CONTROL_ACTIONS, parseControlAction, parseControlLink } from "@squorli/web/platform/hotkeys";
import { timingSafeEqual } from "node:crypto";

const sameKey = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * A command in the arguments of a second start (docs/features/hotkeys.md): `squorli://control/<action>` as the system
 * hands a link over, or `--control=<action>` from a command line (G Hub's "launch application", a macro). The first valid
 * one counts, everything else is ignored. A link whose action could open the microphone needs the installation's `key`
 * (`KEYLESS_CONTROL_ACTIONS` in platform/hotkeys.ts: any web page can open a link; the command line comes from a program on
 * this computer and needs none). Pure (tested) and free of Electron imports.
 */
export function findControl(argv: readonly string[], key: string): ControlAction | null {
  for (const arg of argv) {
    const lower = arg.toLowerCase();
    if (lower.startsWith("--control=")) { const action = parseControlAction(arg.slice("--control=".length)); if (action) return action; }
    else if (lower.startsWith("squorli:")) {
      const link = parseControlLink(arg);
      if (link && (KEYLESS_CONTROL_ACTIONS.includes(link.action) || (link.key !== null && sameKey(link.key, key)))) return link.action;
    }
  }
  return null;
}

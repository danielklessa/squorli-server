import type { ControlAction } from "@squorli/web/platform/bridge";
import { parseControlAction } from "@squorli/web/platform/hotkeys";

/**
 * A command in the arguments of a second start (docs/features/hotkeys.md): `squorli://control/<action>` as the system
 * hands a link over, or `--control=<action>` from a command line (G Hub's "launch application", a macro). The first valid
 * one counts, everything else is ignored. Pure (tested) and free of Electron imports.
 */
export function findControl(argv: readonly string[]): ControlAction | null {
  for (const arg of argv) {
    const lower = arg.toLowerCase();
    if (lower.startsWith("--control=")) { const action = parseControlAction(arg.slice("--control=".length)); if (action) return action; }
    else if (lower.startsWith("squorli:")) { const action = parseControlAction(arg); if (action) return action; }
  }
  return null;
}

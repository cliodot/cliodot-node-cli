import { runStart } from "./start.js";
import { runStop } from "./stop.js";

export async function runRestart(opts: { dir?: string }): Promise<void> {
  await runStop(opts);
  await runStart(opts);
}

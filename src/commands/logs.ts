import { composeLogs } from "../runtime/docker/compose.js";
import { ensureDockerAvailable } from "../runtime/docker/ghcr.js";
import { nativeLogs } from "../runtime/native/process.js";
import { readInstance, resolveInstanceDir } from "../util/fs.js";

export async function runLogs(opts: { dir?: string; follow?: boolean }): Promise<void> {
  const dir = resolveInstanceDir(opts.dir);
  const instance = readInstance(dir);
  const follow = Boolean(opts.follow);

  if (instance.runtime === "docker") {
    ensureDockerAvailable();
    const code = composeLogs(dir, follow);
    if (code !== 0) process.exitCode = code;
  } else {
    nativeLogs(dir, follow);
  }
}

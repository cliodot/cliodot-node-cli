import * as p from "@clack/prompts";
import { composeUp } from "../runtime/docker/compose.js";
import { ensureDockerAvailable } from "../runtime/docker/ghcr.js";
import { nativeStart } from "../runtime/native/process.js";
import { readInstance, resolveInstanceDir } from "../util/fs.js";

export async function runStart(opts: { dir?: string }): Promise<void> {
  const dir = resolveInstanceDir(opts.dir);
  const instance = readInstance(dir);
  const spinner = p.spinner();
  spinner.start(`Starting (${instance.runtime})`);

  if (instance.runtime === "docker") {
    ensureDockerAvailable();
    const code = composeUp(dir);
    spinner.stop(code === 0 ? "Compose up" : "Compose failed");
    if (code !== 0) process.exitCode = code;
  } else {
    try {
      const pids = nativeStart(dir, instance);
      spinner.stop(
        pids.api != null
          ? `API ${pids.api}, client ${pids.client}`
          : `client ${pids.client}`
      );
    } catch (err) {
      spinner.stop("Start failed");
      p.log.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  }
}

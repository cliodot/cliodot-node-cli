import * as p from "@clack/prompts";
import { composeDown } from "../runtime/docker/compose.js";
import { ensureDockerAvailable } from "../runtime/docker/ghcr.js";
import { nativeStop } from "../runtime/native/process.js";
import { readInstance, resolveInstanceDir } from "../util/fs.js";

export async function runStop(opts: { dir?: string }): Promise<void> {
  const dir = resolveInstanceDir(opts.dir);
  const instance = readInstance(dir);
  const spinner = p.spinner();
  spinner.start(`Stopping (${instance.runtime})`);

  if (instance.runtime === "docker") {
    ensureDockerAvailable();
    const code = composeDown(dir);
    spinner.stop(code === 0 ? "Compose down" : "Compose failed");
    if (code !== 0) process.exitCode = code;
  } else {
    nativeStop(dir);
    spinner.stop("Native processes stopped");
  }
}

import * as p from "@clack/prompts";
import { dockerLoginGhcr, ensureDockerAvailable } from "../runtime/docker/ghcr.js";
import { validateGithubTokenForReleases } from "../runtime/native/tarball.js";
import { CLI_DEFAULTS } from "../config.js";
import { getGithubToken, readInstance, resolveInstanceDir } from "../util/fs.js";

export async function runLogin(opts: { dir?: string; token?: string }): Promise<void> {
  if (opts.token) {
    process.env.GHCR_TOKEN = opts.token;
    process.env.GITHUB_TOKEN = opts.token;
  }

  let runtime: "docker" | "native" | "both" = "both";
  try {
    const dir = resolveInstanceDir(opts.dir);
    const instance = readInstance(dir);
    runtime = instance.runtime;
  } catch {
    /* no instance yet */
  }

  if (runtime === "docker" || runtime === "both") {
    try {
      ensureDockerAvailable();
      const code = dockerLoginGhcr(opts.token || getGithubToken());
      if (code === 0) p.log.success("docker login ghcr.io ok");
      else {
        p.log.error("docker login failed");
        process.exitCode = 1;
      }
    } catch (err) {
      p.log.warn(err instanceof Error ? err.message : String(err));
    }
  }

  if (runtime === "native" || runtime === "both") {
    let repo: string = CLI_DEFAULTS.releaseRepo;
    try {
      const dir = resolveInstanceDir(opts.dir);
      repo = readInstance(dir).releaseRepo || repo;
    } catch {
      /* default */
    }
    const check = validateGithubTokenForReleases(repo);
    if (check.ok) p.log.success(check.message);
    else {
      p.log.error(check.message);
      process.exitCode = 1;
    }
  }
}

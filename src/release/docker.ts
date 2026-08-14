import path from "path";
import { CLI_DEFAULTS } from "../config.js";
import { dockerLoginGhcr, ensureDockerAvailable } from "../runtime/docker/ghcr.js";
import { runCommand } from "../util/fs.js";
import { ensureGhcrPackageVisibility } from "./github.js";

export async function buildAndPushApiImage(opts: {
  repoRoot: string;
  version: string;
  image?: string;
  push: boolean;
  public?: boolean;
  dockerfile?: string;
}): Promise<string[]> {
  ensureDockerAvailable();
  if (opts.push) {
    dockerLoginGhcr();
  }
  const image = opts.image || CLI_DEFAULTS.serverImage;
  const tags = [opts.version, "latest"];
  const dockerfile = opts.dockerfile || "Dockerfile";
  const tagArgs = tags.flatMap((t) => ["-t", `${image}:${t}`]);
  const build = runCommand(
    "docker",
    ["build", "-f", dockerfile, ...tagArgs, "."],
    { cwd: opts.repoRoot, inherit: true }
  );
  if (build.status !== 0) {
    throw new Error("docker build failed for API image");
  }
  if (opts.push) {
    for (const t of tags) {
      const push = runCommand("docker", ["push", `${image}:${t}`], {
        cwd: opts.repoRoot,
        inherit: true,
      });
      if (push.status !== 0) {
        throw new Error(`docker push failed for ${image}:${t}`);
      }
    }
    await ensureGhcrPackageVisibility({
      image,
      visibility: opts.public ? "public" : "private",
    });
  }
  return tags.map((t) => `${image}:${t}`);
}

export async function buildAndPushClientImage(opts: {
  clientDir: string;
  version: string;
  image?: string;
  push: boolean;
  public?: boolean;
  dockerfile?: string;
}): Promise<string[]> {
  ensureDockerAvailable();
  if (opts.push) {
    dockerLoginGhcr();
  }
  const image = opts.image || CLI_DEFAULTS.clientImage;
  const tags = [opts.version, "latest"];
  const dockerfile = opts.dockerfile || "Dockerfile";
  const tagArgs = tags.flatMap((t) => ["-t", `${image}:${t}`]);
  const build = runCommand(
    "docker",
    ["build", "-f", dockerfile, ...tagArgs, "."],
    { cwd: opts.clientDir, inherit: true }
  );
  if (build.status !== 0) {
    throw new Error("docker build failed for client image");
  }
  if (opts.push) {
    for (const t of tags) {
      const push = runCommand("docker", ["push", `${image}:${t}`], {
        cwd: opts.clientDir,
        inherit: true,
      });
      if (push.status !== 0) {
        throw new Error(`docker push failed for ${image}:${t}`);
      }
    }
    await ensureGhcrPackageVisibility({
      image,
      visibility: opts.public ? "public" : "private",
    });
  }
  return tags.map((t) => `${image}:${t}`);
}

export function resolveClientDir(explicit?: string): string | undefined {
  if (!explicit) return undefined;
  return path.resolve(explicit);
}

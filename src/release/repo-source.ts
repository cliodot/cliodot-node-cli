import fs from "fs";
import path from "path";
import { getGithubToken, runCommand } from "../util/fs.js";
import { ensureDir, findRepoRoot, rmrf } from "./util.js";
import { CLI_DEFAULTS } from "../config.js";

export type ResolvedWorkspace = {
  dir: string;
  source: "local" | "clone";
  repo?: string;
};

export async function resolveGithubWorkspace(opts: {
  label: string;
  localDir?: string;
  repo?: string;
  version: string;
  cacheRoot: string;
  ref?: string;
  preferLocalServerRoot?: boolean;
}): Promise<ResolvedWorkspace> {
  if (opts.localDir) {
    const dir = path.resolve(opts.localDir);
    if (!fs.existsSync(dir)) {
      throw new Error(`${opts.label} directory not found: ${dir}`);
    }
    return { dir, source: "local" };
  }

  if (opts.preferLocalServerRoot) {
    const root = findRepoRoot();
    if (fs.existsSync(path.join(root, "package.json"))) {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(root, "package.json"), "utf8")
      ) as { name?: string };
      if (pkg.name === "cliodot-api" || fs.existsSync(path.join(root, "src", "app.ts"))) {
        return { dir: root, source: "local", repo: opts.repo };
      }
    }
  }

  const repo = opts.repo;
  if (!repo) {
    throw new Error(
      `${opts.label}: pass --dir for a local checkout or configure a GitHub repo.`
    );
  }

  const token = getGithubToken();
  if (!token) {
    throw new Error(
      `GITHUB_TOKEN / GHCR_TOKEN required to clone ${opts.label} repo ${repo}.`
    );
  }

  await assertRepoAccessible(repo, token, opts.label);

  const ref = opts.ref || `v${opts.version.replace(/^v/, "")}`;
  const dest = path.join(
    opts.cacheRoot,
    `${opts.label}-src`,
    repo.replace("/", "__")
  );
  rmrf(dest);
  ensureDir(path.dirname(dest));

  const authUrl = `https://x-access-token:${token}@github.com/${repo}.git`;
  const clone = runCommand(
    "git",
    ["clone", "--depth", "1", "--branch", ref, authUrl, dest],
    { inherit: false }
  );

  if (clone.status !== 0) {
    const fallback = runCommand(
      "git",
      ["clone", "--depth", "1", authUrl, dest],
      { inherit: false }
    );
    if (fallback.status !== 0) {
      throw new Error(
        `Failed to clone ${repo} for ${opts.label} (tried ref ${ref} then default branch).\n` +
          `${clone.stderr || clone.stdout}\n${fallback.stderr || fallback.stdout}`
      );
    }
  }

  scrubRemoteAuth(dest);
  return { dir: dest, source: "clone", repo };
}

export async function resolveCliPackageDir(opts: {
  cliDir?: string;
  cliRepo?: string;
  version: string;
  cacheRoot: string;
  ref?: string;
}): Promise<ResolvedWorkspace> {
  if (opts.cliDir) {
    const dir = path.resolve(opts.cliDir);
    if (!fs.existsSync(path.join(dir, "package.json"))) {
      throw new Error(`CLI package.json not found in ${dir}`);
    }
    return { dir, source: "local" };
  }

  const monorepoCli = path.join(
    findRepoRoot(),
    CLI_DEFAULTS.cliPackagePath
  );
  if (fs.existsSync(path.join(monorepoCli, "package.json"))) {
    return { dir: monorepoCli, source: "local", repo: opts.cliRepo };
  }

  const cloned = await resolveGithubWorkspace({
    label: "cli",
    repo: opts.cliRepo,
    version: opts.version,
    cacheRoot: opts.cacheRoot,
    ref: opts.ref,
  });

  const nested = path.join(cloned.dir, CLI_DEFAULTS.cliPackagePath);
  if (fs.existsSync(path.join(nested, "package.json"))) {
    return { dir: nested, source: "clone", repo: cloned.repo };
  }
  return cloned;
}

async function assertRepoAccessible(
  repo: string,
  token: string,
  label: string
): Promise<void> {
  const res = await fetch(`https://api.github.com/repos/${repo}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "cliodot-cli",
    },
  });
  if (!res.ok) {
    throw new Error(
      `Cannot access ${label} repo ${repo} (HTTP ${res.status}). Check name/token.`
    );
  }
}

function scrubRemoteAuth(repoDir: string): void {
  runCommand(
    "git",
    ["remote", "set-url", "origin", "https://github.com/scrubbed"],
    { cwd: repoDir, inherit: false }
  );
}

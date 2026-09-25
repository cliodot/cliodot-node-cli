import fs from "fs";
import path from "path";
import { getGithubToken, runCommand } from "../util/fs.js";
import { ensureDir, rmrf } from "./util.js";

function copyDir(
  src: string,
  dest: string,
  skipNames: Set<string> = new Set(["node_modules", ".git"])
): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (skipNames.has(entry.name)) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to, skipNames);
    else fs.copyFileSync(from, to);
  }
}

async function defaultBranch(repo: string, token: string): Promise<string> {
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
      `Cannot resolve default branch for ${repo} (HTTP ${res.status})`
    );
  }
  const json = (await res.json()) as { default_branch?: string };
  return json.default_branch || "main";
}

function wipeWorktree(dir: string): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    rmrf(path.join(dir, entry.name));
  }
}

export async function forcePushCommunityMirror(opts: {
  repo: string;
  stagingDir: string;
  version: string;
  kind: "server" | "client";
  workRoot: string;
}): Promise<string> {
  const token = getGithubToken();
  if (!token) {
    throw new Error(
      "GITHUB_TOKEN / GHCR_TOKEN required to force-push community release mirrors."
    );
  }
  if (!fs.existsSync(opts.stagingDir)) {
    throw new Error(`Staging directory not found: ${opts.stagingDir}`);
  }

  const branch = await defaultBranch(opts.repo, token);
  const mirrorRoot = path.join(
    opts.workRoot,
    ".cliodot-release",
    "community-mirror",
    opts.kind,
    opts.version
  );
  rmrf(mirrorRoot);
  ensureDir(path.dirname(mirrorRoot));

  const authUrl = `https://x-access-token:${token}@github.com/${opts.repo}.git`;
  const clone = runCommand(
    "git",
    ["clone", "--depth", "1", "--branch", branch, authUrl, mirrorRoot],
    { inherit: false }
  );
  if (clone.status !== 0) {
    ensureDir(mirrorRoot);
    const init = runCommand("git", ["init", "-b", branch], {
      cwd: mirrorRoot,
      inherit: false,
    });
    if (init.status !== 0) {
      throw new Error(
        `Failed to prepare community mirror checkout for ${opts.repo}: ${
          clone.stderr || clone.stdout || init.stderr || init.stdout
        }`
      );
    }
    runCommand("git", ["remote", "add", "origin", authUrl], {
      cwd: mirrorRoot,
      inherit: false,
    });
  }

  const licensePath = path.join(mirrorRoot, "LICENSE");
  const licenseBackup = fs.existsSync(licensePath)
    ? fs.readFileSync(licensePath)
    : null;

  wipeWorktree(mirrorRoot);
  copyDir(
    opts.stagingDir,
    mirrorRoot,
    new Set(["node_modules", ".git", "src"])
  );

  if (!fs.existsSync(path.join(mirrorRoot, "LICENSE")) && licenseBackup) {
    fs.writeFileSync(licensePath, licenseBackup);
  }

  const readme = path.join(mirrorRoot, "README.md");
  if (!fs.existsSync(readme)) {
    fs.writeFileSync(
      readme,
      [
        `# Cliodot ${opts.repo.includes("enterprise") ? "enterprise" : "community"} ${opts.kind}`,
        "",
        `Published build for version \`${opts.version}\`.`,
        "",
        "Install via `@cliodot/cli` releases, or download the release tarball.",
        "",
      ].join("\n"),
      "utf8"
    );
  }

  runCommand("git", ["add", "-A"], { cwd: mirrorRoot, inherit: false });
  const status = runCommand("git", ["status", "--porcelain"], {
    cwd: mirrorRoot,
    inherit: false,
  });
  if ((status.stdout || "").trim()) {
    const commit = runCommand(
      "git",
      [
        "-c",
        "user.name=cliodot-cli",
        "-c",
        "user.email=release@cliodot.com",
        "commit",
        "-m",
        `Release ${opts.kind} ${opts.version}`,
      ],
      { cwd: mirrorRoot, inherit: false }
    );
    if (commit.status !== 0) {
      throw new Error(
        `Failed to commit community mirror for ${opts.repo}: ${
          commit.stderr || commit.stdout
        }`
      );
    }
  }

  const push = runCommand(
    "git",
    ["push", "-f", "origin", `HEAD:${branch}`],
    { cwd: mirrorRoot, inherit: false }
  );
  if (push.status !== 0) {
    throw new Error(
      `Failed to force-push community mirror to ${opts.repo} (${branch}): ${
        push.stderr || push.stdout
      }`
    );
  }

  return `https://github.com/${opts.repo}/tree/${branch}`;
}

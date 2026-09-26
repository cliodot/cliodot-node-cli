import fs from "fs";
import path from "path";
import { getGithubToken, runCommand } from "../util/fs.js";
import { ensureRepoHasCommit, getRepoDefaultBranch } from "./github.js";
import { ensureDir, rmrf } from "./util.js";

function isSecretEnvFile(name: string): boolean {
  if (name === ".env.example" || name === "env.example") return false;
  return name === ".env" || name.startsWith(".env.");
}

const FULL_SOURCE_SKIP = new Set([
  "node_modules",
  ".git",
  ".DS_Store",
  ".cliodot-release",
  ".cliodot",
  ".yarn-cache",
  ".yarn",
  ".turbo",
  "coverage",
  ".nyc_output",
  ".keys",
  ".next",
]);

function shouldSkipMirrorEntry(name: string, fullSource: boolean): boolean {
  if (name === "node_modules" || name === ".git" || name === ".DS_Store") {
    return true;
  }
  if (isSecretEnvFile(name)) return true;
  if (fullSource) {
    return (
      FULL_SOURCE_SKIP.has(name) ||
      name.endsWith(".tar.gz") ||
      name.endsWith(".tgz")
    );
  }
  return name === "src";
}

function copyDir(src: string, dest: string, fullSource: boolean): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (shouldSkipMirrorEntry(entry.name, fullSource)) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to, fullSource);
    else fs.copyFileSync(from, to);
  }
}

function listGitProjectFiles(root: string): string[] | null {
  if (!fs.existsSync(path.join(root, ".git"))) return null;
  const tracked = runCommand("git", ["ls-files", "-z"], { cwd: root });
  if (tracked.status !== 0) return null;
  const extra = runCommand(
    "git",
    ["ls-files", "-z", "--others", "--exclude-standard"],
    { cwd: root }
  );
  const names = new Set<string>();
  for (const raw of [tracked.stdout, extra.stdout]) {
    for (const part of String(raw || "").split("\0")) {
      if (part) names.add(part);
    }
  }
  return [...names];
}

function shouldSkipGitRel(rel: string): boolean {
  const parts = rel.split(/[\\/]/).filter(Boolean);
  if (!parts.length) return true;
  if (parts.some((part) => FULL_SOURCE_SKIP.has(part))) return true;
  if (isSecretEnvFile(path.basename(rel))) return true;
  if (rel.endsWith(".tar.gz") || rel.endsWith(".tgz")) return true;
  return false;
}

function copyGitProject(root: string, dest: string): boolean {
  const files = listGitProjectFiles(root);
  if (!files || !files.length) return false;
  for (const rel of files) {
    if (shouldSkipGitRel(rel)) continue;
    const from = path.join(root, rel);
    if (!fs.existsSync(from) || !fs.statSync(from).isFile()) continue;
    const to = path.join(dest, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
  return true;
}

function copyReleaseBuildTree(root: string, dest: string): void {
  for (const name of ["build", "dist"]) {
    const from = path.join(root, name);
    if (!fs.existsSync(from) || !fs.statSync(from).isDirectory()) continue;
    copyDir(from, path.join(dest, name), true);
  }
}


function wipeWorktree(dir: string): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    rmrf(path.join(dir, entry.name));
  }
}

function pushMirror(cwd: string, branch: string): { status: number; stderr: string; stdout: string } {
  let last = { status: 1, stderr: "", stdout: "" };
  for (let attempt = 1; attempt <= 3; attempt++) {
    last = runCommand(
      "git",
      [
        "-c",
        "http.version=HTTP/1.1",
        "-c",
        "http.postBuffer=524288000",
        "push",
        "-f",
        "origin",
        `HEAD:${branch}`,
      ],
      { cwd, inherit: false }
    );
    if (last.status === 0) return last;
  }
  return last;
}

export async function forcePushCommunityMirror(opts: {
  repo: string;
  stagingDir: string;
  version: string;
  kind: "server" | "client";
  workRoot: string;
  /** Enterprise: copy the project source, including src. Community: staged runtime, no src. */
  fullSource?: boolean;
}): Promise<string> {
  const token = getGithubToken();
  if (!token) {
    throw new Error(
      "GITHUB_TOKEN / GHCR_TOKEN required to force-push release mirrors."
    );
  }
  if (!fs.existsSync(opts.stagingDir)) {
    throw new Error(`Source directory not found: ${opts.stagingDir}`);
  }
  const fullSource = opts.fullSource === true;

  await ensureRepoHasCommit(opts.repo);

  const branch = await getRepoDefaultBranch(opts.repo);
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
        `Failed to prepare release mirror checkout for ${opts.repo}: ${
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
  if (fullSource) {
    const copied = copyGitProject(opts.stagingDir, mirrorRoot);
    if (!copied) copyDir(opts.stagingDir, mirrorRoot, true);
    copyReleaseBuildTree(opts.stagingDir, mirrorRoot);
  } else {
    copyDir(opts.stagingDir, mirrorRoot, false);
  }

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
        `Failed to commit release mirror for ${opts.repo}: ${
          commit.stderr || commit.stdout
        }`
      );
    }
  }

  const push = pushMirror(mirrorRoot, branch);
  if (push.status !== 0) {
    throw new Error(
      `Failed to force-push release mirror to ${opts.repo} (${branch}): ${
        push.stderr || push.stdout
      }`
    );
  }

  return `https://github.com/${opts.repo}/tree/${branch}`;
}

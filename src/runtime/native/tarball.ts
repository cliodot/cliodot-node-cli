import fs from "fs";
import path from "path";
import os from "os";
import { spawnSync } from "child_process";
import { CLI_DEFAULTS } from "../../config.js";
import { getGithubToken, runCommand } from "../../util/fs.js";
import { ensureDir, rmrf } from "../../release/util.js";
import {
  missionDoneBanner,
  missionStartBanner,
  missionStatus,
} from "./mission-status.js";

export function releaseAssetNames(version: string): {
  server: string;
  client: string;
} {
  const ver = version.replace(/^v/, "");
  return {
    server: `cliodot-api-${ver}.tar.gz`,
    client: `cliodot-client-${ver}.tar.gz`,
  };
}

function githubHeaders(
  token?: string,
  accept = "application/vnd.github+json"
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: accept,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "cliodot-cli",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function githubApi(
  url: string,
  token?: string
): Promise<{ ok: boolean; status: number; json?: any; buffer?: Buffer }> {
  const res = await fetch(url, { headers: githubHeaders(token) });
  if (!res.ok) {
    return { ok: false, status: res.status };
  }
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    return { ok: true, status: res.status, json: await res.json() };
  }
  const ab = await res.arrayBuffer();
  return { ok: true, status: res.status, buffer: Buffer.from(ab) };
}

export async function resolveReleaseVersion(
  repo: string,
  version: string
): Promise<string> {
  const raw = version.trim().replace(/^v/, "") || "latest";
  if (raw.toLowerCase() !== "latest") return raw;

  const token = getGithubToken();
  const release = await githubApi(
    `https://api.github.com/repos/${repo}/releases/latest`,
    token
  );
  if (!release.ok || !release.json?.tag_name) {
    throw new Error(
      `Failed to resolve latest release on ${repo} (HTTP ${release.status}). ` +
        `Ensure the release repo is public, or set GITHUB_TOKEN.`
    );
  }
  return String(release.json.tag_name).replace(/^v/, "");
}

export function resolveNpmVersion(
  packageName: string,
  version: string
): string {
  const raw = version.trim().replace(/^v/, "") || "latest";
  if (raw.toLowerCase() !== "latest") return raw;
  const view = runCommand("npm", ["view", `${packageName}@latest`, "version"]);
  if (view.status !== 0) {
    throw new Error(
      `Failed to resolve latest version for ${packageName}: ${view.stderr || view.stdout}`
    );
  }
  const resolved = (view.stdout || "").trim();
  if (!resolved) {
    throw new Error(`npm view returned empty version for ${packageName}@latest`);
  }
  return resolved.replace(/^v/, "");
}

function flattenIfSingleRoot(dir: string): void {
  const entries = fs.readdirSync(dir).filter((e) => e !== "." && e !== "..");
  if (entries.length !== 1) return;
  const only = path.join(dir, entries[0]);
  if (!fs.statSync(only).isDirectory()) return;
  const nested = fs.readdirSync(only);
  for (const name of nested) {
    const from = path.join(only, name);
    const to = path.join(dir, name);
    if (fs.existsSync(to)) {
      fs.rmSync(to, { recursive: true, force: true });
    }
    fs.renameSync(from, to);
  }
  fs.rmSync(only, { recursive: true, force: true });
}

function installProdDeps(destDir: string): void {
  if (!fs.existsSync(path.join(destDir, "package.json"))) return;
  const ci = runCommand("npm", ["ci", "--omit=dev", "--ignore-scripts"], {
    cwd: destDir,
    inherit: true,
  });
  if (ci.status === 0) return;
  const install = runCommand(
    "npm",
    ["install", "--omit=dev", "--ignore-scripts"],
    { cwd: destDir, inherit: true }
  );
  if (install.status !== 0) {
    throw new Error(`Failed to install production deps in ${destDir}`);
  }
}

export async function installNpmPackage(opts: {
  packageName: string;
  version: string;
  destDir: string;
}): Promise<string> {
  const resolved = resolveNpmVersion(opts.packageName, opts.version);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cliodot-npm-"));
  try {
    const pack = runCommand(
      "npm",
      ["pack", `${opts.packageName}@${resolved}`, "--pack-destination", tmp],
      { inherit: false }
    );
    if (pack.status !== 0) {
      throw new Error(
        pack.stderr ||
          `npm pack failed for ${opts.packageName}@${resolved}`
      );
    }
    const packedName = (pack.stdout || "")
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .pop();
    if (!packedName) {
      throw new Error(`npm pack produced no tarball for ${opts.packageName}`);
    }
    const tgz = path.join(tmp, packedName);
    rmrf(opts.destDir);
    ensureDir(opts.destDir);
    const extract = spawnSync("tar", ["-xzf", tgz, "-C", opts.destDir], {
      encoding: "utf8",
    });
    if ((extract.status ?? 1) !== 0) {
      throw new Error(`Failed to extract ${packedName}: ${extract.stderr}`);
    }
    flattenIfSingleRoot(opts.destDir);
    const pkgRoot = path.join(opts.destDir, "package");
    if (fs.existsSync(pkgRoot) && fs.statSync(pkgRoot).isDirectory()) {
      for (const name of fs.readdirSync(pkgRoot)) {
        const from = path.join(pkgRoot, name);
        const to = path.join(opts.destDir, name);
        if (fs.existsSync(to)) fs.rmSync(to, { recursive: true, force: true });
        fs.renameSync(from, to);
      }
      fs.rmSync(pkgRoot, { recursive: true, force: true });
    }
    installProdDeps(opts.destDir);
    return resolved;
  } finally {
    rmrf(tmp);
  }
}

export async function downloadReleaseAsset(opts: {
  repo: string;
  version: string;
  assetName: string;
  destDir: string;
  onProgress?: (percent: number, receivedBytes: number, totalBytes: number, label: string) => void;
}): Promise<void> {
  const token = getGithubToken();
  const resolved = await resolveReleaseVersion(opts.repo, opts.version);
  const tag = `v${resolved}`;
  const expectedName =
    opts.assetName.includes("-latest-") ||
    opts.assetName.startsWith("cliodot-api-latest")
      ? opts.assetName
          .replace(/-latest-/, `-${resolved}-`)
          .replace(/-latest\.tar\.gz$/, `-${resolved}.tar.gz`)
      : opts.version.toLowerCase() === "latest"
        ? opts.assetName
            .replace(`cliodot-api-latest.tar.gz`, `cliodot-api-${resolved}.tar.gz`)
            .replace(
              `cliodot-client-latest.tar.gz`,
              `cliodot-client-${resolved}.tar.gz`
            )
        : opts.assetName;

  opts.onProgress?.(0, 0, 0, "briefing");

  const releaseUrl = `https://api.github.com/repos/${opts.repo}/releases/tags/${tag}`;
  const release = await githubApi(releaseUrl, token);
  if (!release.ok || !release.json) {
    throw new Error(
      `Failed to fetch release ${tag} from ${opts.repo} (HTTP ${release.status}). ` +
        (token
          ? "Check token scopes."
          : "Repo/releases must be public, or set GITHUB_TOKEN.")
    );
  }
  const assets = (release.json.assets || []) as Array<{
    name: string;
    id: number;
    url: string;
    browser_download_url: string;
    size?: number;
  }>;
  const asset =
    assets.find((a) => a.name === expectedName) ||
    assets.find((a) => a.name === opts.assetName);
  if (!asset) {
    throw new Error(
      `Asset ${expectedName} not found on ${opts.repo}@${tag}. Available: ${
        assets.map((a) => a.name).join(", ") || "(none)"
      }`
    );
  }

  const tmp = path.join(os.tmpdir(), `cliodot-${Date.now()}-${asset.name}`);
  const knownSize = Number(asset.size) || 0;

  let downloaded = false;
  if (!token && asset.browser_download_url) {
    downloaded = await streamDownloadToFile({
      url: asset.browser_download_url,
      headers: { "User-Agent": "cliodot-cli" },
      destPath: tmp,
      knownSize,
      label: "transfer",
      onProgress: opts.onProgress,
    });
  }

  if (!downloaded) {
    const downloadUrl = `https://api.github.com/repos/${opts.repo}/releases/assets/${asset.id}`;
    downloaded = await streamDownloadToFile({
      url: downloadUrl,
      headers: githubHeaders(token, "application/octet-stream"),
      destPath: tmp,
      knownSize,
      label: "transfer",
      onProgress: opts.onProgress,
    });
  }

  if (!downloaded || !fs.existsSync(tmp) || fs.statSync(tmp).size <= 0) {
    throw new Error(
      `Failed to fetch release asset ${asset.name} from ${opts.repo}@${tag}. ` +
        (token
          ? ""
          : "Public download failed — set GITHUB_TOKEN or use a public release repo.")
    );
  }

  opts.onProgress?.(100, fs.statSync(tmp).size, fs.statSync(tmp).size, "secure");

  fs.mkdirSync(opts.destDir, { recursive: true });
  const extract = spawnSync("tar", ["-xzf", tmp, "-C", opts.destDir], {
    encoding: "utf8",
  });
  fs.unlinkSync(tmp);
  if ((extract.status ?? 1) !== 0) {
    throw new Error(`Failed to extract ${asset.name}: ${extract.stderr}`);
  }

  flattenIfSingleRoot(opts.destDir);
}

async function streamDownloadToFile(opts: {
  url: string;
  headers: Record<string, string>;
  destPath: string;
  knownSize: number;
  label: string;
  onProgress?: (percent: number, receivedBytes: number, totalBytes: number, label: string) => void;
}): Promise<boolean> {
  try {
    const res = await fetch(opts.url, {
      headers: opts.headers,
      redirect: "follow",
    });
    if (!res.ok || !res.body) return false;

    const total =
      opts.knownSize ||
      Number(res.headers.get("content-length") || 0) ||
      0;
    const file = fs.createWriteStream(opts.destPath);
    const reader = res.body.getReader();
    let received = 0;
    let lastPct = -1;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.length) continue;
      received += value.length;
      file.write(Buffer.from(value));
      if (total > 0) {
        const pct = Math.min(99, Math.floor((received / total) * 100));
        if (pct !== lastPct) {
          lastPct = pct;
          opts.onProgress?.(pct, received, total, opts.label);
        }
      } else {
        opts.onProgress?.(0, received, 0, opts.label);
      }
    }

    await new Promise<void>((resolve, reject) => {
      file.end(() => resolve());
      file.on("error", reject);
    });

    if (total > 0) {
      opts.onProgress?.(100, received, total, opts.label);
    }
    return received > 0;
  } catch {
    try {
      if (fs.existsSync(opts.destPath)) fs.unlinkSync(opts.destPath);
    } catch {
      /* ignore */
    }
    return false;
  }
}

export async function installNativeArtifacts(opts: {
  dir: string;
  repo?: string;
  serverRepo?: string;
  clientRepo?: string;
  serverVersion: string;
  clientVersion: string;
  clientOnly?: boolean;
  onProgress?: (message: string) => void;
}): Promise<{ serverVersion: string; clientVersion: string; source: "github" }> {
  const clientOnly = opts.clientOnly ?? CLI_DEFAULTS.clientOnly;
  const serverRepo =
    opts.serverRepo || opts.repo || CLI_DEFAULTS.serverReleaseRepo;
  const clientRepo =
    opts.clientRepo ||
    (clientOnly ? CLI_DEFAULTS.clientReleaseRepo : opts.repo) ||
    CLI_DEFAULTS.clientReleaseRepo;
  const serverDir = path.join(opts.dir, "server");
  const clientDir = path.join(opts.dir, "client");
  const report = opts.onProgress || (() => undefined);
  let lastFlavorAt = 0;
  let lastFlavor = "";

  const progressLabel = (
    percent: number,
    receivedBytes: number,
    totalBytes: number,
    label: string
  ) => {
    const now = Date.now();
    const phase =
      label === "briefing"
        ? "briefing"
        : label === "secure"
          ? "secure"
          : "transfer";

    if (phase !== "transfer") {
      const msg = missionStatus(phase);
      lastFlavor = msg;
      lastFlavorAt = now;
      report(msg);
      return;
    }

    const shouldReroll =
      !lastFlavor || now - lastFlavorAt > 1200 || percent === 100;
    if (shouldReroll) {
      lastFlavor = missionStatus("transfer", {
        percent,
        receivedBytes,
        totalBytes,
      });
      lastFlavorAt = now;
    } else {
      const troopBit = totalBytes
        ? ` · ${percent}% · Troops are ${(receivedBytes / (1024 * 1024)).toFixed(1)} Mb / ${(totalBytes / (1024 * 1024)).toFixed(1)} Mb`
        : ` · Troops are ${(receivedBytes / (1024 * 1024)).toFixed(1)} Mb`;
      const base = lastFlavor.split(" · ")[0] || lastFlavor;
      lastFlavor = `${base}${troopBit}`;
    }
    report(lastFlavor);
  };

  report(missionStartBanner(clientOnly));
  report(missionStatus("briefing"));
  const clientResolved = await resolveReleaseVersion(
    clientRepo,
    opts.clientVersion || "latest"
  );
  const clientNames = releaseAssetNames(clientResolved);

  if (fs.existsSync(clientDir)) fs.rmSync(clientDir, { recursive: true, force: true });
  fs.mkdirSync(clientDir, { recursive: true });

  let serverResolved = opts.serverVersion || "latest";
  if (!clientOnly) {
    report(missionStatus("briefing"));
    serverResolved = await resolveReleaseVersion(
      serverRepo,
      opts.serverVersion || "latest"
    );
    const names = releaseAssetNames(serverResolved);
    if (fs.existsSync(serverDir)) fs.rmSync(serverDir, { recursive: true, force: true });
    fs.mkdirSync(serverDir, { recursive: true });
    await downloadReleaseAsset({
      repo: serverRepo,
      version: serverResolved,
      assetName: names.server,
      destDir: serverDir,
      onProgress: progressLabel,
    });
    report(missionStatus("secure"));
    installProdDeps(serverDir);
  }

  await downloadReleaseAsset({
    repo: clientRepo,
    version: clientResolved,
    assetName: clientNames.client,
    destDir: clientDir,
    onProgress: progressLabel,
  });
  report(missionStatus("secure"));
  installProdDeps(clientDir);
  report(
    missionDoneBanner(clientOnly, {
      server: serverResolved,
      client: clientResolved,
    })
  );

  return {
    serverVersion: serverResolved,
    clientVersion: clientResolved,
    source: "github",
  };
}

export function validateGithubTokenForReleases(repo?: string): {
  ok: boolean;
  message: string;
} {
  const token = getGithubToken();
  if (!token) {
    return {
      ok: true,
      message: "No token set — public Releases/GHCR can still work anonymously.",
    };
  }
  const target = repo || CLI_DEFAULTS.releaseRepo;
  const r = runCommand(
    "curl",
    [
      "-sS",
      "-o",
      "/dev/null",
      "-w",
      "%{http_code}",
      "-H",
      `Authorization: Bearer ${token}`,
      "-H",
      "Accept: application/vnd.github+json",
      `https://api.github.com/repos/${target}`,
    ]
  );
  const code = (r.stdout || "").trim();
  if (code === "200") return { ok: true, message: `Token can access ${target}.` };
  return { ok: false, message: `Token check HTTP ${code || r.status} for ${target}.` };
}

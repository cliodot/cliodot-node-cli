import fs from "fs";
import path from "path";
import https from "https";
import {
  describeGithubTokenSource,
  getGithubToken,
  runCommand,
} from "../util/fs.js";
import { versionTag } from "./util.js";

function tokenHint(): string {
  const source = describeGithubTokenSource();
  return source
    ? `Token loaded from ${source}.`
    : "No GITHUB_TOKEN in environment or packages/cliodot-cli/.env.";
}

function githubFailure(repo: string, res: { status: number; json?: any }, action: string): string {
  const detail = res.json?.message ? `: ${res.json.message}` : "";
  if (res.status === 0) {
    return `GitHub API unreachable while ${action} ${repo}${detail}. ${tokenHint()}`;
  }
  return `Cannot ${action} ${repo} (HTTP ${res.status})${detail}. ${tokenHint()}`;
}

export async function assertRepoIsPrivate(repo: string): Promise<void> {
  const token = getGithubToken();
  if (!token) {
    throw new Error(
      "GITHUB_TOKEN / GHCR_TOKEN required to verify release repo privacy. " +
        "Put it in packages/cliodot-cli/.env."
    );
  }
  const res = await githubJson(`https://api.github.com/repos/${repo}`, token);
  if (!res.ok || !res.json || res.status === 0) {
    throw new Error(
      `${githubFailure(repo, res, "verifying")}` +
        ` Enterprise releases require a private repo.`
    );
  }
  if (res.json.private !== true) {
    throw new Error(
      `Refusing to publish private app artifacts to public repo ${repo}. ` +
        `Use --public for obfuscated public releases, or pass --release-repo owner/private-repo.`
    );
  }
}

export async function assertRepoAccessible(repo: string): Promise<{
  private: boolean;
}> {
  const token = getGithubToken();
  if (!token) {
    throw new Error(
      "GITHUB_TOKEN / GHCR_TOKEN required to access the release repo."
    );
  }
  const res = await githubJson(`https://api.github.com/repos/${repo}`, token);
  if (!res.ok || !res.json || res.status === 0) {
    throw new Error(githubFailure(repo, res, "accessing"));
  }
  return { private: res.json.private === true };
}

export async function getRepoDefaultBranch(repo: string): Promise<string> {
  const token = getGithubToken();
  if (!token) {
    throw new Error(
      "GITHUB_TOKEN / GHCR_TOKEN required. Put it in packages/cliodot-cli/.env."
    );
  }
  const res = await githubJson(`https://api.github.com/repos/${repo}`, token);
  if (!res.ok || !res.json || res.status === 0) {
    throw new Error(githubFailure(repo, res, "accessing"));
  }
  return String(res.json.default_branch || "main");
}

export async function ensureGhcrPackageVisibility(opts: {
  image: string;
  visibility: "private" | "public";
}): Promise<void> {
  try {
    const token = getGithubToken();
    if (!token) {
      console.warn(
        "Warning: no GITHUB_TOKEN / GHCR_TOKEN — skipped GHCR visibility update. Set it in Packages UI if needed."
      );
      return;
    }
    const match = opts.image.match(/^ghcr\.io\/([^/]+)\/([^:@]+)/i);
    if (!match) {
      console.warn(`Warning: cannot parse GHCR image name from ${opts.image}`);
      return;
    }
    const owner = match[1];
    const packageName = match[2];
    const encoded = encodeURIComponent(packageName);

    const userUrl = `https://api.github.com/user/packages/container/${encoded}/visibility`;
    const orgUrl = `https://api.github.com/orgs/${owner}/packages/container/${encoded}/visibility`;

    let res = await githubJson(orgUrl, token, {
      method: "POST",
      body: { visibility: opts.visibility },
    });
    if (!res.ok) {
      res = await githubJson(userUrl, token, {
        method: "POST",
        body: { visibility: opts.visibility },
      });
    }
    if (!res.ok) {
      console.warn(
        `Warning: could not set GHCR package ${opts.image} to ${opts.visibility} (HTTP ${res.status}). ` +
          `Confirm visibility in GitHub Packages UI.`
      );
    }
  } catch (err) {
    console.warn(
      `Warning: GHCR visibility update failed for ${opts.image}: ${
        err instanceof Error ? err.message : String(err)
      }. Image push may still have succeeded — set visibility in GitHub Packages UI.`
    );
  }
}

export async function ensureGhcrPackagePrivate(opts: {
  image: string;
}): Promise<void> {
  await ensureGhcrPackageVisibility({ image: opts.image, visibility: "private" });
}

async function repoAlreadyHasCommit(
  repo: string,
  token: string,
  branch: string
): Promise<boolean> {
  const commits = await githubJson(
    `https://api.github.com/repos/${repo}/commits?per_page=1&sha=${encodeURIComponent(branch)}`,
    token
  );
  if (commits.ok && Array.isArray(commits.json) && commits.json.length > 0) {
    return true;
  }
  const readme = await githubJson(
    `https://api.github.com/repos/${repo}/contents/README.md?ref=${encodeURIComponent(branch)}`,
    token
  );
  return Boolean(readme.ok && readme.json?.sha);
}

/** GitHub cannot create a Release on a repo with no commits. */
export async function ensureRepoHasCommit(repo: string): Promise<void> {
  const token = getGithubToken();
  if (!token) {
    throw new Error("GITHUB_TOKEN / GHCR_TOKEN required to initialize the release repo.");
  }
  const info = await githubJson(`https://api.github.com/repos/${repo}`, token);
  if (!info.ok || !info.json || info.status === 0) {
    throw new Error(githubFailure(repo, info, "accessing"));
  }
  const branch = String(info.json.default_branch || "main");
  if (await repoAlreadyHasCommit(repo, token, branch)) return;

  const existing = await githubJson(
    `https://api.github.com/repos/${repo}/contents/README.md?ref=${encodeURIComponent(branch)}`,
    token
  );
  if (existing.ok && existing.json?.sha) return;

  const body = [
    `# ${repo}`,
    "",
    "Initialized by `@cliodot/cli` so GitHub Releases can be created.",
    "",
  ].join("\n");
  const payload: Record<string, string> = {
    message: "Initialize release repository",
    content: Buffer.from(body, "utf8").toString("base64"),
    branch,
  };
  if (typeof existing.json?.sha === "string") {
    payload.sha = existing.json.sha;
  }
  const seeded = await githubJson(
    `https://api.github.com/repos/${repo}/contents/README.md`,
    token,
    { method: "PUT", body: payload }
  );
  if (seeded.ok) return;
  if (
    seeded.status === 422 &&
    /sha/i.test(JSON.stringify(seeded.json || {}))
  ) {
    return;
  }
  throw new Error(
    `Cannot initialize empty repo ${repo} (HTTP ${seeded.status}): ${JSON.stringify(seeded.json)}`
  );
}

export async function ensureGithubRelease(opts: {
  repo: string;
  version: string;
  title?: string;
  notes?: string;
  draft?: boolean;
  requirePrivate?: boolean;
}): Promise<{ id: number; uploadUrl: string; htmlUrl: string }> {
  if (opts.requirePrivate !== false) {
    await assertRepoIsPrivate(opts.repo);
  }
  const token = getGithubToken();
  if (!token) {
    throw new Error("GITHUB_TOKEN / GHCR_TOKEN required to publish releases.");
  }
  const tag = versionTag(opts.version);
  const [owner, name] = opts.repo.split("/");
  if (!owner || !name) {
    throw new Error(`Invalid repo "${opts.repo}". Expected owner/name.`);
  }

  const existing = await githubJson(
    `https://api.github.com/repos/${opts.repo}/releases/tags/${tag}`,
    token
  );
  if (existing.ok && existing.json?.id) {
    return {
      id: existing.json.id,
      uploadUrl: String(existing.json.upload_url || "").replace(
        /\{.*\}$/,
        ""
      ),
      htmlUrl: existing.json.html_url,
    };
  }

  const createBody = {
    tag_name: tag,
    name: opts.title || tag,
    body: opts.notes || `Cliodot release ${tag}`,
    draft: Boolean(opts.draft),
    prerelease: false,
  };
  let created = await githubJson(
    `https://api.github.com/repos/${opts.repo}/releases`,
    token,
    { method: "POST", body: createBody }
  );
  if (
    !created.ok &&
    created.status === 422 &&
    /empty/i.test(JSON.stringify(created.json || {}))
  ) {
    await ensureRepoHasCommit(opts.repo);
    created = await githubJson(
      `https://api.github.com/repos/${opts.repo}/releases`,
      token,
      { method: "POST", body: createBody }
    );
  }
  if (!created.ok || !created.json?.id) {
    throw new Error(
      `Failed to create release ${tag} on ${opts.repo} (HTTP ${created.status}): ${JSON.stringify(created.json)}`
    );
  }
  return {
    id: created.json.id,
    uploadUrl: String(created.json.upload_url || "").replace(/\{.*\}$/, ""),
    htmlUrl: created.json.html_url,
  };
}

export async function uploadReleaseAsset(opts: {
  repo: string;
  releaseId: number;
  filePath: string;
  name?: string;
  version?: string;
  onProgress?: (percent: number, sentBytes: number, totalBytes: number) => void;
}): Promise<void> {
  const token = getGithubToken();
  if (!token) {
    throw new Error("GITHUB_TOKEN / GHCR_TOKEN required to upload assets.");
  }
  if (!fs.existsSync(opts.filePath)) {
    throw new Error(`Upload file not found: ${opts.filePath}`);
  }
  const assetName = opts.name || path.basename(opts.filePath);
  const totalBytes = fs.statSync(opts.filePath).size;
  if (totalBytes <= 0) {
    throw new Error(`Upload file is empty: ${opts.filePath}`);
  }
  if (totalBytes > 2 * 1024 * 1024 * 1024) {
    throw new Error(
      `File too large for GitHub Releases (${formatBytes(totalBytes)}). Max is 2 GiB.`
    );
  }

  await deleteReleaseAssetByName({
    repo: opts.repo,
    releaseId: opts.releaseId,
    assetName,
    token,
  });

  const tag = opts.version ? versionTag(opts.version) : undefined;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await uploadViaHttpsStream({
        repo: opts.repo,
        releaseId: opts.releaseId,
        filePath: opts.filePath,
        assetName,
        token,
        totalBytes,
        onProgress: opts.onProgress,
      });
      opts.onProgress?.(100, totalBytes, totalBytes);
      return;
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (/already_exists/i.test(msg)) {
        await deleteReleaseAssetByName({
          repo: opts.repo,
          releaseId: opts.releaseId,
          assetName,
          token,
        });
      }
    }
    if (attempt < 3) await sleep(1000 * attempt);
  }

  if (tag && commandExistsGh()) {
    try {
      opts.onProgress?.(0, 0, totalBytes);
      await uploadViaGh({
        repo: opts.repo,
        tag,
        filePath: opts.filePath,
        token,
      });
      opts.onProgress?.(100, totalBytes, totalBytes);
      return;
    } catch (err) {
      lastErr = err;
    }
  }

  throw new Error(
    `Failed to upload ${assetName} (${formatBytes(totalBytes)}) to ${opts.repo}: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }. Prefer CLI upload (not the GitHub web UI) and check network access to uploads.github.com.`
  );
}

async function deleteReleaseAssetByName(opts: {
  repo: string;
  releaseId: number;
  assetName: string;
  token: string;
}): Promise<void> {
  const res = await githubJson(
    `https://api.github.com/repos/${opts.repo}/releases/${opts.releaseId}/assets`,
    opts.token
  );
  if (!res.ok || !Array.isArray(res.json)) return;
  const existing = res.json.find(
    (a: { name?: string; id?: number }) => a?.name === opts.assetName
  );
  if (!existing?.id) return;
  await githubJson(
    `https://api.github.com/repos/${opts.repo}/releases/assets/${existing.id}`,
    opts.token,
    { method: "DELETE" }
  );
}

function uploadViaHttpsStream(opts: {
  repo: string;
  releaseId: number;
  filePath: string;
  assetName: string;
  token: string;
  totalBytes: number;
  onProgress?: (percent: number, sentBytes: number, totalBytes: number) => void;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = new URL(
      `https://uploads.github.com/repos/${opts.repo}/releases/${opts.releaseId}/assets?name=${encodeURIComponent(opts.assetName)}`
    );
    const req = https.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        path: `${url.pathname}${url.search}`,
        method: "POST",
        headers: {
          Authorization: `Bearer ${opts.token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/octet-stream",
          "Content-Length": String(opts.totalBytes),
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "cliodot-cli",
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve();
            return;
          }
          if (res.statusCode === 422 && /already_exists/i.test(text)) {
            resolve();
            return;
          }
          reject(
            new Error(
              `Failed to upload ${opts.assetName} (HTTP ${res.statusCode}): ${text}`
            )
          );
        });
      }
    );

    req.on("error", reject);

    const stream = fs.createReadStream(opts.filePath);
    let sent = 0;
    let lastPct = -1;
    stream.on("data", (chunk: Buffer | string) => {
      const n = typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;
      sent += n;
      const pct = Math.min(99, Math.floor((sent / opts.totalBytes) * 100));
      if (pct !== lastPct && (pct % 1 === 0 || sent === opts.totalBytes)) {
        lastPct = pct;
        opts.onProgress?.(pct, sent, opts.totalBytes);
      }
    });
    stream.on("error", (err) => {
      req.destroy(err);
      reject(err);
    });
    stream.pipe(req);
  });
}

async function uploadViaGh(opts: {
  repo: string;
  tag: string;
  filePath: string;
  token: string;
}): Promise<void> {
  const gh = runCommand(
    "gh",
    [
      "release",
      "upload",
      opts.tag,
      opts.filePath,
      "--repo",
      opts.repo,
      "--clobber",
    ],
    {
      env: { ...process.env, GH_TOKEN: opts.token, GITHUB_TOKEN: opts.token },
      inherit: false,
    }
  );
  if (gh.status !== 0) {
    throw new Error(
      `gh release upload failed: ${(gh.stderr || gh.stdout || "").trim()}`
    );
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}

function commandExistsGh(): boolean {
  return runCommand("gh", ["--version"]).status === 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function githubJson(
  url: string,
  token: string,
  opts?: { method?: string; body?: unknown }
): Promise<{ ok: boolean; status: number; json?: any }> {
  let last: { ok: boolean; status: number; json?: any } = {
    ok: false,
    status: 0,
    json: { message: "GitHub request failed" },
  };
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: opts?.method || "GET",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "cliodot-cli",
          ...(opts?.body ? { "Content-Type": "application/json" } : {}),
        },
        body: opts?.body ? JSON.stringify(opts.body) : undefined,
      });
      if (res.status === 204 || opts?.method === "DELETE") {
        return { ok: res.ok || res.status === 204, status: res.status };
      }
      const json = await res.json().catch(() => undefined);
      return { ok: res.ok, status: res.status, json };
    } catch (err) {
      last = {
        ok: false,
        status: 0,
        json: {
          message: err instanceof Error ? err.message : String(err),
        },
      };
      if (attempt < 3) await sleep(750 * attempt);
    }
  }
  return last;
}

export function requireGhCli(): void {
  const r = runCommand("gh", ["--version"]);
  if (r.status !== 0) {
    throw new Error("GitHub CLI (gh) is required for some release helpers.");
  }
}

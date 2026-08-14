import fs from "fs";
import path from "path";
import * as p from "@clack/prompts";
import { CLI_DEFAULTS } from "../config.js";
import { ensureGithubRelease, uploadReleaseAsset } from "./github.js";
import { findRepoRoot, normalizeVersion } from "./util.js";

export type ReleaseUploadKind = "server" | "client" | "cli";

export type ReleaseUploadOptions = {
  files?: string[];
  version?: string;
  kind?: ReleaseUploadKind;
  releaseRepo?: string;
  public?: boolean;
};

const FILE_PATTERNS: Array<{
  kind: ReleaseUploadKind;
  re: RegExp;
}> = [
  { kind: "client", re: /^cliodot-client-(.+)\.tar\.gz$/i },
  { kind: "cli", re: /^cliodot-cli-(.+)\.tgz$/i },
  { kind: "server", re: /^cliodot-api-(.+?)(?:-[a-z0-9]+-[a-z0-9]+)?\.tar\.gz$/i },
];

function inferFromBasename(basename: string): {
  kind?: ReleaseUploadKind;
  version?: string;
} {
  for (const { kind, re } of FILE_PATTERNS) {
    const m = basename.match(re);
    if (!m?.[1]) continue;
    let version = m[1];
    if (kind === "server") {
      version = version.replace(/-(darwin|linux|win)-(arm64|x64)$/i, "");
    }
    return { kind, version: normalizeVersion(version) };
  }
  return {};
}

function discoverStagedAssets(opts: {
  root: string;
  version: string;
  kind: ReleaseUploadKind;
}): string[] {
  const dir = path.join(opts.root, ".cliodot-release", opts.kind, opts.version);
  if (!fs.existsSync(dir)) {
    throw new Error(`No staged release directory: ${dir}`);
  }
  const names = fs.readdirSync(dir).filter((name) => {
    if (opts.kind === "cli") return /\.tgz$/i.test(name);
    return /\.tar\.gz$/i.test(name) && name.startsWith("cliodot-");
  });
  if (!names.length) {
    throw new Error(`No tarball assets found in ${dir}`);
  }
  return names.map((name) => path.join(dir, name));
}

function titleFor(kind: ReleaseUploadKind | undefined, version: string): string {
  if (kind === "client") return `Cliodot client ${version}`;
  if (kind === "cli") return `Cliodot CLI ${version}`;
  if (kind === "server") return `Cliodot server ${version}`;
  return `Cliodot ${version}`;
}

function defaultReleaseRepo(kind?: ReleaseUploadKind): string {
  if (kind === "client") return CLI_DEFAULTS.clientReleaseRepo;
  if (kind === "server") return CLI_DEFAULTS.serverReleaseRepo;
  if (kind === "cli") return CLI_DEFAULTS.cliReleaseRepo;
  return CLI_DEFAULTS.releaseRepo;
}

export async function releaseUpload(opts: ReleaseUploadOptions): Promise<void> {
  const isPublic = opts.public !== false;
  const root = findRepoRoot();

  let files = (opts.files || [])
    .map((f) => path.resolve(f))
    .filter(Boolean);

  let version = opts.version ? normalizeVersion(opts.version) : undefined;
  let kind = opts.kind;

  if (!files.length) {
    if (!version || !kind) {
      throw new Error(
        "Pass one or more tarball paths, or --version with --server/--client/--cli to upload staged assets from .cliodot-release."
      );
    }
    files = discoverStagedAssets({ root, version, kind });
  }

  for (const file of files) {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      throw new Error(`Asset not found: ${file}`);
    }
  }

  if (!version || !kind) {
    for (const file of files) {
      const inferred = inferFromBasename(path.basename(file));
      version = version || inferred.version;
      kind = kind || inferred.kind;
    }
  }

  if (!version) {
    throw new Error(
      "Could not infer version from file name. Pass --version <ver>."
    );
  }

  const releaseRepo = opts.releaseRepo || defaultReleaseRepo(kind);

  p.intro(`Upload release assets → ${releaseRepo} (${versionTagSafe(version)})`);
  p.log.info(files.map((f) => path.basename(f)).join(", "));

  const spinner = p.spinner();
  spinner.start(`Ensuring GitHub release on ${releaseRepo}`);
  try {
    const release = await ensureGithubRelease({
      repo: releaseRepo,
      version,
      requirePrivate: !isPublic,
      title: titleFor(kind, version),
      notes: [
        `Uploaded staged artifact(s) for ${kind || "release"} ${version}`,
        ...files.map((f) => path.basename(f)),
      ].join("\n"),
    });
    spinner.stop(`Release ready → ${release.htmlUrl}`);

    for (const file of files) {
      const name = path.basename(file);
      spinner.start(`Uploading ${name} 0%`);
      await uploadReleaseAsset({
        repo: releaseRepo,
        releaseId: release.id,
        filePath: file,
        version,
        onProgress: (pct, sent, total) => {
          spinner.message(
            `Uploading ${name} ${pct}% (${formatUploadBytes(sent)}/${formatUploadBytes(total)})`
          );
        },
      });
      spinner.stop(`Uploaded ${name}`);
    }

    p.note(
      [`repo: ${releaseRepo}`, `url: ${release.htmlUrl}`, ...files.map((f) => `  - ${f}`)].join(
        "\n"
      ),
      "Upload"
    );
    p.outro("Done");
  } catch (err) {
    spinner.stop("Upload failed");
    throw err;
  }
}

function versionTagSafe(version: string): string {
  return `v${normalizeVersion(version)}`;
}

function formatUploadBytes(n: number): string {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KiB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
}

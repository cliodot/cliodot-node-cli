import path from "path";
import * as p from "@clack/prompts";
import {
  CLI_DEFAULTS,
  isCommunityReleaseRepo,
  isEnterpriseReleaseRepo,
  mirrorsReleaseBuild,
} from "../config.js";
import { buildAndPushApiImage } from "./docker.js";
import {
  assertRepoAccessible,
  assertRepoIsPrivate,
  ensureGithubRelease,
  uploadReleaseAsset,
} from "./github.js";
import { publishNpmPackage } from "./npm-publish.js";
import { resolveGithubWorkspace } from "./repo-source.js";
import { forcePushCommunityMirror } from "./community-mirror.js";
import {
  packStagingTarball,
  stageApiRelease,
} from "./tarball.js";
import { findRepoRoot, normalizeVersion, rmrf } from "./util.js";
import { describeGithubTokenSource, getGithubToken } from "../util/fs.js";
import { resolveReleaseStageFlags } from "./stages.js";

export type ReleaseServerOptions = {
  version: string;
  serverDir?: string;
  serverRepo?: string;
  serverRef?: string;
  releaseRepo?: string;
  enterprise?: boolean;
  image?: string;
  only?: string | string[];
  docker?: boolean;
  native?: boolean;
  push?: boolean;
  upload?: boolean;
  npmPublish?: boolean;
  dryRun?: boolean;
  public?: boolean;
  obfuscate?: boolean;
};

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function formatUploadBytes(n: number): string {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KiB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
}

export async function releaseServer(opts: ReleaseServerOptions): Promise<void> {
  const version = normalizeVersion(opts.version);
  if (!version) throw new Error("--version is required");

  const stages = resolveReleaseStageFlags(opts);
  const doDocker = stages.doDocker;
  const doNative = stages.doNative;
  const push = stages.push;
  const upload = stages.upload || Boolean(opts.enterprise);
  const npmPublish = stages.npmPublish;
  const workRoot = findRepoRoot();
  const outDir = path.join(workRoot, ".cliodot-release", "server", version);
  const releaseRepo =
    opts.releaseRepo ||
    (opts.enterprise
      ? CLI_DEFAULTS.serverEnterpriseReleaseRepo
      : CLI_DEFAULTS.serverReleaseRepo);
  const community = isCommunityReleaseRepo(releaseRepo);
  const enterprise = isEnterpriseReleaseRepo(releaseRepo);
  const mirrorBuild = mirrorsReleaseBuild(releaseRepo);
  const isPublic = enterprise ? false : opts.public !== false;
  const obfuscate = community
    ? false
    : opts.obfuscate !== false || isPublic;
  if (isPublic && !community && opts.obfuscate === false) {
    throw new Error("Public server releases require obfuscation (omit --no-obfuscate).");
  }
  const buildScript = community ? "build:dev" : undefined;
  const image = opts.image || CLI_DEFAULTS.serverImage;
  const npmName = CLI_DEFAULTS.serverNpmPackage;

  p.intro(
    `Release server ${version} (${
      community
        ? "community + build:dev"
        : enterprise
          ? "enterprise + full source"
          : isPublic
            ? "public + obfuscated"
            : "private"
    })`
  );
  const enabled = [
    doDocker ? "docker" : null,
    npmPublish ? "npm" : null,
    doNative
      ? enterprise
        ? "tarball (+ full-source push)"
        : mirrorBuild
          ? "tarball (+ build push)"
          : "tarball"
      : null,
  ].filter(Boolean);
  p.log.info(`stages: ${enabled.join(" → ") || "none"}`);
  p.log.info(`artifact release repo: ${releaseRepo}`);
  if (upload || doDocker || npmPublish) {
    const tokenSource = describeGithubTokenSource();
    p.log.info(
      getGithubToken()
        ? `GitHub token: ${tokenSource || "environment"}`
        : "GitHub token: missing (packages/cliodot-cli/.env)"
    );
  }
  if (enterprise) {
    p.log.info("enterprise: private repo, full checkout including src, plus runtime tarball");
  }
  if (doDocker) p.log.info(`GHCR image: ${image}`);
  if (npmPublish) p.log.info(`npm: ${npmName}`);
  p.log.info(`obfuscate: ${obfuscate ? "yes" : "no"}`);
  p.log.info(`build: ${buildScript || (obfuscate ? "build:release" : "build")}`);

  if (upload) {
    try {
      if (isPublic) {
        const access = await assertRepoAccessible(releaseRepo);
        p.log.success(
          `${releaseRepo} accessible (${access.private ? "private repo hosting public assets" : "public"})`
        );
      } else {
        await assertRepoIsPrivate(releaseRepo);
        p.log.success(`${releaseRepo} is private`);
      }
    } catch (err) {
      p.log.warn(`Release repo check failed (upload may still be attempted): ${errMsg(err)}`);
    }
  }

  const spinner = p.spinner();
  spinner.start("Resolving server source");
  const server = await resolveGithubWorkspace({
    label: "server",
    localDir: opts.serverDir,
    repo: opts.serverRepo || CLI_DEFAULTS.serverRepo,
    version,
    cacheRoot: outDir,
    ref: opts.serverRef,
    preferLocalServerRoot: !opts.serverDir,
  });
  spinner.stop(
    server.source === "local"
      ? `Server local: ${server.dir}`
      : `Server cloned: ${server.repo}`
  );

  const produced: string[] = [];
  const assets: string[] = [];
  const failures: string[] = [];
  let staging: string | null = null;

  if (doDocker) {
    spinner.start("Building server Docker image");
    try {
      const tags = await buildAndPushApiImage({
        repoRoot: server.dir,
        version,
        image,
        push,
        public: isPublic,
      });
      spinner.stop(
        push
          ? `Pushed ${isPublic ? "public" : "private"} ${tags.join(", ")}`
          : `Built ${tags.join(", ")}`
      );
      produced.push(...tags);
    } catch (err) {
      spinner.stop("Docker stage failed");
      p.log.warn(errMsg(err));
      failures.push(`docker: ${errMsg(err)}`);
    }
  }

  if (doNative || npmPublish) {
    spinner.start(
      obfuscate
        ? "Building obfuscated server package"
        : "Building server package"
    );
    try {
      staging = stageApiRelease({
        repoRoot: server.dir,
        version,
        outDir,
        obfuscate,
        withNodeModules: doNative,
        buildScript,
      });
      spinner.stop(`Staged ${staging}`);
    } catch (err) {
      spinner.stop("Package stage failed");
      p.log.warn(errMsg(err));
      failures.push(`package: ${errMsg(err)}`);
      staging = null;
    }
  }

  if (npmPublish) {
    if (!staging) {
      p.log.warn("Skipping npm — package stage unavailable");
      failures.push("npm: skipped (no staging)");
    } else {
      spinner.start(
        opts.dryRun
          ? `npm publish --dry-run ${npmName}`
          : `npm publish ${npmName}@${version}`
      );
      try {
        const url = publishNpmPackage({
          stagingDir: staging,
          name: npmName,
          version,
          description: community
            ? "Cliodot API server (community developer build)"
            : "Cliodot API server (obfuscated production build)",
          dryRun: opts.dryRun,
        });
        spinner.stop(opts.dryRun ? "Dry-run ok" : "Published to npm");
        produced.push(url);
      } catch (err) {
        spinner.stop("npm stage failed");
        p.log.warn(errMsg(err));
        failures.push(`npm: ${errMsg(err)}`);
      }
    }
  }

  if (doNative) {
    if (!staging) {
      p.log.warn("Skipping tarball — package stage unavailable");
      failures.push("tarball: skipped (no staging)");
    } else {
      try {
        const asset = `cliodot-api-${version}.tar.gz`;
        const outPath = path.join(outDir, asset);
        packStagingTarball(staging, outPath);
        assets.push(outPath);
        p.log.info(`Wrote ${outPath}`);
      } catch (err) {
        p.log.warn(`Tarball pack failed: ${errMsg(err)}`);
        failures.push(`tarball: ${errMsg(err)}`);
      }
    }
  }

  if (upload && mirrorBuild) {
    const mirrorSource = enterprise ? server.dir : staging;
    if (!mirrorSource) {
      p.log.warn("Skipping git push — source directory unavailable");
      failures.push("build-push: skipped (no source)");
    } else {
      spinner.start(
        enterprise
          ? `Force-pushing server source + build/ to ${releaseRepo}`
          : `Force-pushing server build to ${releaseRepo} (-f, no src)`
      );
      try {
        const mirrorUrl = await forcePushCommunityMirror({
          repo: releaseRepo,
          stagingDir: mirrorSource,
          version,
          kind: "server",
          workRoot,
          fullSource: enterprise,
        });
        spinner.stop(`Pushed ${enterprise ? "full source" : "build"} → ${mirrorUrl}`);
        produced.push(mirrorUrl);
      } catch (err) {
        spinner.stop("Build push failed");
        p.log.warn(errMsg(err));
        failures.push(`build-push: ${errMsg(err)}`);
      }
    }
  }

  if (upload) {
    if (!assets.length) {
      p.log.warn("Skipping upload — no tarball assets");
      failures.push("upload: skipped (no assets)");
    } else {
      spinner.start(`Uploading server assets to ${releaseRepo}`);
      try {
        const release = await ensureGithubRelease({
          repo: releaseRepo,
          version,
          requirePrivate: !isPublic,
          title: `Cliodot server ${version}`,
          notes: [
            community
              ? `COMMUNITY server release ${version}`
              : enterprise
                ? `ENTERPRISE server release ${version} (full source on repo)`
                : `${isPublic ? "PUBLIC (obfuscated)" : "PRIVATE"} server release ${version}`,
            `Source: ${server.repo || server.dir}`,
            doDocker ? `GHCR: ${image}:${version}` : "",
            npmPublish ? `npm: ${npmName}@${version}` : "",
            community
              ? "Build: build:dev (developer profile). Git snapshot is the staged runtime (no src)."
              : enterprise
                ? "Git snapshot is source + build/ on the enterprise default branch. Tarball is the production runtime."
                : obfuscate
                  ? "Build: minified + obfuscated; source maps stripped."
                  : "Build: minify only.",
          ]
            .filter(Boolean)
            .join("\n"),
        });
        for (const file of assets) {
          const name = path.basename(file);
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
        }
        spinner.stop(`Uploaded → ${release.htmlUrl}`);
        produced.push(release.htmlUrl);
      } catch (err) {
        spinner.stop("Upload stage failed");
        p.log.warn(errMsg(err));
        failures.push(`upload: ${errMsg(err)}`);
      }
    }
  }

  if (staging) rmrf(staging);

  if (!upload && !npmPublish && !push) {
    p.log.warn("Local build only. Add --upload, --npm, and/or --push to publish.");
  }

  p.note(
    [
      `release repo: ${releaseRepo}`,
      `source: ${server.repo || server.dir} (${server.source})`,
      ...produced.map((x) => `  - ${x}`),
      ...assets.map((x) => `  - ${x}`),
      ...(failures.length
        ? ["", "failures:", ...failures.map((f) => `  - ${f}`)]
        : []),
    ].join("\n"),
    "Server release"
  );

  if (failures.length) {
    p.outro(`Done with ${failures.length} stage failure(s)`);
    process.exitCode = 1;
    return;
  }
  p.outro("Done");
}

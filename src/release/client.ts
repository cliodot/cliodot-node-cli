import path from "path";
import * as p from "@clack/prompts";
import { CLI_DEFAULTS, isCommunityReleaseRepo } from "../config.js";
import { buildAndPushClientImage } from "./docker.js";
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
  stageClientRelease,
} from "./tarball.js";
import { findRepoRoot, normalizeVersion, rmrf } from "./util.js";
import { resolveReleaseStageFlags } from "./stages.js";

export type ReleaseClientOptions = {
  version: string;
  clientDir?: string;
  clientRepo?: string;
  clientRef?: string;
  releaseRepo?: string;
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

export async function releaseClient(opts: ReleaseClientOptions): Promise<void> {
  const version = normalizeVersion(opts.version);
  if (!version) throw new Error("--version is required");

  const stages = resolveReleaseStageFlags(opts);
  const doDocker = stages.doDocker;
  const doNative = stages.doNative;
  const push = stages.push;
  const upload = stages.upload;
  const npmPublish = stages.npmPublish;
  const isPublic = opts.public !== false;
  const obfuscate = opts.obfuscate === true;
  const workRoot = findRepoRoot();
  const outDir = path.join(workRoot, ".cliodot-release", "client", version);
  const releaseRepo = opts.releaseRepo || CLI_DEFAULTS.clientReleaseRepo;
  const community = isCommunityReleaseRepo(releaseRepo);
  const image = opts.image || CLI_DEFAULTS.clientImage;
  const npmName = CLI_DEFAULTS.clientNpmPackage;

  p.intro(
    `Release client ${version} (${
      community
        ? "community"
        : isPublic
          ? "public"
          : "private"
    }${obfuscate ? " + obfuscated" : ""})`
  );
  if (stages.only) {
    p.log.info(`stages: ${[...stages.only].join(", ")}`);
  } else {
    p.log.info(`order: docker → npm → community push (-f) → tarball release (stages continue on failure)`);
  }
  p.log.info(`artifact release repo: ${releaseRepo}`);
  p.log.info(`GHCR image: ${image}`);
  p.log.info(`npm: ${npmName}`);
  p.log.info(`obfuscate: ${obfuscate ? "yes" : "no"}`);

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
  spinner.start("Resolving client source");
  const client = await resolveGithubWorkspace({
    label: "client",
    localDir: opts.clientDir,
    repo: opts.clientRepo || CLI_DEFAULTS.clientRepo,
    version,
    cacheRoot: outDir,
    ref: opts.clientRef,
  });
  spinner.stop(
    client.source === "local"
      ? `Client local: ${client.dir}`
      : `Client cloned: ${client.repo}`
  );

  const produced: string[] = [];
  const assets: string[] = [];
  const failures: string[] = [];
  let staging: string | null = null;

  if (doDocker) {
    spinner.start("Building client Docker image");
    try {
      const tags = await buildAndPushClientImage({
        clientDir: client.dir,
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
      obfuscate ? "Building obfuscated client package" : "Building client package"
    );
    try {
      staging = stageClientRelease({
        clientDir: client.dir,
        version,
        outDir,
        obfuscate,
        withNodeModules: doNative,
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
          description: "Cliodot client app (production build)",
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
        const asset = `cliodot-client-${version}.tar.gz`;
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

  if (upload && staging && community) {
    spinner.start(`Force-pushing client build to ${releaseRepo} (-f)`);
    try {
      const mirrorUrl = await forcePushCommunityMirror({
        repo: releaseRepo,
        stagingDir: staging,
        version,
        kind: "client",
        workRoot,
      });
      spinner.stop(`Pushed community mirror → ${mirrorUrl}`);
      produced.push(mirrorUrl);
    } catch (err) {
      spinner.stop("Community mirror push failed");
      p.log.warn(errMsg(err));
      failures.push(`community-push: ${errMsg(err)}`);
    }
  }

  if (upload) {
    if (!assets.length) {
      p.log.warn("Skipping upload — no tarball assets");
      failures.push("upload: skipped (no assets)");
    } else {
      spinner.start(`Uploading client assets to ${releaseRepo}`);
      try {
        const release = await ensureGithubRelease({
          repo: releaseRepo,
          version,
          requirePrivate: !isPublic,
          title: `Cliodot client ${version}`,
          notes: [
            community
              ? `COMMUNITY client release ${version}`
              : `${isPublic ? "PUBLIC" : "PRIVATE"} client release ${version}`,
            `Source: ${client.repo || client.dir}`,
            doDocker ? `GHCR: ${image}:${version}` : "",
            npmPublish ? `npm: ${npmName}@${version}` : "",
            obfuscate
              ? "Build: production + obfuscated JS; source maps stripped."
              : "Build: production standalone.",
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
      `client: ${client.repo || client.dir} (${client.source})`,
      ...produced.map((x) => `  - ${x}`),
      ...assets.map((x) => `  - ${x}`),
      ...(failures.length
        ? ["", "failures:", ...failures.map((f) => `  - ${f}`)]
        : []),
    ].join("\n"),
    "Client release"
  );

  if (failures.length) {
    p.outro(`Done with ${failures.length} stage failure(s)`);
    process.exitCode = 1;
    return;
  }
  p.outro("Done");
}

import fs from "fs";
import path from "path";
import * as p from "@clack/prompts";
import { CLI_DEFAULTS } from "../config.js";
import { getNpmToken, runCommand } from "../util/fs.js";
import { ensureGithubRelease, uploadReleaseAsset } from "./github.js";
import { resolveCliPackageDir } from "./repo-source.js";
import { ensureDir, findRepoRoot, normalizeVersion } from "./util.js";

export type ReleaseCliOptions = {
  version: string;
  cliDir?: string;
  cliRepo?: string;
  cliRef?: string;
  releaseRepo?: string;
  upload?: boolean;
  npmPublish?: boolean;
  dryRun?: boolean;
};

export async function releaseCli(opts: ReleaseCliOptions): Promise<void> {
  const version = normalizeVersion(opts.version);
  if (!version) throw new Error("--version is required");

  const workRoot = findRepoRoot();
  const outDir = path.join(workRoot, ".cliodot-release", "cli", version);
  ensureDir(outDir);
  const releaseRepo = opts.releaseRepo || CLI_DEFAULTS.cliReleaseRepo;

  p.intro(`Release CLI ${version} (public installer)`);
  p.log.info(`release repo: ${releaseRepo}`);

  const spinner = p.spinner();
  spinner.start("Resolving CLI source");
  const cli = await resolveCliPackageDir({
    cliDir: opts.cliDir,
    cliRepo: opts.cliRepo || CLI_DEFAULTS.cliRepo,
    version,
    cacheRoot: outDir,
    ref: opts.cliRef,
  });
  spinner.stop(
    cli.source === "local"
      ? `CLI local: ${cli.dir}`
      : `CLI cloned: ${cli.repo}`
  );

  const pkgPath = path.join(cli.dir, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
    name: string;
    version: string;
  };
  if (pkg.version !== version) {
    pkg.version = version;
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
    p.log.info(`Bumped package.json version → ${version}`);
  }

  spinner.start("Building @cliodot/cli");
  const build = runCommand("npm", ["run", "build"], {
    cwd: cli.dir,
    inherit: true,
  });
  if (build.status !== 0) {
    spinner.stop("Build failed");
    throw new Error("CLI build failed");
  }
  spinner.stop("Built");

  spinner.start("Packing npm tarball");
  const pack = runCommand("npm", ["pack", "--pack-destination", outDir], {
    cwd: cli.dir,
    inherit: false,
  });
  if (pack.status !== 0) {
    spinner.stop("Pack failed");
    throw new Error(pack.stderr || "npm pack failed");
  }
  const packedName = (pack.stdout || "")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .pop();
  if (!packedName) {
    spinner.stop("Pack failed");
    throw new Error("npm pack produced no filename");
  }
  const packedPath = path.join(outDir, packedName);
  const aliasName = `cliodot-cli-${version}.tgz`;
  const aliasPath = path.join(outDir, aliasName);
  fs.copyFileSync(packedPath, aliasPath);
  spinner.stop(`Packed ${aliasPath}`);

  const produced: string[] = [aliasPath];

  if (opts.upload) {
    spinner.start(`Uploading CLI release to ${releaseRepo}`);
    const release = await ensureGithubRelease({
      repo: releaseRepo,
      version,
      requirePrivate: false,
      title: `Cliodot CLI ${version}`,
      notes: [
        `Cliodot CLI (@cliodot/cli) ${version}`,
        "",
        "Public installer only — does not include server/client source or build.",
        "",
        "Install:",
        "```bash",
        `npm install -g ${CLI_DEFAULTS.cliNpmPackage}@${version}`,
        `npm install -g ./${aliasName}`,
        "```",
      ].join("\n"),
    });
    await uploadReleaseAsset({
      repo: releaseRepo,
      releaseId: release.id,
      filePath: aliasPath,
      name: aliasName,
      version,
      onProgress: (pct, sent, total) => {
        spinner.message(
          `Uploading ${aliasName} ${pct}% (${(sent / (1024 * 1024)).toFixed(1)}/${(total / (1024 * 1024)).toFixed(1)} MiB)`
        );
      },
    });
    spinner.stop(`Uploaded → ${release.htmlUrl}`);
    produced.push(release.htmlUrl);
  }

  if (opts.npmPublish) {
    spinner.start(
      opts.dryRun
        ? "npm publish --dry-run"
        : `npm publish ${CLI_DEFAULTS.cliNpmPackage}`
    );
    const args = ["publish", "--access", "public"];
    if (opts.dryRun) args.push("--dry-run");
    const npmToken = getNpmToken();
    const pubEnv: NodeJS.ProcessEnv = { ...process.env };
    if (npmToken) {
      pubEnv.NODE_AUTH_TOKEN = npmToken;
      pubEnv.NPM_TOKEN = npmToken;
    }
    const pub = runCommand("npm", args, {
      cwd: cli.dir,
      inherit: true,
      env: pubEnv,
    });
    if (pub.status !== 0) {
      spinner.stop("npm publish failed");
      throw new Error(
        npmToken
          ? "npm publish failed"
          : "npm publish failed (set NPM_TOKEN in .env or env for non-interactive auth)"
      );
    }
    spinner.stop(opts.dryRun ? "Dry-run ok" : "Published to npm");
    produced.push(
      opts.dryRun
        ? "(dry-run)"
        : `https://www.npmjs.com/package/${CLI_DEFAULTS.cliNpmPackage}`
    );
  }

  if (!opts.upload && !opts.npmPublish) {
    p.log.warn("Local pack only. Add --upload and/or --npm to publish.");
  }

  p.note(
    [`cli: ${cli.repo || cli.dir} (${cli.source})`, ...produced.map((x) => `- ${x}`)].join(
      "\n"
    ),
    "CLI release"
  );
  p.outro("Done");
}

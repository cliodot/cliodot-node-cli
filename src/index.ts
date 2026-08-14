#!/usr/bin/env node
import path from "path";
import { fileURLToPath } from "url";
import { Command } from "commander";
import { runInit } from "./commands/init.js";
import { runUpdate } from "./commands/update.js";
import { runStart } from "./commands/start.js";
import { runStop } from "./commands/stop.js";
import { runRestart } from "./commands/restart.js";
import { runStatus } from "./commands/status.js";
import { runLogs } from "./commands/logs.js";
import { runLicense } from "./commands/license.js";
import { runLogin } from "./commands/login.js";
import { runReleaseServer, runReleaseClient, runReleaseCli, runReleaseUpload } from "./commands/release.js";
import { loadLocalEnv } from "./util/fs.js";
import { CLI_DEFAULTS } from "./config.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadLocalEnv([packageRoot, process.cwd()]);

const program = new Command();

program
  .name("cliodot")
  .description("Cliodot instance installer and manager")
  .version("0.1.0", "-V, --cli-version", "Print CLI version");

program
  .command("init")
  .description("Interactive wizard to create a Cliodot instance")
  .option("--dir <path>", "Instance directory", process.cwd())
  .option("--server-version <ver>", "Server version (default: latest)")
  .option("--client-version <ver>", "Client version (default: latest)")
  .option(
    "--with-server",
    "Also install/configure the API server (Mongo/Redis prompts included)"
  )
  .option("-y, --yes", "Accept defaults where prompted for start")
  .action(async (opts) => {
    await runInit({
      dir: opts.dir,
      yes: opts.yes,
      serverVersion: opts.serverVersion,
      clientVersion: opts.clientVersion,
      withServer: opts.withServer,
    });
  });

program
  .command("update")
  .description("Update server/client to latest (or a pinned version); preserve .env secrets")
  .option("--dir <path>", "Instance directory", process.cwd())
  .option("--server [version]", "Server tag/version (default: latest)")
  .option("--client [version]", "Client tag/version (default: latest)")
  .action(async (opts) => {
    const server =
      opts.server === undefined
        ? "latest"
        : opts.server === true
          ? "latest"
          : String(opts.server);
    const client =
      opts.client === undefined
        ? "latest"
        : opts.client === true
          ? "latest"
          : String(opts.client);
    await runUpdate({
      dir: opts.dir,
      server,
      client,
    });
  });

program
  .command("start")
  .description("Start the instance")
  .option("--dir <path>", "Instance directory", process.cwd())
  .action(async (opts) => {
    await runStart({ dir: opts.dir });
  });

program
  .command("stop")
  .description("Stop the instance")
  .option("--dir <path>", "Instance directory", process.cwd())
  .action(async (opts) => {
    await runStop({ dir: opts.dir });
  });

program
  .command("restart")
  .description("Restart the instance")
  .option("--dir <path>", "Instance directory", process.cwd())
  .action(async (opts) => {
    await runRestart({ dir: opts.dir });
  });

program
  .command("status")
  .description("Show instance status")
  .option("--dir <path>", "Instance directory", process.cwd())
  .action(async (opts) => {
    await runStatus({ dir: opts.dir });
  });

program
  .command("logs")
  .description("Show logs")
  .option("--dir <path>", "Instance directory", process.cwd())
  .option("-f, --follow", "Follow log output")
  .action(async (opts) => {
    await runLogs({ dir: opts.dir, follow: opts.follow });
  });

program
  .command("license")
  .description("Activate or inspect license against the running API")
  .option("--dir <path>", "Instance directory", process.cwd())
  .option("--activate <key>", "Activation key")
  .option("--status", "Fetch license status")
  .option("--token <jwt>", "Admin JWT for status (or CLIODOT_ADMIN_TOKEN)")
  .action(async (opts) => {
    await runLicense({
      dir: opts.dir,
      activate: opts.activate,
      status: opts.status,
      token: opts.token,
    });
  });

program
  .command("login")
  .description("Authenticate to GHCR and/or validate GitHub token for Releases")
  .option("--dir <path>", "Instance directory", process.cwd())
  .option("--token <pat>", "GitHub PAT (sets GHCR_TOKEN / GITHUB_TOKEN for this process)")
  .action(async (opts) => {
    await runLogin({ dir: opts.dir, token: opts.token });
  });

const release = program
  .command("release")
  .description(
    "Publish artifacts: server (private), client (private), or cli (public)"
  );

release
  .command("server")
  .description("Build/publish SERVER (community: build:dev → force-push → GitHub release tarball)")
  .requiredOption("--version <ver>", "Version (e.g. 1.2.3)")
  .option("--dir <path>", "Local server checkout (default: this repo if detected)")
  .option(
    "--repo <owner/name>",
    "GitHub server repo to clone when not local",
    CLI_DEFAULTS.serverRepo
  )
  .option("--ref <ref>", "Git ref for clone (default: v<version>)")
  .option(
    "--release-repo <owner/name>",
    "Repo for release assets / community mirror (default: cliodot/cliodot-community-server)",
    CLI_DEFAULTS.serverReleaseRepo
  )
  .option("--image <name>", "GHCR image", CLI_DEFAULTS.serverImage)
  .option(
    "--only <stages>",
    "Run only these stages (comma-separated): docker,npm,tarball"
  )
  .option("--docker", "Build Docker image (default on)", true)
  .option("--no-docker", "Skip Docker")
  .option("--native", "Build native tarball (default on)", true)
  .option("--no-native", "Skip native tarball")
  .option("--push", "Push image to GHCR")
  .option("--upload", "Upload tarball to GitHub Releases")
  .option("--npm", "Publish @cliodot/server to npm (default on for public)", true)
  .option("--no-npm", "Skip npm publish")
  .option("--dry-run", "Pass --dry-run to npm publish")
  .option("--public", "Public obfuscated artifacts (default on)", true)
  .option("--no-public", "Keep release repo / GHCR private")
  .option("--obfuscate", "Minify + obfuscate build (default on)", true)
  .option("--no-obfuscate", "Skip obfuscation (private releases only)")
  .action(async (opts) => {
    await runReleaseServer({
      version: opts.version,
      serverDir: opts.dir,
      serverRepo: opts.repo,
      serverRef: opts.ref,
      releaseRepo: opts.releaseRepo,
      image: opts.image,
      only: opts.only,
      docker: opts.docker,
      native: opts.native,
      push: opts.push,
      upload: opts.upload,
      npmPublish: opts.npm,
      dryRun: opts.dryRun,
      public: opts.public,
      obfuscate: opts.obfuscate,
    });
  });

release
  .command("client")
  .description("Build/publish CLIENT (community: build → force-push → GitHub release tarball)")
  .requiredOption("--version <ver>", "Version (e.g. 1.2.3)")
  .option("--dir <path>", "Local client checkout (skips clone)")
  .option(
    "--repo <owner/name>",
    "GitHub client repo to clone",
    CLI_DEFAULTS.clientRepo
  )
  .option("--ref <ref>", "Git ref for clone (default: v<version>)")
  .option(
    "--release-repo <owner/name>",
    "Repo for release assets / community mirror (default: cliodot/cliodot-community-client)",
    CLI_DEFAULTS.clientReleaseRepo
  )
  .option("--image <name>", "GHCR image", CLI_DEFAULTS.clientImage)
  .option(
    "--only <stages>",
    "Run only these stages (comma-separated): docker,npm,tarball"
  )
  .option("--docker", "Build Docker image (default on)", true)
  .option("--no-docker", "Skip Docker")
  .option("--native", "Build native tarball (default on)", true)
  .option("--no-native", "Skip native tarball")
  .option("--push", "Push image to GHCR")
  .option("--upload", "Upload tarball to GitHub Releases")
  .option("--npm", "Publish @cliodot/client to npm (default on for public)", true)
  .option("--no-npm", "Skip npm publish")
  .option("--dry-run", "Pass --dry-run to npm publish")
  .option("--public", "Public artifacts (default on)", true)
  .option("--no-public", "Keep release repo / GHCR private")
  .option("--obfuscate", "Obfuscate client JS (off by default)")
  .option("--no-obfuscate", "Skip obfuscation (default)")
  .action(async (opts) => {
    await runReleaseClient({
      version: opts.version,
      clientDir: opts.dir,
      clientRepo: opts.repo,
      clientRef: opts.ref,
      releaseRepo: opts.releaseRepo,
      image: opts.image,
      only: opts.only,
      docker: opts.docker,
      native: opts.native,
      push: opts.push,
      upload: opts.upload,
      npmPublish: opts.npm,
      dryRun: opts.dryRun,
      public: opts.public,
      obfuscate: opts.obfuscate === true,
    });
  });

release
  .command("cli")
  .description("Build/publish CLI only (public npm / GitHub asset)")
  .requiredOption("--version <ver>", "Version (e.g. 0.1.0)")
  .option("--dir <path>", "Local CLI package directory (default: packages/cliodot-cli in this repo)")
  .option(
    "--repo <owner/name>",
    "GitHub repo containing the CLI package (same as main app)",
    CLI_DEFAULTS.cliRepo
  )
  .option("--ref <ref>", "Git ref for clone (default: v<version>)")
  .option(
    "--release-repo <owner/name>",
    "GitHub repo for CLI release assets (same as main app)",
    CLI_DEFAULTS.cliReleaseRepo
  )
  .option("--upload", "Upload cliodot-cli-<ver>.tgz to GitHub Releases")
  .option("--npm", "npm publish @cliodot/cli")
  .option("--dry-run", "Pass --dry-run to npm publish")
  .action(async (opts) => {
    await runReleaseCli({
      version: opts.version,
      cliDir: opts.dir,
      cliRepo: opts.repo,
      cliRef: opts.ref,
      releaseRepo: opts.releaseRepo,
      upload: opts.upload,
      npmPublish: opts.npm,
      dryRun: opts.dryRun,
    });
  });

release
  .command("upload")
  .description("Upload an already-built tarball to GitHub Releases (no rebuild)")
  .argument("[files...]", "Paths to .tar.gz / .tgz assets")
  .option("--file <path>", "Asset path (repeatable)", (v: string, acc: string[]) => {
    acc.push(v);
    return acc;
  }, [] as string[])
  .option("--version <ver>", "Release version (inferred from filename when omitted)")
  .option("--server", "Upload staged server assets from .cliodot-release/server/<ver>")
  .option("--client", "Upload staged client assets from .cliodot-release/client/<ver>")
  .option("--cli", "Upload staged CLI assets from .cliodot-release/cli/<ver>")
  .option("--release-repo <owner/name>", "Repo for release assets (defaults by kind)")
  .option("--public", "Allow public release repo (default on)", true)
  .option("--no-public", "Require private release repo")
  .action(async (files: string[], opts) => {
    const kind = opts.server
      ? "server"
      : opts.client
        ? "client"
        : opts.cli
          ? "cli"
          : undefined;
    await runReleaseUpload({
      files: [...files, ...(opts.file || [])],
      version: opts.version,
      kind,
      releaseRepo: opts.releaseRepo,
      public: opts.public,
    });
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

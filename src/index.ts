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
import {
  runAuthGithub,
  runAuthLogin,
  runAuthLogout,
  runAuthStatus,
} from "./commands/auth.js";
import {
  runWorkspaceExport,
  runWorkspaceImport,
  runWorkspacePull,
  runWorkspacePush,
} from "./commands/workspace.js";
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
    "Install server + client (default). Kept for compatibility."
  )
  .option(
    "--client-only",
    "Install only the client (skip API server / Mongo / Redis prompts)"
  )
  .option("-y, --yes", "Accept defaults where prompted for start")
  .action(async (opts) => {
    await runInit({
      dir: opts.dir,
      yes: opts.yes,
      serverVersion: opts.serverVersion,
      clientVersion: opts.clientVersion,
      withServer: opts.withServer,
      clientOnly: opts.clientOnly,
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
  .description("Request, activate, or inspect a Cliodot license")
  .option("--dir <path>", "Instance directory", process.cwd())
  .option(
    "--request",
    "Interactive license request (auto-issues developer/trial when approved)"
  )
  .option("--type <type>", "License type for --request (omit for developer)")
  .option("--activate <key>", "Activation key")
  .option("--status", "Fetch license status")
  .option("--token <jwt>", "Admin JWT for status (or CLIODOT_ADMIN_TOKEN)")
  .action(async (opts) => {
    await runLicense({
      dir: opts.dir,
      request: opts.request,
      type: opts.type,
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

const auth = program
  .command("auth")
  .description("Log in to a Cliodot API so the CLI can push/pull workspaces");

auth
  .command("login")
  .description("Open the app in a browser to log in (stores ~/.cliodot/auth.json)")
  .option("--api-url <url>", "Cliodot API base (default: staging)")
  .option("--app-url <url>", "Frontend origin (default: inferred from API URL)")
  .option("--api-key <key>", "API key (CI / non-interactive)")
  .option("--api-secret <secret>", "API secret")
  .option("--github-token <pat>", "Optional GitHub token (otherwise uses gh/git on this machine)")
  .action(async (opts) => {
    await runAuthLogin({
      apiUrl: opts.apiUrl,
      appUrl: opts.appUrl,
      apiKey: opts.apiKey,
      apiSecret: opts.apiSecret,
      githubToken: opts.githubToken,
    });
  });

auth
  .command("logout")
  .description("Clear stored Cliodot credentials")
  .action(async () => {
    await runAuthLogout();
  });

auth
  .command("status")
  .description("Show current Cliodot login")
  .action(async () => {
    await runAuthStatus();
  });

auth
  .command("github")
  .description("Use this machine's GitHub login (gh/git), or store a token")
  .option("--token <pat>", "Optional GitHub token (otherwise uses gh auth / git credentials)")
  .option("--clear", "Forget a stored token and go back to the local GitHub session")
  .action(async (opts) => {
    await runAuthGithub({ token: opts.token, clear: opts.clear });
  });

const workspace = program
  .command("workspace")
  .description("Export, import, and sync workspace bundles with GitHub");

workspace
  .command("push")
  .description("Export a project and write it to a GitHub repo")
  .option("--project <id>", "Project id")
  .option("--repo <owner/name>", "GitHub repository")
  .option("--path <path>", "File path in the repo")
  .option("--branch <branch>", "Branch", "main")
  .option("--message <message>", "Commit message")
  .option("--github-token <pat>", "Optional GitHub token (otherwise uses gh/git on this machine)")
  .action(async (opts) => {
    await runWorkspacePush({
      project: opts.project,
      repo: opts.repo,
      path: opts.path,
      branch: opts.branch,
      message: opts.message,
      githubToken: opts.githubToken,
    });
  });

workspace
  .command("pull")
  .description("Read a workspace bundle from GitHub and import it into this tenant")
  .option("--repo <owner/name>", "GitHub repository")
  .option("--path <path>", "File path in the repo")
  .option("--branch <branch>", "Branch", "main")
  .option("--name <name>", "Name for the imported project")
  .option("--github-token <pat>", "Optional GitHub token (otherwise uses gh/git on this machine)")
  .action(async (opts) => {
    await runWorkspacePull({
      repo: opts.repo,
      path: opts.path,
      branch: opts.branch,
      name: opts.name,
      githubToken: opts.githubToken,
    });
  });

workspace
  .command("export")
  .description("Export a project bundle to a local JSON file")
  .option("--project <id>", "Project id")
  .option("--out <file>", "Write to file (default: stdout)")
  .action(async (opts) => {
    await runWorkspaceExport({ project: opts.project, out: opts.out });
  });

workspace
  .command("import")
  .description("Import a local workspace bundle JSON into this tenant")
  .option("--file <path>", "Bundle JSON path")
  .option("--name <name>", "Name for the imported project")
  .action(async (opts) => {
    await runWorkspaceImport({ file: opts.file, name: opts.name });
  });

const release = program
  .command("release")
  .description(
    "Publish artifacts: server (private), client (private), or cli (public)"
  );

release
  .command("server")
  .description("Build server tarball (opt in: --docker, --npm, --push, --upload)")
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
    "Repo for git push + GitHub Release (default: community server)"
  )
  .option(
    "--enterprise",
    "Build snapshot (no src) + release on cliodot/cliodot-enterprise-server (implies --upload, private)"
  )
  .option("--image <name>", "GHCR image", CLI_DEFAULTS.serverImage)
  .option(
    "--only <stages>",
    "Run only these stages (comma-separated): docker,npm,tarball"
  )
  .option("--docker", "Build Docker image (off by default)", false)
  .option("--no-docker", "Skip Docker")
  .option("--native", "Build native tarball (default)", true)
  .option("--no-native", "Skip native tarball")
  .option("--push", "Build and push image to GHCR")
  .option("--upload", "Upload tarball to GitHub Releases")
  .option("--npm", "Publish @cliodot/server to npm (off by default)", false)
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
      enterprise: opts.enterprise === true,
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
  .description("Build client tarball (opt in: --docker, --npm, --push, --upload)")
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
    "Repo for git push + GitHub Release (default: community client)"
  )
  .option(
    "--enterprise",
    "Build snapshot (no src) + release on cliodot/cliodot-enterprise-client (implies --upload, private)"
  )
  .option("--image <name>", "GHCR image", CLI_DEFAULTS.clientImage)
  .option(
    "--only <stages>",
    "Run only these stages (comma-separated): docker,npm,tarball"
  )
  .option("--docker", "Build Docker image (off by default)", false)
  .option("--no-docker", "Skip Docker")
  .option("--native", "Build native tarball (default)", true)
  .option("--no-native", "Skip native tarball")
  .option("--push", "Build and push image to GHCR")
  .option("--upload", "Upload tarball to GitHub Releases")
  .option("--npm", "Publish @cliodot/client to npm (off by default)", false)
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
      enterprise: opts.enterprise === true,
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

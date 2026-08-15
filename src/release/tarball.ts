import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { CLI_DEFAULTS } from "../config.js";
import { runCommand } from "../util/fs.js";
import { obfuscateDirectory, stripSourceMaps } from "./obfuscate.js";
import { ensureDir, normalizeVersion, platformSlug, rmrf } from "./util.js";

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

function stripNextBuildJunk(nextDir: string): void {
  for (const junk of ["cache", "types", "trace", "diagnostics"]) {
    rmrf(path.join(nextDir, junk));
  }
}

function writeClientRuntimePackageJson(
  dir: string,
  version: string,
  sourcePkgPath?: string
): void {
  const pkgPath = path.join(dir, "package.json");
  const sourcePath =
    sourcePkgPath && fs.existsSync(sourcePkgPath) ? sourcePkgPath : pkgPath;
  const pkg = fs.existsSync(sourcePath)
    ? (JSON.parse(fs.readFileSync(sourcePath, "utf8")) as Record<
        string,
        unknown
      >)
    : {};
  pkg.name = CLI_DEFAULTS.clientNpmPackage;
  pkg.version = version;
  pkg.private = false;
  pkg.publishConfig = { access: "public" };
  pkg.scripts = { start: "node ./server.js" };
  delete pkg.devDependencies;
  delete pkg.workspaces;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
}

function flattenClientStandalone(staging: string, version: string): boolean {
  const standalone = path.join(staging, ".next", "standalone");
  if (!fs.existsSync(standalone) || !fs.existsSync(path.join(standalone, "server.js"))) {
    return false;
  }

  const staticTop = path.join(staging, "static");
  const lockFiles = ["package-lock.json", "yarn.lock"].filter((name) =>
    fs.existsSync(path.join(staging, name))
  );
  const sourcePkg = path.join(staging, "package.json");
  const tmp = `${staging}.standalone`;
  rmrf(tmp);
  copyDir(standalone, tmp);

  writeClientRuntimePackageJson(tmp, version, sourcePkg);

  if (fs.existsSync(staticTop)) {
    copyDir(staticTop, path.join(tmp, "static"));
    copyDir(staticTop, path.join(tmp, "public", "static"));
  }
  for (const lock of lockFiles) {
    const src = path.join(staging, lock);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(tmp, lock));
  }

  rmrf(staging);
  fs.renameSync(tmp, staging);
  return true;
}

function writeApiPublishPackageJson(
  repoRoot: string,
  staging: string,
  version: string
): void {
  const publishPath = path.join(repoRoot, "package-publish.json");
  const sourcePath = fs.existsSync(publishPath)
    ? publishPath
    : path.join(repoRoot, "package.json");
  const pkg = JSON.parse(fs.readFileSync(sourcePath, "utf8")) as Record<
    string,
    unknown
  >;
  const scripts =
    pkg.scripts && typeof pkg.scripts === "object"
      ? (pkg.scripts as Record<string, string>)
      : {};
  pkg.name = CLI_DEFAULTS.serverNpmPackage;
  pkg.version = version;
  pkg.private = false;
  pkg.publishConfig = { access: "public" };
  pkg.scripts = {
    start: scripts.start || "node ./build/app.js",
    ...(scripts["license:request"]
      ? { "license:request": scripts["license:request"] }
      : {
          "license:request":
            "node -r dotenv/config build/scripts/license-request.js",
        }),
  };
  delete pkg.workspaces;
  delete pkg.devDependencies;
  fs.writeFileSync(
    path.join(staging, "package.json"),
    JSON.stringify(pkg, null, 2) + "\n",
    "utf8"
  );
}

function installProdDeps(staging: string): void {
  const prodInstall = runCommand(
    "npm",
    ["ci", "--omit=dev", "--ignore-scripts"],
    { cwd: staging, inherit: true }
  );
  if (prodInstall.status !== 0) {
    const fallback = runCommand(
      "npm",
      ["install", "--omit=dev", "--ignore-scripts"],
      { cwd: staging, inherit: true }
    );
    if (fallback.status !== 0) {
      throw new Error("Failed to install production deps into release staging");
    }
  }
}

export function stageApiRelease(opts: {
  repoRoot: string;
  version: string;
  outDir: string;
  platform?: string;
  obfuscate?: boolean;
  withNodeModules?: boolean;
  buildScript?: string;
}): string {
  const version = normalizeVersion(opts.version);
  const slug = opts.platform || platformSlug();
  const staging = path.join(opts.outDir, `staging-api-${version}-${slug}`);
  rmrf(staging);
  ensureDir(staging);
  ensureDir(opts.outDir);

  const buildScript =
    opts.buildScript ||
    (opts.obfuscate !== false ? "build:release" : "build");
  const build = runCommand("npm", ["run", buildScript], {
    cwd: opts.repoRoot,
    inherit: true,
  });
  if (build.status !== 0) {
    throw new Error(`npm run ${buildScript} failed for API`);
  }

  const buildDir = path.join(opts.repoRoot, "build");
  if (!fs.existsSync(buildDir)) {
    throw new Error(`Missing build/ at ${opts.repoRoot}`);
  }

  stripSourceMaps(buildDir);
  copyDir(buildDir, path.join(staging, "build"));
  const schemasDir = path.join(opts.repoRoot, "schemas");
  if (!fs.existsSync(path.join(schemasDir, "json"))) {
    throw new Error(`Missing schemas/json at ${opts.repoRoot}`);
  }
  copyDir(schemasDir, path.join(staging, "schemas"));
  writeApiPublishPackageJson(opts.repoRoot, staging, version);
  for (const lock of ["package-lock.json", "yarn.lock"]) {
    const src = path.join(opts.repoRoot, lock);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(staging, lock));
    }
  }

  if (opts.withNodeModules !== false) {
    installProdDeps(staging);
  }

  return staging;
}

export function packStagingTarball(
  staging: string,
  outPath: string
): string {
  rmrf(outPath);
  ensureDir(path.dirname(outPath));
  const tar = spawnSync(
    "tar",
    [
      "-czf",
      outPath,
      "-C",
      staging,
      "--exclude=./node_modules",
      "--exclude=./.env",
      "--exclude=./.env.*",
      ".",
    ],
    {
      encoding: "utf8",
    }
  );
  if ((tar.status ?? 1) !== 0) {
    throw new Error(`tar failed: ${tar.stderr}`);
  }
  return outPath;
}

export function buildApiNativeTarball(opts: {
  repoRoot: string;
  version: string;
  outDir: string;
  platform?: string;
  obfuscate?: boolean;
}): string {
  const version = normalizeVersion(opts.version);
  const slug = opts.platform || platformSlug();
  const staging = stageApiRelease({ ...opts, withNodeModules: true });
  const asset = `cliodot-api-${version}.tar.gz`;
  const outPath = path.join(opts.outDir, asset);
  packStagingTarball(staging, outPath);
  return outPath;
}

export function stageClientRelease(opts: {
  clientDir: string;
  version: string;
  outDir: string;
  obfuscate?: boolean;
  withNodeModules?: boolean;
}): string {
  const version = normalizeVersion(opts.version);
  ensureDir(opts.outDir);
  const staging = path.join(opts.outDir, `staging-client-${version}`);
  rmrf(staging);
  ensureDir(staging);

  const build = runCommand("npm", ["run", "build"], {
    cwd: opts.clientDir,
    inherit: true,
  });
  if (build.status !== 0) {
    throw new Error("npm run build failed for client");
  }

  const pkg = path.join(opts.clientDir, "package.json");
  fs.copyFileSync(pkg, path.join(staging, "package.json"));
  for (const candidate of [".next", "dist", "build", "out"]) {
    const src = path.join(opts.clientDir, candidate);
    if (fs.existsSync(src)) {
      copyDir(
        src,
        path.join(staging, candidate),
        new Set(["node_modules", ".git", "cache"])
      );
    }
  }
  for (const name of [
    "public",
    "static",
    "package-lock.json",
    "yarn.lock",
    "next.config.js",
    "next.config.mjs",
    "next.config.ts",
  ]) {
    const src = path.join(opts.clientDir, name);
    if (fs.existsSync(src)) {
      const dest = path.join(staging, name);
      if (fs.statSync(src).isDirectory()) copyDir(src, dest);
      else fs.copyFileSync(src, dest);
    }
  }

  const staticSrc = path.join(opts.clientDir, "static");
  if (fs.existsSync(staticSrc)) {
    copyDir(staticSrc, path.join(staging, "public", "static"));
  }

  const nextDir = path.join(staging, ".next");
  if (fs.existsSync(nextDir)) {
    stripNextBuildJunk(nextDir);
  }

  const standalone = path.join(staging, ".next", "standalone");
  if (fs.existsSync(standalone)) {
    const standaloneStatic = path.join(standalone, ".next", "static");
    const builtStatic = path.join(staging, ".next", "static");
    if (fs.existsSync(builtStatic)) {
      copyDir(builtStatic, standaloneStatic);
    }
    const stagingPublic = path.join(staging, "public");
    if (fs.existsSync(stagingPublic)) {
      copyDir(stagingPublic, path.join(standalone, "public"));
    }
    stripSourceMaps(standalone);
    if (opts.obfuscate !== false) {
      obfuscateDirectory(standalone);
    }
    flattenClientStandalone(staging, version);
  } else {
    for (const candidate of [".next", "dist", "build", "out"]) {
      const staged = path.join(staging, candidate);
      if (!fs.existsSync(staged)) continue;
      stripSourceMaps(staged);
      if (opts.obfuscate !== false) {
        obfuscateDirectory(staged);
      }
    }
    writeClientRuntimePackageJson(staging, version, pkg);
  }

  if (opts.withNodeModules !== false) {
    installProdDeps(staging);
  }

  return staging;
}

export function buildClientNativeTarball(opts: {
  clientDir: string;
  version: string;
  outDir: string;
  obfuscate?: boolean;
}): string {
  const version = normalizeVersion(opts.version);
  const staging = stageClientRelease({ ...opts, withNodeModules: true });
  const asset = `cliodot-client-${version}.tar.gz`;
  const outPath = path.join(opts.outDir, asset);
  packStagingTarball(staging, outPath);
  return outPath;
}

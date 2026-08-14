import fs from "fs";
import path from "path";
import os from "os";
import { getNpmToken, runCommand } from "../util/fs.js";
import { ensureDir, rmrf } from "./util.js";

export function prepareNpmPackageJson(
  stagingDir: string,
  opts: { name: string; version: string; description?: string }
): void {
  const pkgPath = path.join(stagingDir, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as Record<
    string,
    unknown
  >;
  pkg.name = opts.name;
  pkg.version = opts.version;
  pkg.private = false;
  if (opts.description) pkg.description = opts.description;
  pkg.publishConfig = { access: "public" };
  delete pkg.workspaces;
  delete pkg.devDependencies;
  const scripts =
    pkg.scripts && typeof pkg.scripts === "object"
      ? (pkg.scripts as Record<string, string>)
      : {};
  pkg.scripts = {
    ...(scripts.start ? { start: scripts.start } : {}),
    ...(scripts.test ? { test: scripts.test } : {}),
  };
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
}

export function publishNpmPackage(opts: {
  stagingDir: string;
  name: string;
  version: string;
  description?: string;
  dryRun?: boolean;
}): string {
  const npmRoot = path.join(
    os.tmpdir(),
    `cliodot-npm-${opts.name.replace(/[/@]/g, "-")}-${Date.now()}`
  );
  rmrf(npmRoot);
  ensureDir(npmRoot);
  copyDir(opts.stagingDir, npmRoot);
  rmrf(path.join(npmRoot, "node_modules"));
  rmrf(path.join(npmRoot, ".next", "cache"));
  rmrf(path.join(npmRoot, ".next", "types"));
  rmrf(path.join(npmRoot, ".next", "trace"));
  rmrf(path.join(npmRoot, ".next", "diagnostics"));
  prepareNpmPackageJson(npmRoot, {
    name: opts.name,
    version: opts.version,
    description: opts.description,
  });

  if (fs.existsSync(path.join(npmRoot, "server.js"))) {
    const pkgPath = path.join(npmRoot, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as Record<
      string,
      unknown
    >;
    pkg.scripts = {
      ...((pkg.scripts as Record<string, string>) || {}),
      start: "node ./server.js",
    };
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
  }

  const args = ["publish", "--access", "public"];
  if (opts.dryRun) args.push("--dry-run");
  const npmToken = getNpmToken();
  const pubEnv: NodeJS.ProcessEnv = { ...process.env };
  if (npmToken) {
    pubEnv.NODE_AUTH_TOKEN = npmToken;
    pubEnv.NPM_TOKEN = npmToken;
  }
  const pub = runCommand("npm", args, {
    cwd: npmRoot,
    inherit: true,
    env: pubEnv,
  });
  rmrf(npmRoot);
  if (pub.status !== 0) {
    throw new Error(
      npmToken
        ? `npm publish failed for ${opts.name}`
        : `npm publish failed for ${opts.name} (set NPM_TOKEN in .env or env)`
    );
  }
  return opts.dryRun
    ? `(dry-run) ${opts.name}@${opts.version}`
    : `https://www.npmjs.com/package/${opts.name}/v/${opts.version}`;
}

function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    if (entry.name === "cache" && path.basename(src) === ".next") continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

import fs from "fs";
import path from "path";

export function findRepoRoot(start?: string): string {
  let dir = path.resolve(start || process.cwd());
  for (;;) {
    const pkgPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
          name?: string;
          workspaces?: unknown;
        };
        if (
          pkg.name === "cliodot-api" ||
          (Array.isArray(pkg.workspaces) &&
            pkg.workspaces.includes("packages/*"))
        ) {
          return dir;
        }
      } catch {
        /* continue */
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(start || process.cwd());
}

export function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/, "");
}

export function versionTag(version: string): string {
  const v = normalizeVersion(version);
  return `v${v}`;
}

export function platformSlug(platform?: string, arch?: string): string {
  const p = platform || process.platform;
  const a = arch || process.arch;
  const osPart = p === "darwin" ? "darwin" : p === "win32" ? "win" : "linux";
  const archPart = a === "arm64" ? "arm64" : "x64";
  return `${osPart}-${archPart}`;
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function rmrf(target: string): void {
  if (fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
}

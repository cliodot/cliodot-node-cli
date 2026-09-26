import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { CLI_DEFAULTS, CliodotInstance } from "../config.js";

export function resolveInstanceDir(dirFlag?: string): string {
  return path.resolve(dirFlag || process.cwd());
}

export function instancePath(dir: string): string {
  return path.join(dir, CLI_DEFAULTS.instanceFile);
}

export function envPath(dir: string): string {
  return path.join(dir, CLI_DEFAULTS.envFile);
}

export function serverDir(dir: string): string {
  return path.join(dir, "server");
}

export function clientDir(dir: string): string {
  return path.join(dir, "client");
}

export function serverEnvPath(dir: string): string {
  return path.join(serverDir(dir), CLI_DEFAULTS.envFile);
}

export function clientEnvPath(dir: string): string {
  return path.join(clientDir(dir), CLI_DEFAULTS.envFile);
}

export function readServerEnv(dir: string): Record<string, string> {
  const nested = serverEnvPath(dir);
  if (fs.existsSync(nested)) return readEnvFile(nested);
  return readEnvFile(envPath(dir));
}

export function readClientEnv(dir: string): Record<string, string> {
  const nested = clientEnvPath(dir);
  if (fs.existsSync(nested)) return readEnvFile(nested);
  const legacy = path.join(dir, "client.env");
  if (fs.existsSync(legacy)) return readEnvFile(legacy);
  return {};
}

export function readInstance(dir: string): CliodotInstance {
  const file = instancePath(dir);
  if (!fs.existsSync(file)) {
    throw new Error(
      `No ${CLI_DEFAULTS.instanceFile} in ${dir}. Run cliodot init or pass --dir.`
    );
  }
  return JSON.parse(fs.readFileSync(file, "utf8")) as CliodotInstance;
}

export function writeInstance(dir: string, instance: CliodotInstance): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    instancePath(dir),
    JSON.stringify(instance, null, 2) + "\n",
    "utf8"
  );
}

export function readEnvFile(file: string): Record<string, string> {
  if (!fs.existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    let key = trimmed.slice(0, eq).trim();
    if (key.startsWith("export ")) key = key.slice("export ".length).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function writeEnvFile(
  file: string,
  values: Record<string, string>,
  comments?: string[],
  keyComments?: Record<string, string[]>
): void {
  const lines: string[] = [];
  if (comments?.length) {
    for (const c of comments) lines.push(`# ${c}`);
    lines.push("");
  }
  for (const [key, value] of Object.entries(values)) {
    const notes = keyComments?.[key];
    if (notes?.length) {
      for (const n of notes) lines.push(`# ${n}`);
    }
    const escaped = value
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n");
    const needsQuotes = /[\s#"']/.test(value) || value.includes("\n");
    lines.push(needsQuotes ? `${key}="${escaped}"` : `${key}=${value}`);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join("\n") + "\n", "utf8");
}

export function mergeEnvPreserveSecrets(
  existing: Record<string, string>,
  next: Record<string, string>,
  preserveKeys: string[]
): Record<string, string> {
  const merged = { ...next };
  for (const key of preserveKeys) {
    if (existing[key]) merged[key] = existing[key];
  }
  return merged;
}

export function runCommand(
  command: string,
  args: string[],
  opts?: { cwd?: string; env?: NodeJS.ProcessEnv; inherit?: boolean }
): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(command, args, {
    cwd: opts?.cwd,
    env: { ...process.env, ...opts?.env },
    encoding: "utf8",
    stdio: opts?.inherit ? "inherit" : "pipe",
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout?.toString() || "",
    stderr: result.stderr?.toString() || "",
  };
}

export function openBrowser(url: string): boolean {
  if (process.platform === "darwin") {
    return runCommand("open", [url]).status === 0;
  }
  if (process.platform === "win32") {
    return runCommand("cmd", ["/c", "start", "", url]).status === 0;
  }
  return runCommand("xdg-open", [url]).status === 0;
}

export function commandExists(command: string): boolean {
  const probe = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(probe, [command], { encoding: "utf8" });
  return (result.status ?? 1) === 0;
}

export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "cliodot";
}

const TOKEN_ENV_KEYS = [
  "GITHUB_TOKEN",
  "GHCR_TOKEN",
  "GH_TOKEN",
  "NPM_TOKEN",
  "NODE_AUTH_TOKEN",
  "PUBLISH_NPM_TOKEN",
] as const;

const tokenSources: Partial<Record<(typeof TOKEN_ENV_KEYS)[number], string>> = {};

function trimToken(value?: string): string | undefined {
  const next = String(value || "").trim();
  return next || undefined;
}

export function getGithubToken(): string | undefined {
  return (
    trimToken(process.env.GHCR_TOKEN) ||
    trimToken(process.env.GITHUB_TOKEN) ||
    trimToken(process.env.GH_TOKEN) ||
    undefined
  );
}

export function describeGithubTokenSource(): string | undefined {
  if (trimToken(process.env.GHCR_TOKEN)) {
    return tokenSources.GHCR_TOKEN || "environment";
  }
  if (trimToken(process.env.GITHUB_TOKEN)) {
    return tokenSources.GITHUB_TOKEN || "environment";
  }
  if (trimToken(process.env.GH_TOKEN)) {
    return tokenSources.GH_TOKEN || "environment";
  }
  return undefined;
}

export function getNpmToken(): string | undefined {
  return (
    process.env.NPM_TOKEN ||
    process.env.NODE_AUTH_TOKEN ||
    process.env.PUBLISH_NPM_TOKEN ||
    undefined
  );
}

function collectEnvCandidates(extraDirs: string[] = []): string[] {
  const files: string[] = [];
  const add = (file: string) => files.push(path.resolve(file));
  add(path.join(process.cwd(), CLI_DEFAULTS.envFile));
  for (const dir of extraDirs) {
    add(path.join(dir, CLI_DEFAULTS.envFile));
  }
  let dir = path.resolve(process.cwd());
  for (;;) {
    add(path.join(dir, CLI_DEFAULTS.envFile));
    add(path.join(dir, CLI_DEFAULTS.cliPackagePath, CLI_DEFAULTS.envFile));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return files;
}

export function loadLocalEnv(extraDirs: string[] = []): void {
  const seen = new Set<string>();
  const cliEnvFiles: string[] = [];
  const generalFiles: string[] = [];
  for (const file of collectEnvCandidates(extraDirs)) {
    const abs = path.resolve(file);
    if (seen.has(abs) || !fs.existsSync(abs)) continue;
    seen.add(abs);
    if (abs.replace(/\\/g, "/").endsWith(`/${CLI_DEFAULTS.cliPackagePath}/${CLI_DEFAULTS.envFile}`)) {
      cliEnvFiles.push(abs);
    } else {
      generalFiles.push(abs);
    }
  }
  const apply = (file: string, overrideTokens: boolean) => {
    const values = readEnvFile(file);
    for (const [key, value] of Object.entries(values)) {
      const empty = process.env[key] === undefined || process.env[key] === "";
      const isToken = (TOKEN_ENV_KEYS as readonly string[]).includes(key);
      if (!empty && !(overrideTokens && isToken)) continue;
      process.env[key] = value;
      if (isToken) {
        tokenSources[key as (typeof TOKEN_ENV_KEYS)[number]] = file;
      }
    }
  };
  for (const file of generalFiles) apply(file, false);
  for (const file of cliEnvFiles) apply(file, true);
}

import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { CliodotInstance, instanceIsClientOnly } from "../../config.js";
import { readEnvFile } from "../../util/fs.js";

function runtimeDir(dir: string): string {
  return path.join(dir, ".cliodot");
}

function pidPath(dir: string, name: "api" | "client"): string {
  return path.join(runtimeDir(dir), `${name}.pid`);
}

function logPath(dir: string, name: "api" | "client"): string {
  return path.join(runtimeDir(dir), "logs", `${name}.log`);
}

function ensureRuntimeDirs(dir: string): void {
  fs.mkdirSync(path.join(runtimeDir(dir), "logs"), { recursive: true });
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPid(dir: string, name: "api" | "client"): number | null {
  const file = pidPath(dir, name);
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, "utf8").trim();
  const pid = Number(raw);
  if (!Number.isFinite(pid)) return null;
  if (!isPidAlive(pid)) {
    fs.unlinkSync(file);
    return null;
  }
  return pid;
}

function writePid(dir: string, name: "api" | "client", pid: number): void {
  ensureRuntimeDirs(dir);
  fs.writeFileSync(pidPath(dir, name), String(pid), "utf8");
}

function resolveStartCommand(
  appDir: string,
  kind: "api" | "client"
): { command: string; args: string[]; cwd: string } {
  const pkgPath = path.join(appDir, "package.json");
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
      scripts?: Record<string, string>;
      main?: string;
    };
    if (pkg.scripts?.start) {
      return { command: "npm", args: ["run", "start"], cwd: appDir };
    }
    if (pkg.main) {
      return { command: "node", args: [pkg.main], cwd: appDir };
    }
  }
  const candidates =
    kind === "api"
      ? ["dist/server.js", "dist/index.js", "server.js", "index.js"]
      : ["server.js", "dist/server.js", "index.js", "dist/index.js"];
  for (const c of candidates) {
    if (fs.existsSync(path.join(appDir, c))) {
      return { command: "node", args: [c], cwd: appDir };
    }
  }
  throw new Error(
    `Cannot find start entry for ${kind} in ${appDir}. Expected package.json start script or dist/index.js.`
  );
}

function startProcess(
  dir: string,
  name: "api" | "client",
  appDir: string
): number {
  ensureRuntimeDirs(dir);
  const existing = readPid(dir, name);
  if (existing) return existing;

  const start = resolveStartCommand(appDir, name);
  const envValues = readEnvFile(path.join(appDir, ".env"));
  const logFile = logPath(dir, name);
  const out = fs.openSync(logFile, "a");
  const child = spawn(start.command, start.args, {
    cwd: start.cwd,
    env: { ...process.env, ...envValues },
    detached: true,
    stdio: ["ignore", out, out],
  });
  child.unref();
  if (!child.pid) throw new Error(`Failed to start ${name}`);
  writePid(dir, name, child.pid);
  return child.pid;
}

export function nativeStart(
  dir: string,
  instance?: Pick<CliodotInstance, "clientOnly"> | null
): { api: number | null; client: number } {
  const clientOnly = instanceIsClientOnly(instance);
  const serverDir = path.join(dir, "server");
  const hasServer =
    !clientOnly &&
    (fs.existsSync(path.join(serverDir, "package.json")) ||
      fs.existsSync(path.join(serverDir, "build")));
  const api = hasServer ? startProcess(dir, "api", serverDir) : null;
  const client = startProcess(dir, "client", path.join(dir, "client"));
  return { api, client };
}

export function nativeStop(dir: string): void {
  for (const name of ["api", "client"] as const) {
    const pid = readPid(dir, name);
    if (!pid) continue;
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* already gone */
    }
    const file = pidPath(dir, name);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}

export function nativeStatus(dir: string): {
  api: { running: boolean; pid: number | null };
  client: { running: boolean; pid: number | null };
} {
  const apiPid = readPid(dir, "api");
  const clientPid = readPid(dir, "client");
  return {
    api: { running: apiPid != null, pid: apiPid },
    client: { running: clientPid != null, pid: clientPid },
  };
}

export function nativeLogs(dir: string, follow: boolean): void {
  ensureRuntimeDirs(dir);
  const files = [logPath(dir, "api"), logPath(dir, "client")];
  for (const f of files) {
    if (!fs.existsSync(f)) fs.writeFileSync(f, "", "utf8");
  }
  if (follow) {
    const child = spawn("tail", ["-F", ...files], { stdio: "inherit" });
    child.on("exit", (code) => {
      process.exitCode = code ?? 0;
    });
  } else {
    for (const f of files) {
      const content = fs.readFileSync(f, "utf8");
      const lines = content.split(/\r?\n/).slice(-100).join("\n");
      process.stdout.write(`===== ${path.basename(f)} =====\n${lines}\n`);
    }
  }
}

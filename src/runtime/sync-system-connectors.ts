import fs from "fs";
import path from "path";
import * as p from "@clack/prompts";
import { CliodotInstance, instanceIsClientOnly } from "../config.js";
import { runCommand, serverDir } from "../util/fs.js";
import { composeExec } from "./docker/compose.js";

const SCRIPT_REL = path.join("build", "scripts", "sync-system-connectors.js");

function resolveNativeSync(dir: string): { cwd: string; script: string } | null {
  const nested = serverDir(dir);
  const candidates = [
    { cwd: nested, script: path.join(nested, SCRIPT_REL) },
    { cwd: dir, script: path.join(dir, SCRIPT_REL) },
  ];
  for (const c of candidates) {
    if (fs.existsSync(c.script)) return c;
  }
  return null;
}

export function syncSystemConnectors(opts: {
  dir: string;
  instance: CliodotInstance;
  mode: "native" | "docker";
}): { ok: boolean; skipped?: boolean; message: string } {
  if (instanceIsClientOnly(opts.instance)) {
    return {
      ok: true,
      skipped: true,
      message: "Skipped system connector sync (client-only instance)",
    };
  }

  if (opts.mode === "docker") {
    const code = composeExec(opts.dir, "api", [
      "npm",
      "run",
      "sync:system-connectors",
    ]);
    if (code === 0) {
      return { ok: true, message: "System connectors synced (docker api)" };
    }
    return {
      ok: false,
      message: `System connector sync failed in api container (exit ${code})`,
    };
  }

  const resolved = resolveNativeSync(opts.dir);
  if (!resolved) {
    return {
      ok: false,
      message: `Missing ${SCRIPT_REL} under server/ — update the server package`,
    };
  }

  const rel = path.relative(resolved.cwd, resolved.script);
  const result = runCommand(
    "node",
    ["-r", "dotenv/config", rel],
    { cwd: resolved.cwd, inherit: true }
  );
  if (result.status === 0) {
    return { ok: true, message: "System connectors synced" };
  }
  return {
    ok: false,
    message: `System connector sync failed (exit ${result.status || 1})`,
  };
}

export function runSyncSystemConnectorsStep(opts: {
  dir: string;
  instance: CliodotInstance;
  mode: "native" | "docker";
  softFail?: boolean;
}): boolean {
  const spinner = p.spinner();
  spinner.start("Syncing system connectors");
  const result = syncSystemConnectors(opts);
  if (result.skipped) {
    spinner.stop(result.message);
    return true;
  }
  if (result.ok) {
    spinner.stop(result.message);
    return true;
  }
  spinner.stop("System connector sync failed");
  p.log.warn(result.message);
  if (!opts.softFail) {
    process.exitCode = 1;
  }
  return false;
}

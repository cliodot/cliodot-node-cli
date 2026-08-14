import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { findRepoRoot } from "./util.js";

export function stripSourceMaps(dir: string): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) stripSourceMaps(full);
    else if (entry.isFile() && entry.name.endsWith(".map")) fs.unlinkSync(full);
  }
}

export function obfuscateDirectory(dir: string): void {
  if (!fs.existsSync(dir)) {
    throw new Error(`Cannot obfuscate missing directory: ${dir}`);
  }
  stripSourceMaps(dir);

  const script = resolveObfuscateScript();
  const result = spawnSync(process.execPath, [script, dir], {
    encoding: "utf8",
    stdio: "inherit",
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error(`Obfuscation failed for ${dir}`);
  }
}

function resolveObfuscateScript(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "../../../../scripts/obfuscate.js"),
    path.resolve(findRepoRoot(), "scripts/obfuscate.js"),
    path.resolve(process.cwd(), "scripts/obfuscate.js"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(
    "scripts/obfuscate.js not found. Run releases from the flowsync-api monorepo (or install javascript-obfuscator + script)."
  );
}

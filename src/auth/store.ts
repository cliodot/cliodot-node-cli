import fs from "fs";
import os from "os";
import path from "path";
import { CLI_DEFAULTS } from "../config.js";

export const AUTH_STORE_VERSION = 1;

export type CliodotAuthRecord = {
  version: number;
  apiUrl: string;
  appUrl?: string;
  accessToken: string;
  tokenExpiresAt?: string;
  email?: string;
  userId?: string;
  tenantId?: string;
  githubToken?: string;
  githubFrom?: "local" | "stored";
  loggedInAt: string;
};

export function authDir(): string {
  return path.join(os.homedir(), ".cliodot");
}

export function authFilePath(): string {
  return process.env.CLIODOT_AUTH_FILE || path.join(authDir(), "auth.json");
}

export function normalizeApiUrl(input?: string): string {
  const raw = String(input || CLI_DEFAULTS.clientApiBaseUrl).trim();
  if (!raw) {
    throw new Error("API URL is required");
  }
  const url = raw.replace(/\/+$/, "");
  if (url.endsWith("/api-core/cliodot")) return url;
  if (url.endsWith("/api-core")) return `${url}/cliodot`;
  return `${url}/api-core/cliodot`;
}

export function normalizeAppUrl(input?: string, apiUrl?: string): string {
  const explicit = String(input || process.env.CLIODOT_APP_URL || "").trim().replace(/\/+$/, "");
  if (explicit) return explicit;
  try {
    const api = new URL(normalizeApiUrl(apiUrl));
    if (api.hostname === "localhost" || api.hostname === "127.0.0.1") {
      return `${api.protocol}//${api.hostname}:${CLI_DEFAULTS.defaultClientPort}`;
    }
    return api.origin;
  } catch {
    return CLI_DEFAULTS.clientAppUrl;
  }
}

export function readAuth(): CliodotAuthRecord | null {
  const file = authFilePath();
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as CliodotAuthRecord;
    if (!parsed?.accessToken || !parsed?.apiUrl) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function requireAuth(): CliodotAuthRecord {
  const auth = readAuth();
  if (!auth) {
    throw new Error("Not logged in. Run `cliodot auth login` first.");
  }
  if (auth.tokenExpiresAt) {
    const expires = Date.parse(auth.tokenExpiresAt);
    if (!Number.isNaN(expires) && expires <= Date.now()) {
      throw new Error("Session expired. Run `cliodot auth login` again.");
    }
  }
  return auth;
}

export function writeAuth(record: CliodotAuthRecord): string {
  const file = authFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(record, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600,
  });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* windows */
  }
  return file;
}

export function clearAuth(): boolean {
  const file = authFilePath();
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}

export function resolveGithubToken(explicit?: string, stored?: string): string | undefined {
  return (
    explicit?.trim() ||
    stored?.trim() ||
    process.env.GITHUB_TOKEN ||
    process.env.GH_TOKEN ||
    process.env.GHCR_TOKEN ||
    undefined
  );
}

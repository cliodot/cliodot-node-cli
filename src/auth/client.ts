import { CliodotAuthRecord, normalizeApiUrl } from "./store.js";

export class CliodotApiError extends Error {
  status: number;
  body?: unknown;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export async function apiRequest<T = any>(opts: {
  apiUrl: string;
  path: string;
  method?: string;
  token?: string;
  githubToken?: string;
  body?: unknown;
}): Promise<T> {
  const base = normalizeApiUrl(opts.apiUrl);
  const path = opts.path.startsWith("/") ? opts.path : `/${opts.path}`;
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "cliodot-cli",
  };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.githubToken) headers["X-GitHub-Token"] = opts.githubToken;

  const res = await fetch(`${base}${path}`, {
    method: opts.method || "GET",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let json: any;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (!res.ok) {
    const message =
      json?.message ||
      json?.error ||
      json?.errors?.[0]?.msg ||
      json?.errors?.[0]?.message ||
      text ||
      `HTTP ${res.status}`;
    throw new CliodotApiError(String(message), res.status, json);
  }
  return json as T;
}

export async function loginWithPassword(opts: {
  apiUrl: string;
  email: string;
  password: string;
}): Promise<{
  accessToken: string;
  tokenExpiresAt?: string;
  user?: { _id?: string; email?: string; tenant_id?: string };
}> {
  return apiRequest({
    apiUrl: opts.apiUrl,
    path: "/user/login",
    method: "POST",
    body: { email: opts.email, password: opts.password },
  });
}

export async function loginWithApiKey(opts: {
  apiUrl: string;
  apiKey: string;
  apiSecret: string;
}): Promise<{
  accessToken: string;
  tokenExpiresAt?: string;
  user?: { _id?: string; email?: string; tenant_id?: string };
}> {
  return apiRequest({
    apiUrl: opts.apiUrl,
    path: "/user/login-with-api-key",
    method: "POST",
    body: { apiKey: opts.apiKey, apiSecret: opts.apiSecret },
  });
}

export async function startCliLogin(opts: {
  apiUrl: string;
  appUrl?: string;
}): Promise<{
  session_id: string;
  verify_url: string;
  expires_at: string;
  poll_interval_ms?: number;
}> {
  return apiRequest({
    apiUrl: opts.apiUrl,
    path: "/user/cli-login/start",
    method: "POST",
    body: opts.appUrl ? { app_url: opts.appUrl } : {},
  });
}

export async function pollCliLogin(opts: {
  apiUrl: string;
  sessionId: string;
}): Promise<{
  status: "pending" | "approved" | "expired" | "consumed" | "denied";
  accessToken?: string;
  tokenExpiresAt?: string;
  user?: { _id?: string; email?: string; tenant_id?: string };
}> {
  return apiRequest({
    apiUrl: opts.apiUrl,
    path: `/user/cli-login/poll?session=${encodeURIComponent(opts.sessionId)}`,
  });
}

export function authRequest<T = any>(
  auth: CliodotAuthRecord,
  opts: { path: string; method?: string; body?: unknown; githubToken?: string }
): Promise<T> {
  return apiRequest<T>({
    apiUrl: auth.apiUrl,
    token: auth.accessToken,
    path: opts.path,
    method: opts.method,
    body: opts.body,
    githubToken: opts.githubToken,
  });
}

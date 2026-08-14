import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { CLI_DEFAULTS, CliodotInstance, SELECTABLE_APPS, instanceIsClientOnly } from "../config.js";
import {
  LICENSE_ENCRYPTION_KEY_DEFAULT,
  LICENSE_PUBLIC_KEY_DEFAULT,
} from "./license-defaults.js";
import { INSTALL_ENV_KEY_COMMENTS } from "./env-comments.js";
import { generateSecrets } from "./secrets.js";

const here = path.dirname(fileURLToPath(import.meta.url));

const CODE_DEFAULTED_ENV_KEYS = new Set([
  "CENTRAL_HUB_URL",
  "CENTRAL_HUB_SYNC_API_KEY",
  "LICENSE_SERVER_URL",
]);

const PLACEHOLDER_VALUES = new Set([
  "your-moments-bucket",
  "your_access_key",
  "your_secret_key",
  "https://your-bucket.s3.amazonaws.com",
  "your_cloud_name",
  "your_api_key",
  "your_api_secret",
  "your-email@example.com",
  "local or aws",
  "https://your-client-app/api/connectors/oauth/callback",
  "https://api.yourdomain.com",
]);

function appFeatureEnv(apps: string[]): Record<string, string> {
  const selected = new Set(apps);
  const out: Record<string, string> = {};
  for (const app of SELECTABLE_APPS) {
    const key = app.feature.toUpperCase();
    out[key] = selected.has(app.id) ? "true" : "false";
  }
  return out;
}

function findEnvExample(): string | null {
  const candidates = [
    path.resolve(here, "../../env.example"),
    path.resolve(process.cwd(), "packages/cliodot-cli/env.example"),
    path.resolve(process.cwd(), ".env.example"),
    path.resolve(here, "../../../../.env.example"),
    path.resolve(here, "../../../../../.env.example"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function stripInlineComment(value: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === "#" && !inSingle && !inDouble) {
      if (i === 0 || /\s/.test(value[i - 1])) {
        return value.slice(0, i).trim();
      }
    }
  }
  return value.trim();
}

function parseEnvExample(file: string): { order: string[]; values: Record<string, string> } {
  const order: string[] = [];
  const values: Record<string, string> = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key || CODE_DEFAULTED_ENV_KEYS.has(key)) continue;
    let value = stripInlineComment(trimmed.slice(eq + 1));
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (PLACEHOLDER_VALUES.has(value)) value = "";
    if (!(key in values)) order.push(key);
    values[key] = value;
  }
  return { order, values };
}

function installFilledDefaults(instance: CliodotInstance): Record<string, string> {
  const apiUrl = `http://localhost:${instance.ports.api}`;
  return {
    EVENT_BROKER_FAST: "bullmq",
    EVENT_BROKER_RELIABLE: "bullmq",
    EVENT_BROKER_ORDERED: "redis-streams",
    EVENT_BROKER_BROADCAST: "bullmq",
    EVENT_BROKER_STREAM: "",
    EVENT_BROKER_SCHEDULED: "bullmq",
    KAFKA_BROKERS: "",
    KAFKA_CLIENT_ID: "cliodot-event",
    KAFKA_GROUP_ID: "cliodot-event-bus",
    KAFKA_TOPIC_PREFIX: "cliodot.events",
    KAFKA_SSL: "false",
    KAFKA_SASL_MECHANISM: "",
    KAFKA_SASL_USERNAME: "",
    KAFKA_SASL_PASSWORD: "",
    RABBITMQ_URL: "",
    RABBITMQ_EXCHANGE: "cliodot.events",
    RABBITMQ_PREFETCH: "20",
    RABBITMQ_QUEUE_PREFIX: "cliodot.events",
    REDIS_STREAMS_PREFIX: "cliodot.events",
    REDIS_STREAMS_GROUP: "cliodot-event-bus",
    WORKFLOW_LOG_FLUSH_INTERVAL_MS: "15000",
    WORKFLOW_LOG_BATCH_SIZE: "300",
    STORAGE_TYPE: "local",
    MAX_FILE_SIZE: "104857600",
    MAX_IMAGE_SIZE: "10485760",
    LOCAL_UPLOAD_DIR: "moments",
    DEVICE_TOKEN_TTL_MS: "31536000000",
    WEBHOOK_APP_RECEIVE_RETENTION_MS: "259200000",
    SSRF_ALLOW_PRIVATE_URLS: instance.mode === "local" ? "true" : "false",
    OUTBOUND_TLS_INSECURE: instance.mode === "local" ? "true" : "false",
    GATEWAY_RATE_LIMIT_RPM: "60",
    CERT_DIR: "./certs",
    ACME_STAGING: "true",
    DOMAIN_VERIFICATION_SCHEDULE: "*/5 * * * *",
    SUPPORT_EMAIL: "support@flowsync.com",
    TELEMETRY_ENABLED: "false",
    AUTO_CHECK_UPDATES: "true",
    CACHE_BACKEND: "memory",
    FAST_RUNTIME_MODE: "legacy",
    DEV_RUNTIME_CACHE_ENABLED: "false",
    PROD_ARTIFACT_RUNTIME: "true",
    PROD_STORE_UI_SNAPSHOT: "false",
    DOMAIN_CACHE_TTL: "21600000",
    WORKFLOW_HOT_CACHE_MAX_ENTRIES: "200",
    COMPILED_RUNTIME_TTL: "604800000",
    COMPILED_RUNTIME_DEV_TTL: "300000",
    CONNECTOR_DEFINITION_CACHE_ENABLED: "true",
    CONNECTOR_AUTH_CACHE_ENABLED: "true",
    CONNECTOR_RUNTIME_CACHE_ENABLED: "true",
    CONNECTOR_RUNTIME_STALE_WHILE_REVALIDATE: "true",
    CONNECTOR_EXECUTOR_POOL_ENABLED: "true",
    CONNECTOR_RUNTIME_CACHE_TTL_PROD: "604800000",
    CONNECTOR_RUNTIME_CACHE_TTL_DEV: "300000",
    CONNECTOR_RUNTIME_CACHE_MAX_ENTRIES: "10000",
    CONNECTOR_EXECUTOR_POOL_MAX_ENTRIES: "500",
    CONNECTOR_INSTALLATION_CACHE_ENABLED: "true",
    CONNECTOR_INSTALLATION_CACHE_TTL: "86400000",
    WORKFLOW_CACHE_BACKEND: "redis",
    DOMAIN_CACHE_BACKEND: "redis",
    GATEWAY_CACHE_BACKEND: "redis",
    HUB_CONNECTORS_ENABLED:
      instance.mode === "local" || instance.mode === "production" ? "true" : "false",
    REMOTE_CONNECTORS_ENABLED: "false",
    CONNECTOR_EXCHANGE_ENABLED: "false",
    DEPLOYMENT_ID: instance.name || "local-dev",
    DEPLOYMENT_REF: apiUrl,
    AI_COMPRESSION_THRESHOLD: "20",
    AI_CONTEXT_RECENT_TURNS: "6",
    AI_CONTEXT_RETRIEVED_TURNS: "3",
    AI_CONTEXT_RETRIEVED_CONNECTORS: "5",
    AI_SESSION_TTL_DAYS: "7",
    AI_USE_TOOL_CALLING: "true",
    BASE_DOMAIN: "flowsync.com",
    CLOUDINARY_FOLDER: "cliodot-moments",
    LOG_LEVEL: instance.mode === "local" ? "info" : "error",
  };
}

export function buildEnvValues(
  instance: CliodotInstance,
  opts?: { secrets?: ReturnType<typeof generateSecrets>; existing?: Record<string, string> }
): Record<string, string> {
  const secrets = opts?.secrets || generateSecrets();
  const existing = opts?.existing || {};
  const apiUrl = `http://localhost:${instance.ports.api}`;
  const clientUrl = `http://localhost:${instance.ports.client}`;

  const examplePath = findEnvExample();
  const parsed = examplePath
    ? parseEnvExample(examplePath)
    : { order: [] as string[], values: {} as Record<string, string> };

  const filled = installFilledDefaults(instance);
  const merged: Record<string, string> = { ...parsed.values };

  for (const [k, v] of Object.entries(filled)) {
    if (!(k in merged) || merged[k] === "" || PLACEHOLDER_VALUES.has(merged[k])) {
      merged[k] = v;
    } else if (
      k.startsWith("EVENT_BROKER_") ||
      k.startsWith("CONNECTOR_") ||
      k.endsWith("_CACHE_ENABLED") ||
      k.endsWith("_CACHE_BACKEND") ||
      k === "STORAGE_TYPE" ||
      k === "WORKFLOW_CACHE_BACKEND" ||
      k === "DOMAIN_CACHE_BACKEND" ||
      k === "GATEWAY_CACHE_BACKEND"
    ) {
      merged[k] = v;
    }
  }

  Object.assign(merged, {
    NODE_ENV: "production",
    DEPLOYMENT_MODE: instance.mode,
    MODE: "production",
    PORT: String(instance.ports.api),
    CLIENT_URL: clientUrl,
    SERVER_URL: apiUrl,
    API_BASE_URL: apiUrl,
    FRONTEND_URL: clientUrl,
    CLIODOT_CLIENT_URL: clientUrl,
    APP_URL: apiUrl,
    CLIODOT_BASE_URL: apiUrl,
    MONGODB_URI: instance.mongo.uri,
    MONGODB_NAME: instance.mongo.name,
    REDIS_URL: instance.redis.url,
    REDIS_STREAMS_URL: instance.redis.url,
    APP_NAME: instance.name,
    DEPLOYMENT_ID: instance.name || "local-dev",
    DEPLOYMENT_REF: apiUrl,
    CONNECTOR_OAUTH_CALLBACK_URL: `${clientUrl}/api/connectors/oauth/callback`,
    OAUTH_APPS_API_HOST: apiUrl,
    LOG_LEVEL: instance.mode === "local" ? "info" : "error",
    ...secrets,
    ...appFeatureEnv(instance.apps),
    LICENSE_PUBLIC_KEY: LICENSE_PUBLIC_KEY_DEFAULT,
    LICENSE_ENCRYPTION_KEY: LICENSE_ENCRYPTION_KEY_DEFAULT,
  });

  for (const key of CODE_DEFAULTED_ENV_KEYS) {
    delete merged[key];
  }

  for (const [k, v] of Object.entries(existing)) {
    if (CODE_DEFAULTED_ENV_KEYS.has(k)) continue;
    if (k === "LICENSE_PUBLIC_KEY" || k === "LICENSE_ENCRYPTION_KEY") continue;
    if (v) merged[k] = v;
  }

  const ordered: Record<string, string> = {};
  const seen = new Set<string>();
  for (const key of parsed.order) {
    if (!(key in merged) || CODE_DEFAULTED_ENV_KEYS.has(key)) continue;
    ordered[key] = merged[key] ?? "";
    seen.add(key);
  }
  for (const key of Object.keys(merged)) {
    if (seen.has(key) || CODE_DEFAULTED_ENV_KEYS.has(key)) continue;
    ordered[key] = merged[key] ?? "";
  }

  ordered.LICENSE_PUBLIC_KEY = LICENSE_PUBLIC_KEY_DEFAULT;
  ordered.LICENSE_ENCRYPTION_KEY = LICENSE_ENCRYPTION_KEY_DEFAULT;

  return ordered;
}

function isLocalDevUrl(url?: string): boolean {
  if (!url) return true;
  return /localhost|127\.0\.0\.1/i.test(url);
}

export function buildClientEnvValues(
  instance: CliodotInstance,
  existing?: Record<string, string>
): Record<string, string> {
  const prev = existing || {};
  const clientOnly = instanceIsClientOnly(instance);

  if (!clientOnly) {
    const apiHost =
      instance.runtime === "docker"
        ? `http://api:${instance.ports.api}`
        : `http://localhost:${instance.ports.api}`;
    return {
      NEXT_PUBLIC_API_BASE_URL: prev.NEXT_PUBLIC_API_BASE_URL || "/api",
      API_BASE_URL: `${apiHost}/api-core/cliodot`,
      BILLING_BASE_URL: `${apiHost}/api-core/biller`,
      NEXT_PUBLIC_APP_URL: `http://localhost:${instance.ports.client}`,
    };
  }

  return {
    NEXT_PUBLIC_API_BASE_URL: prev.NEXT_PUBLIC_API_BASE_URL || "/api",
    API_BASE_URL:
      !isLocalDevUrl(prev.API_BASE_URL) && prev.API_BASE_URL
        ? prev.API_BASE_URL
        : CLI_DEFAULTS.clientApiBaseUrl,
    BILLING_BASE_URL:
      !isLocalDevUrl(prev.BILLING_BASE_URL) && prev.BILLING_BASE_URL
        ? prev.BILLING_BASE_URL
        : CLI_DEFAULTS.clientBillingBaseUrl,
    NEXT_PUBLIC_APP_URL:
      !isLocalDevUrl(prev.NEXT_PUBLIC_APP_URL) && prev.NEXT_PUBLIC_APP_URL
        ? prev.NEXT_PUBLIC_APP_URL
        : CLI_DEFAULTS.clientAppUrl,
  };
}

export function writeClientEnvFile(
  file: string,
  instance: CliodotInstance,
  existing?: Record<string, string>
): void {
  const values = buildClientEnvValues(instance, existing);
  const content = [
    "# FlowSync API Configuration",
    "# Client-side API URL (exposed to browser - uses Next.js API routes)",
    `NEXT_PUBLIC_API_BASE_URL=${values.NEXT_PUBLIC_API_BASE_URL}`,
    "",
    "# Server-side API URL (NOT exposed to client - only used in Next.js API routes)",
    "# This is the actual backend URL",
    `API_BASE_URL=${values.API_BASE_URL}`,
    `BILLING_BASE_URL=${values.BILLING_BASE_URL}`,
    `NEXT_PUBLIC_APP_URL=${values.NEXT_PUBLIC_APP_URL}`,
    "",
  ].join("\n");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

export function envComments(instance: CliodotInstance): string[] {
  return [
    `Cliodot instance: ${instance.name}`,
    `runtime: ${instance.runtime} | mode: ${instance.mode}`,
    "Generated by cliodot init. Secrets are preserved on cliodot update.",
    "Local mode: hub browse/mirror allowed; hub publish always denied.",
    "WARNING: Do not alter LICENSE_PUBLIC_KEY or LICENSE_ENCRYPTION_KEY — required for license validation with Cliodot.",
    "Hub URL / sync key / license server URL are built into the server binary (override only if you must).",
  ];
}

export const LICENSE_ENV_KEY_COMMENTS: Record<string, string[]> = {
  LICENSE_ENCRYPTION_KEY: INSTALL_ENV_KEY_COMMENTS.LICENSE_ENCRYPTION_KEY,
  LICENSE_PUBLIC_KEY: INSTALL_ENV_KEY_COMMENTS.LICENSE_PUBLIC_KEY,
};

export { INSTALL_ENV_KEY_COMMENTS };

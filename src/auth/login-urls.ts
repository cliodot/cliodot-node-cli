import path from "path";
import { readEnvFile, readServerEnv, resolveInstanceDir } from "../util/fs.js";
import { normalizeApiUrl, normalizeAppUrl } from "./store.js";

function firstNonEmpty(...values: Array<string | undefined>): string {
  for (const value of values) {
    const trimmed = String(value || "").trim();
    if (trimmed) return trimmed;
  }
  return "";
}

function readInstanceAuthEnv(dir?: string): {
  deploymentRef?: string;
  clientUrl?: string;
} {
  const root = resolveInstanceDir(dir);
  const nested = readServerEnv(root);
  const rootEnv = readEnvFile(path.join(root, ".env"));
  return {
    deploymentRef: firstNonEmpty(nested.DEPLOYMENT_REF, rootEnv.DEPLOYMENT_REF),
    clientUrl: firstNonEmpty(
      nested.CLIODOT_CLIENT_URL,
      rootEnv.CLIODOT_CLIENT_URL
    ),
  };
}

/**
 * 1. --api-url / --app-url
 * 2. Current directory (or --dir) .env: DEPLOYMENT_REF + CLIODOT_CLIENT_URL
 * 3. process env
 * 4. last saved session
 */
export function resolveLoginUrls(opts: {
  apiUrl?: string;
  appUrl?: string;
  dir?: string;
  storedApiUrl?: string;
  storedAppUrl?: string;
}): { apiUrl: string; appUrl?: string } {
  const instanceEnv = readInstanceAuthEnv(opts.dir);
  const deploymentRef = firstNonEmpty(
    opts.apiUrl,
    instanceEnv.deploymentRef,
    process.env.DEPLOYMENT_REF,
    opts.storedApiUrl
  );
  if (!deploymentRef) {
    throw new Error(
      "DEPLOYMENT_REF is required for login. Set it in the instance .env, or pass --api-url."
    );
  }
  const clientUrl = firstNonEmpty(
    opts.appUrl,
    instanceEnv.clientUrl,
    process.env.CLIODOT_CLIENT_URL,
    opts.storedAppUrl
  );
  return {
    apiUrl: normalizeApiUrl(deploymentRef),
    appUrl: normalizeAppUrl(clientUrl),
  };
}

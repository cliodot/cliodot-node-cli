export const CLI_DEFAULTS = {
  org: "Arrikk",
  registry: "ghcr.io",
  serverImage: "ghcr.io/arrikk/cliodot-server",
  clientImage: "ghcr.io/arrikk/cliodot-client",
  serverRepo: "Arrikk/flowsync-api",
  clientRepo: "Arrikk/flowsync-app",
  cliRepo: "Arrikk/flowsync-api",
  serverReleaseRepo: "cliodot/cliodot-community-server",
  clientReleaseRepo: "cliodot/cliodot-community-client",
  serverEnterpriseReleaseRepo: "cliodot/cliodot-enterprise-server",
  clientEnterpriseReleaseRepo: "cliodot/cliodot-enterprise-client",
  cliReleaseRepo: "Arrikk/cliodot",
  cliPackagePath: "packages/cliodot-cli",
  cliNpmPackage: "@cliodot/cli",
  serverNpmPackage: "@cliodot/server",
  clientNpmPackage: "@cliodot/client",
  releaseRepo: "cliodot/cliodot-community-server",
  clientOnly: false,
  clientApiBaseUrl: "https://stg.flowfly.dev/api-core/cliodot",
  clientBillingBaseUrl: "https://stg.flowfly.dev/api-core/biller",
  clientAppUrl: "https://stg.flowfly.dev",
  defaultTag: "latest",
  defaultApiPort: 8901,
  defaultClientPort: 3000,
  instanceFile: "cliodot.instance.json",
  envFile: ".env",
} as const;

export function isCommunityReleaseRepo(repo: string): boolean {
  const value = String(repo || "").trim().toLowerCase();
  return (
    value === CLI_DEFAULTS.serverReleaseRepo.toLowerCase() ||
    value === CLI_DEFAULTS.clientReleaseRepo.toLowerCase() ||
    value.endsWith("/cliodot-community-server") ||
    value.endsWith("/cliodot-community-client")
  );
}

export function isEnterpriseReleaseRepo(repo: string): boolean {
  const value = String(repo || "").trim().toLowerCase();
  return (
    value === CLI_DEFAULTS.serverEnterpriseReleaseRepo.toLowerCase() ||
    value === CLI_DEFAULTS.clientEnterpriseReleaseRepo.toLowerCase() ||
    value.endsWith("/cliodot-enterprise-server") ||
    value.endsWith("/cliodot-enterprise-client")
  );
}

/** Community and enterprise release repos receive a git snapshot plus the GitHub Release. */
export function mirrorsReleaseBuild(repo: string): boolean {
  return isCommunityReleaseRepo(repo) || isEnterpriseReleaseRepo(repo);
}

export const SELECTABLE_APPS = [
  { id: "oauth", label: "OAuth Apps", feature: "oauth_apps_enabled" },
  { id: "auth", label: "Auth Apps", feature: "auth_apps_enabled" },
  { id: "event", label: "Event Apps", feature: "event_apps_enabled" },
  { id: "memory", label: "Memory Apps", feature: "memory_apps_enabled" },
  { id: "identity", label: "Identity Apps", feature: "identity_apps_enabled" },
  { id: "webhook", label: "Webhook Apps", feature: "webhook_apps_enabled" },
  { id: "commercial", label: "Commercial Apps", feature: "commercial_apps_enabled" },
  { id: "gateways", label: "Gateways", feature: "gateways_enabled" },
] as const;

export type SelectableAppId = (typeof SELECTABLE_APPS)[number]["id"];

export type RuntimeKind = "docker" | "native";
export type DeploymentMode = "local" | "production" | "enterprise";

export type CliodotInstance = {
  name: string;
  runtime: RuntimeKind;
  mode: DeploymentMode;
  apps: SelectableAppId[];
  ports: { api: number; client: number };
  registry?: string;
  serverImage?: string;
  serverTag?: string;
  clientImage?: string;
  clientTag?: string;
  serverVersion?: string;
  clientVersion?: string;
  releaseRepo?: string;
  clientOnly?: boolean;
  mongo: {
    kind: "compose" | "existing" | "atlas";
    uri: string;
    name: string;
  };
  redis: {
    kind: "compose" | "existing";
    url: string;
  };
  createdAt: string;
  updatedAt: string;
};

export function instanceIsClientOnly(
  instance?: Pick<CliodotInstance, "clientOnly"> | null
): boolean {
  if (instance && typeof instance.clientOnly === "boolean") {
    return instance.clientOnly;
  }
  return CLI_DEFAULTS.clientOnly;
}

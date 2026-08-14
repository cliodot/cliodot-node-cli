import fs from "fs";
import path from "path";
import { CLI_DEFAULTS, CliodotInstance, instanceIsClientOnly } from "../../config.js";
import { runCommand } from "../../util/fs.js";

export function writeDockerCompose(dir: string, instance: CliodotInstance): void {
  const clientOnly = instanceIsClientOnly(instance);
  const includeMongo = !clientOnly && instance.mongo.kind === "compose";
  const includeRedis = !clientOnly && instance.redis.kind === "compose";
  const serverImage = `${instance.serverImage || CLI_DEFAULTS.serverImage}:${instance.serverTag || "latest"}`;
  const clientImage = `${instance.clientImage || CLI_DEFAULTS.clientImage}:${instance.clientTag || "latest"}`;

  const lines: string[] = ["services:"];

  if (!clientOnly) {
    const dependsApi: string[] = [];
    if (includeMongo) dependsApi.push("mongo");
    if (includeRedis) dependsApi.push("redis");

    lines.push(
      "  api:",
      `    image: ${serverImage}`,
      "    env_file: ./server/.env",
      "    ports:",
      `      - "${instance.ports.api}:${instance.ports.api}"`,
      "    restart: unless-stopped"
    );

    if (dependsApi.length) {
      lines.push("    depends_on:");
      for (const d of dependsApi) lines.push(`      - ${d}`);
    }

    if (includeMongo) {
      lines.push(
        "    environment:",
        "      MONGODB_URI: mongodb://mongo:27017",
        `      MONGODB_NAME: ${instance.mongo.name}`
      );
    }
    if (includeRedis) {
      if (!includeMongo) lines.push("    environment:");
      lines.push("      REDIS_URL: redis://redis:6379");
    }
  }

  lines.push(
    "  client:",
    `    image: ${clientImage}`,
    "    env_file: ./client/.env",
    "    ports:",
    `      - "${instance.ports.client}:${instance.ports.client}"`
  );
  if (!clientOnly) {
    lines.push("    depends_on:", "      - api");
  }
  lines.push("    restart: unless-stopped");

  if (includeMongo) {
    lines.push(
      "  mongo:",
      "    image: mongo:7",
      "    volumes:",
      "      - cliodot_mongo_data:/data/db",
      "    restart: unless-stopped"
    );
  }

  if (includeRedis) {
    lines.push(
      "  redis:",
      "    image: redis:7-alpine",
      "    volumes:",
      "      - cliodot_redis_data:/data",
      "    restart: unless-stopped"
    );
  }

  if (includeMongo || includeRedis) {
    lines.push("volumes:");
    if (includeMongo) lines.push("  cliodot_mongo_data:");
    if (includeRedis) lines.push("  cliodot_redis_data:");
  }

  fs.writeFileSync(path.join(dir, "docker-compose.yml"), lines.join("\n") + "\n", "utf8");
}

export function compose(dir: string, args: string[], inherit = true): number {
  const withCompose = runCommand("docker", ["compose", ...args], {
    cwd: dir,
    inherit,
  });
  if (withCompose.status === 0 || withCompose.status === null) {
    if (withCompose.status === 0) return 0;
  }
  if (withCompose.stderr?.includes("compose") || withCompose.status !== 0) {
    const legacy = runCommand("docker-compose", args, { cwd: dir, inherit });
    return legacy.status;
  }
  return withCompose.status;
}

export function composePull(dir: string): number {
  return compose(dir, ["pull"]);
}

export function composeUp(dir: string): number {
  return compose(dir, ["up", "-d"]);
}

export function composeDown(dir: string): number {
  return compose(dir, ["down"]);
}

export function composePs(dir: string): { status: number; stdout: string } {
  const r = runCommand("docker", ["compose", "ps"], { cwd: dir });
  if (r.status === 0) return r;
  return runCommand("docker-compose", ["ps"], { cwd: dir });
}

export function composeLogs(dir: string, follow: boolean): number {
  return compose(dir, follow ? ["logs", "-f"] : ["logs", "--tail", "200"]);
}

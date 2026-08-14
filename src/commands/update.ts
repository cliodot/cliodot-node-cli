import * as p from "@clack/prompts";
import { CLI_DEFAULTS, CliodotInstance, instanceIsClientOnly } from "../config.js";
import {
  composeDown,
  composeUp,
  writeDockerCompose,
} from "../runtime/docker/compose.js";
import { dockerLoginGhcr, dockerPull, ensureDockerAvailable } from "../runtime/docker/ghcr.js";
import { installNativeArtifacts } from "../runtime/native/tarball.js";
import { nativeStart, nativeStop } from "../runtime/native/process.js";
import {
  readClientEnv,
  readInstance,
  readServerEnv,
  resolveInstanceDir,
  writeInstance,
} from "../util/fs.js";
import { writeInstanceEnvs } from "../env/write-instance-envs.js";

function normalizeUpdateVersion(value?: string): string {
  const raw = String(value || "latest").trim().replace(/^v/, "");
  return raw || "latest";
}

export async function runUpdate(opts: {
  dir?: string;
  server?: string;
  client?: string;
}): Promise<void> {
  const dir = resolveInstanceDir(opts.dir);
  const instance = readInstance(dir);
  const now = new Date().toISOString();
  const clientOnly = instanceIsClientOnly(instance);
  const serverVersion = clientOnly
    ? instance.serverVersion || "latest"
    : normalizeUpdateVersion(opts.server);
  const clientVersion = normalizeUpdateVersion(opts.client);

  if (instance.runtime === "docker") {
    if (!clientOnly) instance.serverTag = serverVersion;
    instance.clientTag = clientVersion;
  } else {
    if (!clientOnly) instance.serverVersion = serverVersion;
    instance.clientVersion = clientVersion;
  }
  instance.updatedAt = now;
  writeInstance(dir, instance);

  const spinner = p.spinner();
  p.log.info(
    clientOnly
      ? `Updating client=${clientVersion}`
      : `Updating to server=${serverVersion}, client=${clientVersion}`
  );

  if (instance.runtime === "docker") {
    writeInstanceEnvs(dir, instance);
    ensureDockerAvailable();
    try {
      dockerLoginGhcr();
    } catch (err) {
      p.log.warn(err instanceof Error ? err.message : String(err));
    }
    writeDockerCompose(dir, instance);
    spinner.start(clientOnly ? "Pulling client image" : "Pulling updated images");
    if (!clientOnly) {
      dockerPull(
        instance.serverImage || CLI_DEFAULTS.serverImage,
        instance.serverTag || "latest"
      );
    }
    dockerPull(
      instance.clientImage || CLI_DEFAULTS.clientImage,
      instance.clientTag || "latest"
    );
    spinner.stop(clientOnly ? "Client image updated" : "Images updated");
    spinner.start("Recreating stack");
    composeDown(dir);
    const code = composeUp(dir);
    spinner.stop(code === 0 ? "Stack recreated" : "Recreate failed");
    if (code !== 0) process.exitCode = code;
  } else {
    const existingServer = readServerEnv(dir);
    const existingClient = readClientEnv(dir);
    spinner.start(
      clientOnly ? "Launching Delta retrieval" : "Launching dual-front retrieval"
    );
    try {
      nativeStop(dir);
      const installed = await installNativeArtifacts({
        dir,
        serverRepo: CLI_DEFAULTS.serverReleaseRepo,
        clientRepo: CLI_DEFAULTS.clientReleaseRepo,
        serverVersion,
        clientVersion,
        clientOnly,
        onProgress: (message) => spinner.message(message),
      });
      if (!clientOnly) {
        instance.serverVersion = installed.serverVersion;
      }
      instance.clientVersion = installed.clientVersion;
      instance.updatedAt = new Date().toISOString();
      writeInstance(dir, instance);
      writeInstanceEnvs(dir, instance, {
        existingServer,
        existingClient,
      });
      nativeStart(dir, instance);
      spinner.stop(
        clientOnly
          ? `Delta secured · client ${installed.clientVersion}`
          : `Both fronts secured · server ${installed.serverVersion} · client ${installed.clientVersion}`
      );
    } catch (err) {
      spinner.stop("Update failed");
      p.log.error(err instanceof Error ? err.message : String(err));
      writeInstanceEnvs(dir, instance, {
        existingServer,
        existingClient,
      });
      process.exitCode = 1;
    }
  }

  p.outro(
    `Updated ${instance.name} (${instance.runtime}) — .env secrets preserved`
  );
}

export function summarizeVersions(instance: CliodotInstance): string {
  const clientOnly = instanceIsClientOnly(instance);
  if (instance.runtime === "docker") {
    if (clientOnly) {
      return `client ${instance.clientImage}:${instance.clientTag}`;
    }
    return `server ${instance.serverImage}:${instance.serverTag} | client ${instance.clientImage}:${instance.clientTag}`;
  }
  if (clientOnly) {
    return `client ${instance.clientVersion}`;
  }
  return `server ${instance.serverVersion} | client ${instance.clientVersion}`;
}

import * as p from "@clack/prompts";
import {
  CLI_DEFAULTS,
  CliodotInstance,
} from "../config.js";
import { writeInstanceEnvs } from "../env/write-instance-envs.js";
import {
  composePull,
  composeUp,
  writeDockerCompose,
} from "../runtime/docker/compose.js";
import { dockerLoginGhcr, dockerPull, ensureDockerAvailable } from "../runtime/docker/ghcr.js";
import { installNativeArtifacts } from "../runtime/native/tarball.js";
import { nativeStart } from "../runtime/native/process.js";
import { runInitWizard } from "../wizard/prompts.js";
import {
  clientEnvPath,
  getGithubToken,
  resolveInstanceDir,
  serverEnvPath,
  writeInstance,
} from "../util/fs.js";

export async function runInit(opts: {
  dir?: string;
  yes?: boolean;
  serverVersion?: string;
  clientVersion?: string;
  withServer?: boolean;
  clientOnly?: boolean;
}): Promise<void> {
  const answers = await runInitWizard(opts);
  const dir = resolveInstanceDir(opts.dir || answers.dir);
  const now = new Date().toISOString();
  const clientOnly = answers.clientOnly;

  const instance: CliodotInstance = {
    name: answers.name,
    runtime: answers.runtime,
    mode: answers.mode,
    apps: answers.apps,
    ports: answers.ports,
    registry: CLI_DEFAULTS.registry,
    serverImage: answers.serverImage,
    serverTag: answers.serverTag,
    clientImage: answers.clientImage,
    clientTag: answers.clientTag,
    serverVersion: answers.serverVersion,
    clientVersion: answers.clientVersion,
    releaseRepo: answers.releaseRepo,
    clientOnly,
    mongo: answers.mongo,
    redis: answers.redis,
    createdAt: now,
    updatedAt: now,
  };

  const spinner = p.spinner();
  spinner.start("Writing configuration");
  writeInstance(dir, instance);
  spinner.stop("Configuration written");

  if (instance.runtime === "docker") {
    writeInstanceEnvs(dir, instance);
    ensureDockerAvailable();
    spinner.start("Logging into GHCR");
    if (answers.token || getGithubToken()) {
      try {
        dockerLoginGhcr(answers.token);
        spinner.stop("GHCR login ok");
      } catch (err) {
        spinner.stop("GHCR login skipped/failed");
        p.log.warn(err instanceof Error ? err.message : String(err));
      }
    } else {
      spinner.stop("GHCR login skipped (public images / no token)");
    }

    writeDockerCompose(dir, instance);
    spinner.start(clientOnly ? "Pulling client image" : "Pulling images");
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
    composePull(dir);
    spinner.stop(clientOnly ? "Client image pulled" : "Images pulled");

    if (answers.startAfter) {
      spinner.start("Starting compose stack");
      const code = composeUp(dir);
      spinner.stop(code === 0 ? "Stack started" : "Start failed");
      if (code !== 0) process.exitCode = code;
    }
  } else {
    spinner.start(
      clientOnly ? "Launching Delta retrieval" : "Launching dual-front retrieval"
    );
    try {
      const installed = await installNativeArtifacts({
        dir,
        serverRepo: CLI_DEFAULTS.serverReleaseRepo,
        clientRepo: CLI_DEFAULTS.clientReleaseRepo,
        serverVersion: instance.serverVersion || "latest",
        clientVersion: instance.clientVersion || "latest",
        clientOnly,
        onProgress: (message) => spinner.message(message),
      });
      instance.serverVersion = installed.serverVersion;
      instance.clientVersion = installed.clientVersion;
      writeInstance(dir, instance);
      spinner.stop(
        clientOnly
          ? `Delta secured · client ${installed.clientVersion}`
          : `Both fronts secured · server ${installed.serverVersion} · client ${installed.clientVersion}`
      );
    } catch (err) {
      spinner.stop("Artifact download failed");
      p.log.error(err instanceof Error ? err.message : String(err));
      writeInstanceEnvs(dir, instance);
      process.exitCode = 1;
      p.outro(`Init incomplete in ${dir}`);
      return;
    }

    writeInstanceEnvs(dir, instance);

    if (answers.startAfter) {
      spinner.start("Starting native processes");
      try {
        const pids = nativeStart(dir, instance);
        spinner.stop(
          pids.api != null
            ? `API pid ${pids.api}, client pid ${pids.client}`
            : `client pid ${pids.client}`
        );
      } catch (err) {
        spinner.stop("Native start failed");
        p.log.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    }
  }

  p.note(
    [
      `dir: ${dir}`,
      `runtime: ${instance.runtime}`,
      ...(clientOnly ? [] : [`mode: ${instance.mode}`]),
      ...(clientOnly ? [] : [`api: http://localhost:${instance.ports.api}`]),
      `client: http://localhost:${instance.ports.client}`,
      ...(clientOnly ? [] : [`server env: ${serverEnvPath(dir)}`]),
      `client env: ${clientEnvPath(dir)}`,
      "",
      "Next:",
      ...(clientOnly
        ? []
        : [`  cliodot license --activate "YOUR-KEY" --dir ${dir}`]),
      `  cliodot status --dir ${dir}`,
    ].join("\n"),
    "Instance ready"
  );
  p.outro("Done");
}

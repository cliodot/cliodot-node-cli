import * as p from "@clack/prompts";
import { instanceIsClientOnly } from "../config.js";
import { composePs } from "../runtime/docker/compose.js";
import { ensureDockerAvailable } from "../runtime/docker/ghcr.js";
import { nativeStatus } from "../runtime/native/process.js";
import { readInstance, resolveInstanceDir } from "../util/fs.js";
import { summarizeVersions } from "./update.js";

export async function runStatus(opts: { dir?: string }): Promise<void> {
  const dir = resolveInstanceDir(opts.dir);
  const instance = readInstance(dir);
  const clientOnly = instanceIsClientOnly(instance);

  const lines = [
    `name: ${instance.name}`,
    `runtime: ${instance.runtime}`,
    ...(clientOnly
      ? []
      : [
          `mode: ${instance.mode}`,
          `apps: ${instance.apps.join(", ") || "(none)"}`,
          `ports: api=${instance.ports.api} client=${instance.ports.client}`,
        ]),
    ...(clientOnly ? [`port: client=${instance.ports.client}`] : []),
    `versions: ${summarizeVersions(instance)}`,
  ];

  if (instance.runtime === "docker") {
    ensureDockerAvailable();
    const ps = composePs(dir);
    lines.push("", "compose:", ps.stdout.trim() || `(exit ${ps.status})`);
  } else {
    const st = nativeStatus(dir);
    lines.push(
      "",
      ...(clientOnly
        ? []
        : [`api: ${st.api.running ? `running pid=${st.api.pid}` : "stopped"}`]),
      `client: ${st.client.running ? `running pid=${st.client.pid}` : "stopped"}`
    );
  }

  p.note(lines.join("\n"), "Status");
}

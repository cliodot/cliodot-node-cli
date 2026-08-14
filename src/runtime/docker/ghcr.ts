import { CLI_DEFAULTS } from "../../config.js";
import { getGithubToken, runCommand } from "../../util/fs.js";

export function dockerLoginGhcr(token?: string): number {
  const t = token || getGithubToken();
  if (!t) {
    return 0;
  }
  const login = runCommand(
    "bash",
    [
      "-lc",
      `printf '%s' "$TOKEN" | docker login ${CLI_DEFAULTS.registry} -u USERNAME --password-stdin`,
    ],
    {
      env: { ...process.env, TOKEN: t },
      inherit: true,
    }
  );
  return login.status;
}

export function dockerPull(image: string, tag: string): number {
  return runCommand("docker", ["pull", `${image}:${tag}`], { inherit: true }).status;
}

export function ensureDockerAvailable(): void {
  const r = runCommand("docker", ["version"], { inherit: false });
  if (r.status !== 0) {
    throw new Error("Docker is not available. Install Docker or choose the native runtime.");
  }
}

import * as p from "@clack/prompts";
import { activateLicense, fetchLicenseStatus } from "../license/activate.js";
import { readInstance, readServerEnv, resolveInstanceDir } from "../util/fs.js";

function apiBase(dir: string): string {
  const instance = readInstance(dir);
  const env = readServerEnv(dir);
  return (
    env.SERVER_URL ||
    env.API_BASE_URL ||
    env.APP_URL ||
    `http://localhost:${instance.ports.api}`
  );
}

export async function runLicense(opts: {
  dir?: string;
  activate?: string;
  status?: boolean;
  token?: string;
}): Promise<void> {
  const dir = resolveInstanceDir(opts.dir);
  const base = apiBase(dir);

  if (opts.activate) {
    const spinner = p.spinner();
    spinner.start(`Activating against ${base}`);
    const result = await activateLicense({
      apiBaseUrl: base,
      key: opts.activate,
    });
    spinner.stop(result.ok ? "Activated" : "Failed");
    if (!result.ok) {
      p.log.error(result.message);
      process.exitCode = 1;
      return;
    }
    p.log.success(result.message);
    if (result.data) {
      p.note(JSON.stringify(result.data, null, 2), "License");
    }
    return;
  }

  if (opts.status) {
    const result = await fetchLicenseStatus({
      apiBaseUrl: base,
      token: opts.token || process.env.CLIODOT_ADMIN_TOKEN,
    });
    if (!result.ok) {
      p.log.error(result.message);
      process.exitCode = 1;
      return;
    }
    p.note(JSON.stringify(result.data, null, 2), "License status");
    return;
  }

  p.log.warn("Pass --activate <KEY> or --status");
  process.exitCode = 1;
}

import fs from "fs";
import path from "path";
import * as p from "@clack/prompts";
import { activateLicense, fetchLicenseStatus } from "../license/activate.js";
import {
  readInstance,
  readServerEnv,
  resolveInstanceDir,
  runCommand,
  serverDir,
} from "../util/fs.js";

const SUPPORT_EMAIL = "cliodot@cliodot.com";

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

function resolveLicenseRequestScript(dir: string): {
  cwd: string;
  script: string;
} {
  const nested = serverDir(dir);
  const candidates = [
    {
      cwd: nested,
      script: path.join(nested, "build", "scripts", "license-request.js"),
    },
    {
      cwd: dir,
      script: path.join(dir, "build", "scripts", "license-request.js"),
    },
  ];
  for (const c of candidates) {
    if (fs.existsSync(c.script)) return c;
  }
  throw new Error(
    `license-request script not found under ${nested} or ${dir}. ` +
      `Update the server package, or contact ${SUPPORT_EMAIL}.`
  );
}

export async function runLicense(opts: {
  dir?: string;
  activate?: string;
  status?: boolean;
  request?: boolean;
  type?: string;
  token?: string;
}): Promise<void> {
  const dir = resolveInstanceDir(opts.dir);
  const base = apiBase(dir);

  if (opts.request) {
    const { cwd, script } = resolveLicenseRequestScript(dir);
    const rel = path.relative(cwd, script);
    const extra: string[] = [];
    if (opts.type) {
      extra.push("--type", String(opts.type));
    }
    p.log.info(
      `Requesting license via ${rel} (developer/trial auto-issue when approved).`
    );
    p.log.info(
      `If this fails or stays pending, contact Cliodot support: ${SUPPORT_EMAIL}`
    );
    const result = runCommand(
      "node",
      ["-r", "dotenv/config", rel, ...extra],
      { cwd, inherit: true }
    );
    if (result.status !== 0) {
      p.log.error(
        `License request failed. Contact ${SUPPORT_EMAIL} if you need help.`
      );
      process.exitCode = result.status || 1;
    }
    return;
  }

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
      p.log.info(`Need help? Contact ${SUPPORT_EMAIL}`);
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

  p.log.warn("Pass --request, --activate <KEY>, or --status");
  process.exitCode = 1;
}

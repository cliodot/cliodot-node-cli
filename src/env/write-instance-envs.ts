import { CLI_DEFAULTS, instanceIsClientOnly } from "../config.js";
import {
  buildEnvValues,
  envComments,
  INSTALL_ENV_KEY_COMMENTS,
  writeClientEnvFile,
} from "./generate.js";
import {
  LICENSE_ENCRYPTION_KEY_DEFAULT,
  LICENSE_PUBLIC_KEY_DEFAULT,
} from "./license-defaults.js";
import { generateSecrets, PRESERVE_ENV_KEYS } from "./secrets.js";
import {
  clientEnvPath,
  mergeEnvPreserveSecrets,
  readClientEnv,
  readServerEnv,
  serverEnvPath,
  writeEnvFile,
} from "../util/fs.js";
import { CliodotInstance } from "../config.js";

export function writeInstanceEnvs(
  dir: string,
  instance: CliodotInstance,
  opts?: {
    existingServer?: Record<string, string>;
    existingClient?: Record<string, string>;
  }
): void {
  const existingClient = opts?.existingClient ?? readClientEnv(dir);
  writeClientEnvFile(clientEnvPath(dir), instance, existingClient);

  if (instanceIsClientOnly(instance)) return;

  const existingServer = opts?.existingServer ?? readServerEnv(dir);
  const secrets = existingServer.JWT_SECRET
    ? {
        JWT_SECRET: existingServer.JWT_SECRET,
        ENCRYPTION_KEY:
          existingServer.ENCRYPTION_KEY || generateSecrets().ENCRYPTION_KEY,
        TOKENIZER_SECRET_KEY:
          existingServer.TOKENIZER_SECRET_KEY ||
          generateSecrets().TOKENIZER_SECRET_KEY,
        DEVICE_TOKEN_SECRET:
          existingServer.DEVICE_TOKEN_SECRET ||
          generateSecrets().DEVICE_TOKEN_SECRET,
        SALT_ROUNDS: existingServer.SALT_ROUNDS || "10",
      }
    : generateSecrets();

  let envValues = buildEnvValues(instance, {
    secrets,
    existing: existingServer,
  });
  envValues = mergeEnvPreserveSecrets(existingServer, envValues, [
    ...PRESERVE_ENV_KEYS,
  ]);
  envValues.LICENSE_PUBLIC_KEY = LICENSE_PUBLIC_KEY_DEFAULT;
  envValues.LICENSE_ENCRYPTION_KEY = LICENSE_ENCRYPTION_KEY_DEFAULT;
  writeEnvFile(
    serverEnvPath(dir),
    envValues,
    envComments(instance),
    INSTALL_ENV_KEY_COMMENTS
  );
}

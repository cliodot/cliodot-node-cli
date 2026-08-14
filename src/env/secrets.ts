import crypto from "crypto";

export function randomSecret(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("hex");
}

export function generateSecrets(): {
  JWT_SECRET: string;
  ENCRYPTION_KEY: string;
  TOKENIZER_SECRET_KEY: string;
  DEVICE_TOKEN_SECRET: string;
  SALT_ROUNDS: string;
} {
  return {
    JWT_SECRET: randomSecret(48),
    ENCRYPTION_KEY: randomSecret(32),
    TOKENIZER_SECRET_KEY: randomSecret(32),
    DEVICE_TOKEN_SECRET: randomSecret(32),
    SALT_ROUNDS: "10",
  };
}

export const PRESERVE_ENV_KEYS = [
  "JWT_SECRET",
  "ENCRYPTION_KEY",
  "TOKENIZER_SECRET_KEY",
  "DEVICE_TOKEN_SECRET",
  "SALT_ROUNDS",
  "LICENSE_PUBLIC_KEY",
  "LICENSE_ENCRYPTION_KEY",
  "MONGODB_URI",
  "MONGODB_NAME",
  "REDIS_URL",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "FROM_EMAIL_ADDRESS",
  "FROM_USER_NAME",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_S3_BUCKET",
  "AWS_REGION",
] as const;

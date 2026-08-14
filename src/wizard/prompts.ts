import * as p from "@clack/prompts";
import {
  CLI_DEFAULTS,
  CliodotInstance,
  DeploymentMode,
  RuntimeKind,
  SELECTABLE_APPS,
  SelectableAppId,
} from "../config.js";
import { commandExists, getGithubToken, slugify } from "../util/fs.js";

export type InitAnswers = {
  name: string;
  dir: string;
  runtime: RuntimeKind;
  mode: DeploymentMode;
  apps: SelectableAppId[];
  serverTag: string;
  clientTag: string;
  serverVersion: string;
  clientVersion: string;
  releaseRepo: string;
  serverImage: string;
  clientImage: string;
  clientOnly: boolean;
  mongo: CliodotInstance["mongo"];
  redis: CliodotInstance["redis"];
  ports: { api: number; client: number };
  token?: string;
  startAfter: boolean;
};

function cancelIf(value: unknown): asserts value is Exclude<typeof value, symbol> {
  if (p.isCancel(value)) {
    p.cancel("Init cancelled.");
    process.exit(1);
  }
}

export async function runInitWizard(opts: {
  dir?: string;
  yes?: boolean;
  serverVersion?: string;
  clientVersion?: string;
  withServer?: boolean;
  clientOnly?: boolean;
}): Promise<InitAnswers> {
  const clientOnly =
    opts.clientOnly === true
      ? true
      : opts.withServer === true
        ? false
        : CLI_DEFAULTS.clientOnly;
  p.intro(clientOnly ? "Cliodot init (client only)" : "Cliodot init");

  const nameRaw = await p.text({
    message: "Project name",
    placeholder: "acme",
    validate: (v) => (!v?.trim() ? "Required" : undefined),
  });
  cancelIf(nameRaw);
  const name = slugify(String(nameRaw));

  const dockerOk = commandExists("docker");
  const runtimeRaw = await p.select({
    message: "Runtime",
    options: [
      {
        value: "docker",
        label: "Docker",
        hint: dockerOk
          ? clientOnly
            ? "Client image + compose"
            : "GHCR images + compose"
          : "Docker not detected",
      },
      {
        value: "native",
        label: "Native",
        hint: clientOnly
          ? "GitHub Releases artifact + Node.js"
          : "GitHub Releases artifacts (server + client) + Node.js",
      },
    ],
    initialValue: dockerOk ? "docker" : "native",
  });
  cancelIf(runtimeRaw);
  const runtime = runtimeRaw as RuntimeKind;

  if (runtime === "docker" && !dockerOk) {
    p.log.warn("Docker was not found on PATH. Install Docker or re-run and choose Native.");
  }

  let mode: DeploymentMode = "local";
  let apps: SelectableAppId[] = [];

  if (!clientOnly) {
    const modeRaw = await p.select({
      message: "Deployment mode",
      options: [
        {
          value: "local",
          label: "Local (developer)",
          hint: "Hub browse + mirror; publish denied",
        },
        {
          value: "production",
          label: "Production",
          hint: "Full hub when licensed / enabled",
        },
        {
          value: "enterprise",
          label: "Enterprise",
          hint: "Licensed hub/remote/exchange may enable",
        },
      ],
      initialValue: "local",
    });
    cancelIf(modeRaw);
    mode = modeRaw as DeploymentMode;
    apps = SELECTABLE_APPS.map((a) => a.id) as SelectableAppId[];
    p.log.info(`Enabling all apps: ${apps.join(", ")}`);
  }

  let serverTag: string = CLI_DEFAULTS.defaultTag;
  let clientTag: string = CLI_DEFAULTS.defaultTag;
  let serverVersion =
    opts.serverVersion?.trim().replace(/^v/, "") || "latest";
  let clientVersion =
    opts.clientVersion?.trim().replace(/^v/, "") ||
    (clientOnly ? "latest" : serverVersion);
  let releaseRepo: string = CLI_DEFAULTS.clientReleaseRepo;
  let serverImage: string = CLI_DEFAULTS.serverImage;
  let clientImage: string = CLI_DEFAULTS.clientImage;

  if (runtime === "docker") {
    serverTag = serverVersion === "latest" ? "latest" : serverVersion;
    clientTag = clientVersion === "latest" ? "latest" : clientVersion;
    p.log.info(
      clientOnly
        ? "Preparing Delta image pull"
        : "Preparing dual-front image pull"
    );
  } else {
    p.log.info(
      clientOnly
        ? "Preparing Delta retrieval"
        : "Preparing dual-front retrieval"
    );
  }

  let token = getGithubToken();
  if (!token && (!clientOnly || runtime === "docker")) {
    const tokenIn = await p.password({
      message:
        runtime === "docker"
          ? "GitHub PAT for private GHCR (optional if images are public) — leave blank to skip"
          : "GitHub PAT (optional for public Releases) — leave blank to skip",
    });
    cancelIf(tokenIn);
    token = String(tokenIn || "").trim() || undefined;
    if (token) {
      process.env.GHCR_TOKEN = token;
      process.env.GITHUB_TOKEN = token;
    }
  }

  let mongo: CliodotInstance["mongo"] = {
    kind: "existing",
    uri: "mongodb://127.0.0.1:27017",
    name,
  };
  let redis: CliodotInstance["redis"] = {
    kind: "existing",
    url: "redis://127.0.0.1:6379",
  };

  if (!clientOnly) {
    if (runtime === "docker") {
      const mongoKind = await p.select({
        message: "MongoDB",
        options: [
          { value: "compose", label: "Install locally (Docker Compose)" },
          { value: "existing", label: "Existing MongoDB URI" },
          { value: "atlas", label: "MongoDB Atlas URI" },
        ],
        initialValue: "compose",
      });
      cancelIf(mongoKind);
      if (mongoKind === "compose") {
        mongo = {
          kind: "compose",
          uri: "mongodb://mongo:27017",
          name,
        };
      } else {
        const uri = await p.text({
          message: "MongoDB URI",
          placeholder: "mongodb+srv://...",
          validate: (v) => (!v?.trim() ? "Required" : undefined),
        });
        cancelIf(uri);
        const dbName = await p.text({
          message: "MongoDB database name",
          initialValue: name,
        });
        cancelIf(dbName);
        mongo = {
          kind: mongoKind as "existing" | "atlas",
          uri: String(uri).trim(),
          name: String(dbName).trim() || name,
        };
      }
    } else {
      p.log.info(
        "Native runtime does not install MongoDB. Use an existing instance or Atlas."
      );
      const mongoKind = await p.select({
        message: "MongoDB",
        options: [
          { value: "existing", label: "Existing MongoDB URI" },
          { value: "atlas", label: "MongoDB Atlas URI" },
        ],
        initialValue: "existing",
      });
      cancelIf(mongoKind);
      const uri = await p.text({
        message: "MongoDB URI",
        placeholder: "mongodb://127.0.0.1:27017",
        validate: (v) => (!v?.trim() ? "Required" : undefined),
      });
      cancelIf(uri);
      const dbName = await p.text({
        message: "MongoDB database name",
        initialValue: name,
      });
      cancelIf(dbName);
      mongo = {
        kind: mongoKind as "existing" | "atlas",
        uri: String(uri).trim(),
        name: String(dbName).trim() || name,
      };
    }

    if (runtime === "docker") {
      const redisKind = await p.select({
        message: "Redis",
        options: [
          { value: "compose", label: "Install locally (Docker Compose)" },
          { value: "existing", label: "Existing Redis URL" },
        ],
        initialValue: "compose",
      });
      cancelIf(redisKind);
      if (redisKind === "compose") {
        redis = { kind: "compose", url: "redis://redis:6379" };
      } else {
        const url = await p.text({
          message: "Redis URL",
          initialValue: "redis://127.0.0.1:6379",
          validate: (v) => (!v?.trim() ? "Required" : undefined),
        });
        cancelIf(url);
        redis = { kind: "existing", url: String(url).trim() };
      }
    } else {
      p.log.info(
        "Native runtime does not install Redis. Point at an existing Redis (or install via your OS package manager)."
      );
      const url = await p.text({
        message: "Redis URL",
        initialValue: "redis://127.0.0.1:6379",
        validate: (v) => (!v?.trim() ? "Required" : undefined),
      });
      cancelIf(url);
      redis = { kind: "existing", url: String(url).trim() };
    }
  }

  let apiPort: number = CLI_DEFAULTS.defaultApiPort;
  if (!clientOnly) {
    const apiPortRaw = await p.text({
      message: "API port",
      initialValue: String(CLI_DEFAULTS.defaultApiPort),
    });
    cancelIf(apiPortRaw);
    apiPort = Number(apiPortRaw) || CLI_DEFAULTS.defaultApiPort;
  }

  const clientPortRaw = await p.text({
    message: "Client port",
    initialValue: String(CLI_DEFAULTS.defaultClientPort),
  });
  cancelIf(clientPortRaw);

  const startAfter =
    opts.yes ||
    (await (async () => {
      const s = await p.confirm({
        message: clientOnly
          ? "Start client after init?"
          : "Start services after init?",
        initialValue: true,
      });
      cancelIf(s);
      return Boolean(s);
    })());

  const dir = opts.dir || process.cwd();

  return {
    name,
    dir,
    runtime,
    mode,
    apps,
    serverTag,
    clientTag,
    serverVersion,
    clientVersion,
    releaseRepo,
    serverImage,
    clientImage,
    clientOnly,
    mongo,
    redis,
    ports: {
      api: apiPort,
      client: Number(clientPortRaw) || CLI_DEFAULTS.defaultClientPort,
    },
    token,
    startAfter,
  };
}

export type ReleaseStage = "docker" | "npm" | "tarball";

const STAGE_ALIASES: Record<string, ReleaseStage> = {
  docker: "docker",
  image: "docker",
  ghcr: "docker",
  npm: "npm",
  tarball: "tarball",
  tar: "tarball",
  native: "tarball",
  upload: "tarball",
  github: "tarball",
};

export function parseReleaseStages(raw?: string | string[]): Set<ReleaseStage> | null {
  if (raw == null) return null;
  const parts = (Array.isArray(raw) ? raw : [raw])
    .flatMap((s) => String(s).split(/[,\s]+/))
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!parts.length) return null;

  const stages = new Set<ReleaseStage>();
  for (const part of parts) {
    const mapped = STAGE_ALIASES[part];
    if (!mapped) {
      throw new Error(
        `Unknown release stage "${part}". Use: docker, npm, tarball`
      );
    }
    stages.add(mapped);
  }
  return stages;
}

export function resolveReleaseStageFlags(opts: {
  only?: string | string[];
  docker?: boolean;
  native?: boolean;
  npmPublish?: boolean;
  upload?: boolean;
  push?: boolean;
}): {
  doDocker: boolean;
  doNative: boolean;
  npmPublish: boolean;
  upload: boolean;
  push: boolean;
  only: Set<ReleaseStage> | null;
} {
  const only = parseReleaseStages(opts.only);
  if (!only) {
    return {
      doDocker: opts.docker !== false,
      doNative: opts.native !== false,
      npmPublish: opts.npmPublish !== false,
      upload: Boolean(opts.upload),
      push: Boolean(opts.push),
      only: null,
    };
  }

  const doDocker = only.has("docker");
  const doNative = only.has("tarball");
  const npmPublish = only.has("npm");
  return {
    doDocker,
    doNative,
    npmPublish,
    upload: doNative,
    push: doDocker && Boolean(opts.push),
    only,
  };
}

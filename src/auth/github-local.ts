import { spawnSync } from "child_process";
import { commandExists, runCommand } from "../util/fs.js";

export type GithubTokenSource = "flag" | "stored" | "env" | "gh" | "git";

export type LocalGithubSession = {
  token: string;
  source: GithubTokenSource;
  login?: string;
};

export function describeGithubSource(source: GithubTokenSource): string {
  switch (source) {
    case "flag":
      return "command flag";
    case "stored":
      return "saved Cliodot credentials";
    case "env":
      return "environment";
    case "gh":
      return "GitHub CLI (gh)";
    case "git":
      return "git credentials";
  }
}

function envGithubToken(): string | undefined {
  const token = (
    process.env.GITHUB_TOKEN ||
    process.env.GH_TOKEN ||
    process.env.GHCR_TOKEN ||
    ""
  ).trim();
  return token || undefined;
}

function tokenFromGh(): string | undefined {
  if (!commandExists("gh")) return undefined;
  const result = runCommand("gh", ["auth", "token"]);
  if (result.status !== 0) return undefined;
  const token = result.stdout.trim();
  return token || undefined;
}

function loginFromGh(): string | undefined {
  if (!commandExists("gh")) return undefined;
  const result = runCommand("gh", ["api", "user", "-q", ".login"]);
  if (result.status !== 0) return undefined;
  const login = result.stdout.trim();
  return login || undefined;
}

export function parseGitCredentialOutput(output: string): string | undefined {
  for (const line of output.split(/\r?\n/)) {
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim().toLowerCase();
    const value = line.slice(eq + 1).trim();
    if ((key === "password" || key === "token") && value) return value;
  }
  return undefined;
}

function tokenFromGitCredential(): string | undefined {
  if (!commandExists("git")) return undefined;
  const result = spawnSync("git", ["credential", "fill"], {
    encoding: "utf8",
    input: "protocol=https\nhost=github.com\n\n",
    timeout: 4000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  if ((result.status ?? 1) !== 0) return undefined;
  return parseGitCredentialOutput(result.stdout?.toString() || "");
}

async function loginFromToken(token: string): Promise<string | undefined> {
  try {
    const res = await fetch("https://api.github.com/user", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "cliodot-cli",
      },
    });
    if (!res.ok) return undefined;
    const json = (await res.json()) as { login?: string };
    return json.login || undefined;
  } catch {
    return undefined;
  }
}

export async function resolveGithubSession(opts?: {
  explicit?: string;
  stored?: string;
}): Promise<LocalGithubSession | undefined> {
  const explicit = opts?.explicit?.trim();
  if (explicit) {
    return { token: explicit, source: "flag", login: await loginFromToken(explicit) };
  }
  const stored = opts?.stored?.trim();
  if (stored) {
    return { token: stored, source: "stored", login: await loginFromToken(stored) };
  }
  const env = envGithubToken();
  if (env) {
    return { token: env, source: "env", login: await loginFromToken(env) };
  }
  const gh = tokenFromGh();
  if (gh) {
    return { token: gh, source: "gh", login: loginFromGh() || (await loginFromToken(gh)) };
  }
  const git = tokenFromGitCredential();
  if (git) {
    return { token: git, source: "git", login: await loginFromToken(git) };
  }
  return undefined;
}

export function localGithubHint(): string {
  if (commandExists("gh")) {
    return "Run `gh auth login`, or pass --token.";
  }
  return "Install GitHub CLI and run `gh auth login`, or pass --token. SSH remotes cannot be used for the GitHub API.";
}

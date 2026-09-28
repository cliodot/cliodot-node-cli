import * as p from "@clack/prompts";
import {
  loginWithApiKey,
  pollCliLogin,
  startCliLogin,
} from "../auth/client.js";
import {
  describeGithubSource,
  localGithubHint,
  resolveGithubSession,
} from "../auth/github-local.js";
import { resolveLoginUrls } from "../auth/login-urls.js";
import {
  clearAuth,
  readAuth,
  writeAuth,
} from "../auth/store.js";
import { openBrowser } from "../util/fs.js";

function cancelIf(value: unknown): asserts value is Exclude<typeof value, symbol> {
  if (p.isCancel(value)) {
    p.cancel("Cancelled.");
    process.exit(1);
  }
}

export async function runAuthLogin(opts: {
  dir?: string;
  apiUrl?: string;
  appUrl?: string;
  apiKey?: string;
  apiSecret?: string;
  githubToken?: string;
}): Promise<void> {
  p.intro("Cliodot login");
  const existing = readAuth();
  const { apiUrl, appUrl } = resolveLoginUrls({
    apiUrl: opts.apiUrl,
    appUrl: opts.appUrl,
    dir: opts.dir,
    storedApiUrl: existing?.apiUrl,
    storedAppUrl: existing?.appUrl,
  });

  let result: {
    accessToken: string;
    tokenExpiresAt?: string;
    user?: { _id?: string; email?: string; tenant_id?: string };
  };
  if (opts.apiKey || opts.apiSecret) {
    const apiKey = opts.apiKey || (await promptText("API key"));
    const apiSecret = opts.apiSecret || (await promptPassword("API secret"));
    result = await loginWithApiKey({ apiUrl, apiKey, apiSecret });
  } else {
    result = await loginWithBrowser({ apiUrl, appUrl });
  }

  if (!result?.accessToken) {
    throw new Error("Login succeeded but no access token was returned.");
  }

  const github = await resolveGithubSession({
    explicit: opts.githubToken,
    stored: existing?.githubToken,
  });

  const file = writeAuth({
    version: 1,
    apiUrl,
    appUrl,
    accessToken: result.accessToken,
    tokenExpiresAt: result.tokenExpiresAt,
    email: result.user?.email,
    userId: result.user?._id,
    tenantId: result.user?.tenant_id,
    githubToken: github?.source === "flag" || github?.source === "stored" ? github.token : undefined,
    githubFrom: github ? (github.source === "flag" || github.source === "stored" ? "stored" : "local") : existing?.githubFrom,
    loggedInAt: new Date().toISOString(),
  });

  p.log.success(`Logged in as ${result.user?.email || result.user?._id || "user"}`);
  p.log.info(`API ${apiUrl}`);
  if (appUrl) p.log.info(`App ${appUrl}`);
  if (github) {
    p.log.info(
      `GitHub ${github.login ? `@${github.login}` : "connected"} via ${describeGithubSource(github.source)}`
    );
  } else {
    p.log.info(`GitHub will use this machine's gh/git session when you push. ${localGithubHint()}`);
  }
  p.log.info(`Credentials stored at ${file}`);
  p.outro("You can now run `cliodot workspace push` / `cliodot workspace pull`.");
}

export async function runAuthLogout(): Promise<void> {
  if (clearAuth()) p.log.success("Logged out.");
  else p.log.info("Already logged out.");
}

export async function runAuthStatus(): Promise<void> {
  const auth = readAuth();
  if (!auth) {
    p.log.warn("Not logged in. Run `cliodot auth login`.");
    process.exitCode = 1;
    return;
  }
  const expired =
    auth.tokenExpiresAt &&
    !Number.isNaN(Date.parse(auth.tokenExpiresAt)) &&
    Date.parse(auth.tokenExpiresAt) <= Date.now();
  p.log.info(`API     ${auth.apiUrl}`);
  p.log.info(`User    ${auth.email || auth.userId || "unknown"}`);
  if (auth.tenantId) p.log.info(`Tenant  ${auth.tenantId}`);
  if (auth.tokenExpiresAt) p.log.info(`Expires ${auth.tokenExpiresAt}`);
  const github = await resolveGithubSession({ stored: auth.githubToken });
  if (github) {
    p.log.info(
      `GitHub  ${github.login ? `@${github.login}` : "connected"} via ${describeGithubSource(github.source)}`
    );
  } else {
    p.log.info(`GitHub  not connected. ${localGithubHint()}`);
  }
  if (expired) {
    p.log.warn("Session expired. Run `cliodot auth login` again.");
    process.exitCode = 1;
  } else {
    p.log.success("Logged in.");
  }
}

export async function runAuthGithub(opts: { token?: string; clear?: boolean }): Promise<void> {
  const auth = readAuth();
  if (!auth) {
    throw new Error("Not logged in. Run `cliodot auth login` first.");
  }
  if (opts.clear) {
    writeAuth({ ...auth, githubToken: undefined, githubFrom: undefined });
    p.log.success("Stopped using a stored GitHub token. Push/pull will still use gh/git on this machine.");
    return;
  }
  if (opts.token) {
    const github = await resolveGithubSession({ explicit: opts.token });
    writeAuth({ ...auth, githubToken: opts.token, githubFrom: "stored" });
    p.log.success(
      `Saved GitHub token${github?.login ? ` for @${github.login}` : ""}.`
    );
    return;
  }
  const github = await resolveGithubSession();
  if (!github) {
    throw new Error(`No GitHub session on this machine. ${localGithubHint()}`);
  }
  writeAuth({
    ...auth,
    githubToken: undefined,
    githubFrom: "local",
  });
  p.log.success(
    `Using ${github.login ? `@${github.login}` : "this machine"} via ${describeGithubSource(github.source)}. No token stored.`
  );
}

async function loginWithBrowser(opts: {
  apiUrl: string;
  appUrl?: string;
}): Promise<{
  accessToken: string;
  tokenExpiresAt?: string;
  user?: { _id?: string; email?: string; tenant_id?: string };
}> {
  const started = await startCliLogin({ apiUrl: opts.apiUrl, appUrl: opts.appUrl });
  p.log.info("Complete sign-in in the app. The CLI will pick up the session.");
  p.log.info(started.verify_url);
  if (!openBrowser(started.verify_url)) {
    p.log.warn("Could not open a browser. Open the URL above.");
  }

  const spinner = p.spinner();
  spinner.start("Waiting for browser login");
  const deadline = Date.parse(started.expires_at) || Date.now() + 10 * 60 * 1000;
  const interval = started.poll_interval_ms || 2000;

  try {
    while (Date.now() < deadline) {
      await sleep(interval);
      const poll = await pollCliLogin({ apiUrl: opts.apiUrl, sessionId: started.session_id });
      if (poll.status === "approved" && poll.accessToken) {
        spinner.stop("Browser login completed");
        return {
          accessToken: poll.accessToken,
          tokenExpiresAt: poll.tokenExpiresAt,
          user: poll.user,
        };
      }
      if (poll.status === "denied") {
        throw new Error("Browser login was denied.");
      }
      if (poll.status === "expired") {
        throw new Error("Browser login expired. Run cliodot auth login again.");
      }
    }
    throw new Error("Timed out waiting for browser login.");
  } catch (error) {
    spinner.stop("Browser login did not finish");
    throw error;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function promptText(message: string, initial?: string): Promise<string> {
  const value = await p.text({
    message,
    initialValue: initial,
    validate: (v) => (v?.trim() ? undefined : "Required"),
  });
  cancelIf(value);
  return String(value).trim();
}

async function promptPassword(message: string): Promise<string> {
  const value = await p.password({
    message,
    validate: (v) => (v?.trim() ? undefined : "Required"),
  });
  cancelIf(value);
  return String(value);
}


import fs from "fs";
import path from "path";
import * as p from "@clack/prompts";
import { authRequest } from "../auth/client.js";
import {
  describeGithubSource,
  localGithubHint,
  resolveGithubSession,
} from "../auth/github-local.js";
import { requireAuth } from "../auth/store.js";

function cancelIf(value: unknown): asserts value is Exclude<typeof value, symbol> {
  if (p.isCancel(value)) {
    p.cancel("Cancelled.");
    process.exit(1);
  }
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

async function ensureGithubToken(explicit?: string): Promise<string> {
  const auth = requireAuth();
  const github = await resolveGithubSession({
    explicit,
    stored: auth.githubToken,
  });
  if (github) {
    if (github.login) {
      p.log.info(`GitHub @${github.login} via ${describeGithubSource(github.source)}`);
    }
    return github.token;
  }
  throw new Error(`No GitHub session on this machine. ${localGithubHint()}`);
}

function unwrapPayload(payload: any): any {
  if (payload?.data && typeof payload.data === "object") {
    if (payload.data.project || payload.data.source || payload.data.ok || payload.data.project_id) {
      return payload.data;
    }
  }
  return payload;
}

async function resolveProjectId(explicit?: string): Promise<string> {
  if (explicit?.trim()) return explicit.trim();
  const auth = requireAuth();
  const listed = await authRequest<{
    projects?: Array<{ _id?: string; id?: string; name?: string }>;
  }>(auth, { path: "/projects?limit=100" });
  const projects = listed.projects || [];
  if (!projects.length) {
    throw new Error("No projects found. Pass --project <id>.");
  }
  const picked = await p.select({
    message: "Project to export",
    options: projects.map((project) => ({
      value: String(project._id || project.id),
      label: project.name || String(project._id || project.id),
    })),
  });
  cancelIf(picked);
  return String(picked);
}

export async function runWorkspacePush(opts: {
  project?: string;
  repo?: string;
  path?: string;
  branch?: string;
  message?: string;
  githubToken?: string;
}): Promise<void> {
  const auth = requireAuth();
  const projectId = await resolveProjectId(opts.project);
  const repo = opts.repo || (await promptText("GitHub repo (owner/name)"));
  const githubToken = await ensureGithubToken(opts.githubToken);

  const result = await authRequest<{
    repo: string;
    path: string;
    branch: string;
    sha: string;
    html_url?: string;
    commit_url?: string;
  }>(auth, {
    path: `/projects/${encodeURIComponent(projectId)}/export/github`,
    method: "POST",
    githubToken,
    body: {
      repo,
      path: opts.path,
      branch: opts.branch,
      message: opts.message,
    },
  });

  p.log.success(`Pushed ${result.repo}:${result.path} (${result.branch})`);
  if (result.html_url) p.log.info(result.html_url);
  if (result.commit_url) p.log.info(result.commit_url);
}

export async function runWorkspacePull(opts: {
  repo?: string;
  path?: string;
  branch?: string;
  name?: string;
  githubToken?: string;
}): Promise<void> {
  const repo = opts.repo || (await promptText("GitHub repo (owner/name)"));
  const filePath =
    opts.path ||
    (await promptText("Path in repo", "cliodot/workspaces/workspace.workspace.json"));
  const githubToken = await ensureGithubToken(opts.githubToken);

  const auth = requireAuth();
  const result = unwrapPayload(
    await authRequest(auth, {
      path: "/workspace/import/github",
      method: "POST",
      githubToken,
      body: {
        repo,
        path: filePath,
        branch: opts.branch,
        projectName: opts.name,
      },
    })
  );

  const source = result.source;
  p.log.success(
    `Imported ${source ? `${source.repo}:${source.path}` : filePath} as ${
      result.project?.name || result.project?.id || result.project_id || "project"
    }`
  );
  printImportChecklist(result);
}

export async function runWorkspaceExport(opts: {
  project?: string;
  out?: string;
}): Promise<void> {
  const auth = requireAuth();
  const projectId = await resolveProjectId(opts.project);
  const result = await authRequest<{ bundle: unknown }>(auth, {
    path: `/projects/${encodeURIComponent(projectId)}/export`,
    method: "POST",
    body: {},
  });
  const json = `${JSON.stringify(result.bundle ?? result, null, 2)}\n`;
  if (opts.out) {
    const dest = path.resolve(opts.out);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, json);
    p.log.success(`Wrote ${dest}`);
    return;
  }
  process.stdout.write(json);
}

export async function runWorkspaceImport(opts: { file?: string; name?: string }): Promise<void> {
  const auth = requireAuth();
  const file = opts.file || (await promptText("Bundle file path"));
  const dest = path.resolve(file);
  if (!fs.existsSync(dest)) {
    throw new Error(`Bundle not found: ${dest}`);
  }
  const bundle = JSON.parse(fs.readFileSync(dest, "utf8"));
  const result = unwrapPayload(
    await authRequest(auth, {
      path: "/workspace/import",
      method: "POST",
      body: { bundle, projectName: opts.name },
    })
  );
  p.log.success(`Imported ${result.project?.name || result.project?.id || result.project_id || "project"}`);
  printImportChecklist(result);
}

function printImportChecklist(result: any): void {
  const rows = [
    ...(result.connectors || []).map((item: any) => ({ ...item, kind: "connector" })),
    ...(result.installations || []).map((item: any) => ({ ...item, kind: "installation" })),
    ...(result.workflows || []).map((item: any) => ({ ...item, kind: "workflow" })),
    ...(result.transformers || []).map((item: any) => ({ ...item, kind: "transformer" })),
    ...(result.gateways || []).map((item: any) => ({ ...item, kind: "gateway" })),
    ...(result.apps || []).map((item: any) => ({ ...item, kind: "app" })),
  ];
  const counts = rows.reduce(
    (acc: Record<string, number>, row: { action?: string }) => {
      const action = String(row.action || "updated");
      acc[action] = (acc[action] || 0) + 1;
      return acc;
    },
    {}
  );
  const summary = ["replaced", "created", "reused", "placeholder", "skipped"]
    .filter((action) => counts[action])
    .map((action) => `${counts[action]} ${action}`)
    .join(", ");
  if (summary) p.log.info(summary);
  for (const row of rows) {
    const label = row.note ? `${row.action} ${row.kind} — ${row.note}` : `${row.action} ${row.kind} ${row.source_id}`;
    p.log.info(label);
  }
}

# @cliodot/cli

Install and run a **Cliodot** instance on your machine or server.

The CLI creates an instance directory, installs the API server and web client, writes environment config, and manages the process lifecycle (start, stop, logs, updates, license).

---

## How to run the CLI

Install once, then use **`npx cliodot`** for every command:

```bash
npm install -g @cliodot/cli
npx cliodot --help
```

If you configure your shell so `cliodot` is on your `PATH`, you can drop `npx` and run `cliodot` directly. Otherwise keep using `npx cliodot`.

```bash
npx cliodot -V
npx cliodot --cli-version
```

---

## Requirements

- **Node.js** 26 or newer
- For **Docker** runtime: [Docker](https://docs.docker.com/get-docker/) installed and running
- For **Native** runtime: nothing beyond Node (the CLI downloads release tarballs and runs them with `node`)

Public community installs do **not** need a GitHub token.

---

## Quick start

```bash
mkdir my-cliodot && cd my-cliodot
cliodot init
cliodot start
cliodot status
```

The wizard asks for:

| Prompt | What it means |
|--------|----------------|
| Instance name | Label stored in `cliodot.instance.json` |
| Runtime | **Docker** (containers) or **Native** (Node processes) |
| Mode | Local, production, or enterprise defaults |
| Apps | Which product apps to enable (OAuth, Auth, Events, Memory, Identity, …) |
| Ports | API (default `8901`) and client (default `3000`) |
| MongoDB / Redis | Bundled via Compose, or point at existing / Atlas URIs |

By default **both server and client** are installed from the latest public releases.

Open the client at `http://localhost:3000` (or the port you chose). The API listens on the configured API port.

---

## What gets created

After `init`, your instance directory typically contains:

| Path | Purpose |
|------|---------|
| `cliodot.instance.json` | Instance metadata (runtime, ports, versions, apps) |
| `.env` / `server/.env` | Server configuration and secrets |
| `client/` | Web client (native) or Compose service (Docker) |
| `server/` | API server (native) or Compose service (Docker) |
| `.cliodot/` | Local CLI state and logs |

Edit env files carefully; `npx cliodot update` preserves secrets when refreshing binaries.

---

## Runtime modes

### Docker

Pulls Cliodot images and runs them with Docker Compose (plus Mongo/Redis if you chose Compose). Best when you already use containers and want isolated services.

### Native

Downloads GitHub Release tarballs and runs the API and client as Node processes. Best for simple local setups without Docker.

Default public sources:

| Component | Release assets |
|-----------|----------------|
| Server | [`cliodot/cliodot-community-server`](https://github.com/cliodot/cliodot-community-server) → `cliodot-api-<version>.tar.gz` |
| Client | [`cliodot/cliodot-community-client`](https://github.com/cliodot/cliodot-community-client) → `cliodot-client-<version>.tar.gz` |

---

## Commands

All commands accept `--dir <path>` (defaults to the current working directory).

### Init

```bash
cliodot init
cliodot init --dir ./my-instance
cliodot init --server-version 0.0.1 --client-version 0.0.1
cliodot init --client-only
cliodot init -y
```

`npx cliodot init` alone runs the full interactive wizard.

### Lifecycle

```bash
cliodot start
cliodot stop
cliodot restart
cliodot status
cliodot logs
cliodot logs -f
```

### Update

```bash
cliodot update
cliodot update --server 1.2.3
cliodot update --client 1.2.3
cliodot update --server 1.2.3 --client 1.2.3
```

### License

Request a license for your instance. **Developer** is the default (no `--type` needed) and is auto-issued when the request succeeds, along with **trial**. If the request fails or stays pending, contact Cliodot support at **cliodot@cliodot.com**.

```bash
cliodot license --request
cliodot license --request --type trial
cliodot license --request --type starter
cliodot license --activate YOUR_ACTIVATION_KEY
cliodot license --status
cliodot license --status --token "$CLIODOT_ADMIN_TOKEN"
```

Or from the installed server package:

```bash
cd server && npm run license:request
```

### Private registries (optional)

Community public assets need no login. For **private** images or release assets:

```bash
npx cliodot login --token ghp_your_pat
```

`cliodot login` is only for GHCR / GitHub Releases. To push and pull **workspace bundles**, log into a Cliodot API separately:

```bash
cliodot auth login
cliodot auth status
cliodot auth github
cliodot auth logout
```

`cliodot auth github` uses the GitHub session already on your machine (`gh auth login`, `GITHUB_TOKEN`, or `git credential` for github.com). `--token` is only needed if nothing is connected. SSH remotes cannot call the GitHub API.

Credentials are stored at `~/.cliodot/auth.json`. `auth login` opens the app (`/cli-login?session=...`). Sign in there; the CLI waits. No email or password on the terminal.

```bash
cliodot auth login --api-url http://localhost:8901
cliodot auth login --api-key ck_... --api-secret sk_...
```

### Workspace (GitHub)

Requires `cliodot auth login`. GitHub comes from this machine's `gh`/git session unless you pass `--github-token`.

```bash
cliodot workspace push --project <projectId> --repo owner/name
cliodot workspace pull --repo owner/name --path cliodot/workspaces/my-project.workspace.json
cliodot workspace export --project <projectId> --out ./workspace.json
cliodot workspace import --file ./workspace.json
```

The same GitHub sync is available from the API:

- `POST /api-core/cliodot/projects/:projectId/export/github`
- `POST /api-core/cliodot/workspace/import/github`

Body: `{ "repo": "owner/name", "path": "...", "branch": "main", "github_token": "..." }`. Token can also be sent as `X-GitHub-Token`. The server does not store the GitHub token. Secrets are stripped on export; import remaps IDs onto the destination tenant.

---

## Typical workflows

**New local instance**

```bash
mkdir ~/cliodot-dev && cd ~/cliodot-dev
cliodot init
cliodot start
cliodot license --request
```

**Client pointed at a remote API**

```bash
cliodot init --client-only
cliodot start
```

**Upgrade later**

```bash
cd ~/cliodot-dev
cliodot stop
cliodot update
cliodot start
```

---

## Troubleshooting

| Symptom | What to try |
|---------|-------------|
| `cliodot: command not found` | Use `npx cliodot …`, or put npm’s global bin on your `PATH` |
| Native init: asset not found | Confirm a GitHub Release exists for that version on the community repos above |
| Docker init fails | Ensure Docker is running (`docker info`); retry after `docker login` only if using private images |
| Port already in use | Re-run init with different ports, or stop the process using that port |
| License / API unreachable | Confirm `npx cliodot status` shows the API up; check API port and `server/.env` |
| License request failed or pending | Retry `npx cliodot license --request`; if it still fails, email **cliodot@cliodot.com** |

---

## Help

```bash
cliodot --help
cliodot init --help
cliodot update --help
```

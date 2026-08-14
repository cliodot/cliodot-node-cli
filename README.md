# @cliodot/cli

Install and manage a Cliodot instance (**Docker** GHCR images or **Native** GitHub Release tarballs).

Publish with three separate commands: **`release server`**, **`release client`**, **`release cli`**.

Community tarball releases default to:

- Server → [`cliodot/cliodot-community-server`](https://github.com/cliodot/cliodot-community-server) (`build:dev`, force-push mirror, then GitHub Release)
- Client → [`cliodot/cliodot-community-client`](https://github.com/cliodot/cliodot-community-client) (force-push mirror, then GitHub Release)


---

## Build the CLI first (required)

From the **flowsync-api** monorepo root:

```bash
npm install
npm run build -w @cliodot/cli
```

Then either:

```bash
npx cliodot --help
# or
node packages/cliodot-cli/dist/index.js --help
```

If you see `Permission denied` on the bin, rebuild (build sets execute bit on `dist/index.js`), or use `node …/dist/index.js` directly.

**Do not** use `--version` to print the CLI version — that flag is reserved for release versioning. Use:

```bash
npx cliodot -V
# or
npx cliodot --cli-version
```

---

## Auth / tokens for publishing

Put tokens in `packages/cliodot-cli/.env` (or export in the shell). The CLI loads that file on startup.

```bash
GITHUB_TOKEN=ghp_...
GHCR_TOKEN=ghp_...          # optional; falls back to GITHUB_TOKEN
NPM_TOKEN=npm_...           # required for release cli --npm
```

| Task | Token needs |
|------|-------------|
| Push GHCR | `write:packages` (+ login) |
| Upload GitHub Release assets | `contents: write` on release repo |
| `npm publish` | `NPM_TOKEN` with publish rights for `@cliodot/cli` |
| Native / Docker pull from **public** artifacts | **No token** |
| Native install from private releases | read token |

Docker login (local):

```bash
echo "$GITHUB_TOKEN" | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
```

---

## Correct release order

1. **CLI** (installer users need) — public npm  
2. **Server** — image + native tarball  
3. **Client** — image + native tarball  

Native `cliodot init` defaults to **`latest`** (resolves GitHub’s latest release) and enables **all apps**. Override version/tag in the prompts if needed.

---

## Release server (API)

Run from **flowsync-api** (has `Dockerfile` + `build:release`).

```bash
# Public obfuscated artifacts (default)
npx cliodot release server --version 0.0.1 --push --upload
npx cliodot release client --version 0.0.1 --push --upload

npx cliodot release client --version 0.0.1 --dir /Users/huiospayltd/Documents/bz/flowsync-app --push --upload

# Private only
npx cliodot release server --version 0.0.1 --push --upload --no-public
```

`--public` is **on by default**. For anonymous native installs, `--release-repo` must be a **public** GitHub repo (private repos always need a token to download assets).

What it does (order: docker → npm → tarball; each stage soft-fails independently):

| Step | Detail |
|------|--------|
| Docker | Builds root `Dockerfile` → `ghcr.io/arrikk/cliodot-server:<ver>` (+ `latest`) |
| npm | Publishes `@cliodot/server` (obfuscated) |
| Native | `npm run build:release` (`tsc` → terser → obfuscate), packs `cliodot-api-<ver>-<os-arch>.tar.gz` |
| Upload | GitHub Release `v<ver>` on `--release-repo` (default `cliodot/cliodot-community-server` / `cliodot/cliodot-community-client`) |

Stage selection:

```bash
# npm only
npx cliodot release server --version 0.0.1 --only npm
npx cliodot release client --version 0.0.1 --dir /Users/huiospayltd/Documents/bz/flowsync-app --only npm
npx cliodot release client --version 0.0.1 --dir /path/to/flowsync-app --only npm

# docker only (add --push to push GHCR)
npx cliodot release server --version 0.0.1 --only docker --push

# tarball + GitHub upload only
npx cliodot release server --version 0.0.1 --only tarball

# combine
npx cliodot release server --version 0.0.1 --only docker,npm --push
```

Useful flags:

```bash
--only docker,npm,tarball   # run only these stages (aliases: image, tar, native, upload)
--no-docker / --no-native / --no-npm
--dir "$PWD"                # force this checkout (CI / local)
--image ghcr.io/arrikk/cliodot-server
--release-repo cliodot/cliodot-community-server
--obfuscate                 # default on
--no-obfuscate              # private only; forbidden with --public
```

**Platform note:** native tarball is for the machine that builds it (`darwin-arm64`, `linux-x64`, …). For Linux installers, build/upload from CI (ubuntu), not only from a Mac.

### Upload an already-built tarball

If pack succeeded but upload was canceled/failed:

```bash
npx cliodot release upload \
  /Users/huiospayltd/Documents/bz/flowsync-api/.cliodot-release/client/0.0.2/cliodot-client-0.0.2.tar.gz

# or discover staged assets
npx cliodot release upload --version 0.0.2 --client
npx cliodot release upload --version 0.0.2 --server
```

---

## Release client (Next app)

Client lives in **`Arrikk/flowsync-app`**. That repo must have a **`Dockerfile`** (Next standalone) or the Docker step fails.

### Option A — local client checkout (recommended while iterating)

```bash
npx cliodot release client \
  --version 0.0.1 \
  --dir /path/to/flowsync-app \
  --push --upload --public
```

### Option B — clone from GitHub

Push `Dockerfile` + `output: "standalone"` in `next.config.js` first, then:

```bash
npx cliodot release client \
  --version 0.0.1 \
  --repo Arrikk/flowsync-app \
  --push --upload --public
```

Artifacts:

- Image: `ghcr.io/arrikk/cliodot-client:<ver>`
- Tarball: `cliodot-client-<ver>.tar.gz` (JS obfuscated when `--obfuscate`)
- Uploaded to GitHub Releases on `Arrikk/flowsync-app`
---

## Release CLI (public npm)

Publishes `@cliodot/cli`:

```bash
cd packages/cliodot-cli   # or from monorepo root with npx
npx cliodot release cli --version 0.0.1 --npm
npx cliodot release cli --version 0.0.1 --npm --upload   # also GitHub Release .tgz
npx cliodot release cli --version 0.0.1 --npm --dry-run
```

Server/client npm packages (`@cliodot/server`, `@cliodot/client`) use `release server|client --only npm` (or full release with npm on by default).

---

## GitHub Actions

| Workflow | File | Publishes |
|----------|------|-----------|
| server-release | `.github/workflows/server-release.yml` | Server image + tarball |
| client-release | `.github/workflows/client-release.yml` | Client image + tarball |
| cli-release | `.github/workflows/cli-release.yml` | `@cliodot/cli` |

All are **manual** (`workflow_dispatch`). Set secrets `PUBLISH_GITHUB_TOKEN` / `PUBLISH_NPM_TOKEN` as needed. Prefer CI for **linux** native server tarballs.

---

## What native installers consume

Native `init` / `update` download **GitHub Release tarballs** (not npm):

| Asset on Release `vX.Y.Z` | Source repo (default) | Used by |
|---------------------------|----------------------|---------|
| `cliodot-api-X.Y.Z-<os-arch>.tar.gz` | `cliodot/cliodot-community-server` | native server (`--with-server`) |
| `cliodot-client-X.Y.Z.tar.gz` | `cliodot/cliodot-community-client` | native client |

Docker init pulls the GHCR tags instead.

```bash
cliodot init --dir ./my-instance
cliodot login --token "$GITHUB_TOKEN"   # if private pulls
cliodot start --dir ./my-instance
```

```bash
cliodot update                    # both → latest
cliodot update --server 1.2.3     # server pinned, client → latest
cliodot update --client 1.2.3     # client pinned, server → latest
```

---

## Privacy model

| Artifact | Visibility |
|----------|------------|
| Server / client **source** | Keep private |
| Server / client **builds** | Private by default; `--public` = public + **obfuscated** |
| `@cliodot/cli` | Public |

Truly anonymous download URLs need a **public** `--release-repo` and/or public GHCR. Assets on a private repo still need a token to download.

---

## Common mistakes

| Symptom | Fix |
|---------|-----|
| Output is only `0.1.0` and nothing runs | You hit root `--version`. Use `--version X.Y.Z` on `release …`, or `-V` for CLI version |
| `Permission denied` on `npx cliodot` | `npm run build -w @cliodot/cli` |
| `GITHUB_TOKEN … required` with a `.env` present | Put tokens in `packages/cliodot-cli/.env` (or export them), then rebuild/run again |
| `open Dockerfile: no such file` (client) | Add Dockerfile to flowsync-app, or pass `--dir` to a local checkout that has it |
| `fetch failed` on upload | Network to `api.github.com` / `uploads.github.com`; retry with `cliodot release upload <tarball>`, or `gh release upload …` |
| Native init: asset not found | Upload must succeed; platform slug must match; need both server + client assets |
| Expected npm package after `release server` | Use `--only npm` (or full release); CLI package is `release cli --npm` |

---

## Quick copy-paste (local publisher)

```bash
# 0) Build CLI + tokens
npm run build -w @cliodot/cli
# packages/cliodot-cli/.env → GITHUB_TOKEN, NPM_TOKEN

# 1) CLI
npx cliodot release cli --version 0.0.1 --npm --upload

# 2) Server (from flowsync-api)
npx cliodot release server --version 0.0.1 --push --upload --public

# 3) Client (local app checkout)
npx cliodot release client --version 0.0.1 \
  --dir /path/to/flowsync-app \
  --push --upload --public
```

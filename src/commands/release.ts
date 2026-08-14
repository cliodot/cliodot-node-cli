import { releaseServer } from "../release/server.js";
import { releaseClient } from "../release/client.js";
import { releaseCli } from "../release/cli.js";
import { releaseUpload } from "../release/upload.js";

export async function runReleaseServer(
  opts: Parameters<typeof releaseServer>[0]
): Promise<void> {
  await releaseServer(opts);
}

export async function runReleaseClient(
  opts: Parameters<typeof releaseClient>[0]
): Promise<void> {
  await releaseClient(opts);
}

export async function runReleaseCli(
  opts: Parameters<typeof releaseCli>[0]
): Promise<void> {
  await releaseCli(opts);
}

export async function runReleaseUpload(
  opts: Parameters<typeof releaseUpload>[0]
): Promise<void> {
  await releaseUpload(opts);
}

export async function activateLicense(opts: {
  apiBaseUrl: string;
  key: string;
}): Promise<{ ok: boolean; message: string; data?: unknown }> {
  const base = opts.apiBaseUrl.replace(/\/$/, "");
  const url = `${base}/api-core/cliodot/license/activate`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ activationKey: opts.key }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      message?: string;
      error?: string;
      license?: unknown;
      success?: boolean;
    };
    if (!res.ok) {
      return {
        ok: false,
        message: body.error || body.message || `Activate failed (HTTP ${res.status})`,
      };
    }
    return {
      ok: true,
      message: body.message || "License activated",
      data: body.license ?? body,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function fetchLicenseStatus(opts: {
  apiBaseUrl: string;
  token?: string;
}): Promise<{ ok: boolean; message: string; data?: unknown }> {
  const base = opts.apiBaseUrl.replace(/\/$/, "");
  const url = `${base}/api-core/cliodot/license/status`;
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    const res = await fetch(url, { headers });
    const body = (await res.json().catch(() => ({}))) as {
      message?: string;
      error?: string;
      license?: unknown;
      data?: unknown;
    };
    if (!res.ok) {
      return {
        ok: false,
        message:
          body.error ||
          body.message ||
          `Status failed (HTTP ${res.status}). Admin auth may be required.`,
      };
    }
    return { ok: true, message: "ok", data: body.license ?? body.data ?? body };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

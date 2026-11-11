// The site's page and listing relays (functions/feeds/_middleware.js) answer
// only a GitHub Actions run from this register's repository. This asks GitHub
// for the short-lived identity token that proves it. The workflow grants
// `id-token: write` and exports the two request variables as PC_OIDC_URL and
// PC_OIDC_TOKEN; outside GitHub there is no token and the relay is not used.
let cached: { value: string; at: number; audience: string } | null = null;

export async function feedAuthorization(via: string): Promise<string | undefined> {
  const url = process.env.PC_OIDC_URL;
  const bearer = process.env.PC_OIDC_TOKEN;
  if (!url || !bearer) return undefined;
  const audience = new URL(via).origin;
  // GitHub's tokens last a few minutes: reuse one for at most two.
  if (cached && cached.audience === audience && Date.now() - cached.at < 120_000) return `Bearer ${cached.value}`;
  const r = await fetch(`${url}${url.includes("?") ? "&" : "?"}audience=${encodeURIComponent(audience)}`, { headers: { Authorization: `bearer ${bearer}`, Accept: "application/json; api-version=2.0" }, signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`GitHub refused an identity token (HTTP ${r.status})`);
  const value = ((await r.json()) as { value?: string }).value;
  if (!value) throw new Error("GitHub returned no identity token");
  cached = { value, at: Date.now(), audience };
  return `Bearer ${value}`;
}

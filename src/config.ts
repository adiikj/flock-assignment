export const config = {
  portalUrl: (process.env.PORTAL_URL ?? "https://urja-ops.flockenergy.tech").replace(/\/$/, ""),
  email: process.env.PORTAL_EMAIL ?? "",
  password: process.env.PORTAL_PASSWORD ?? "",
  port: Number(process.env.PORT ?? 3000),
  timeoutMs: 15_000,
  maxRetries: 3,
};

/** Called at server start-up only, so tests can import modules without credentials. */
export function assertPortalCredentials() {
  if (!config.email || !config.password) {
    throw new Error("Set PORTAL_EMAIL and PORTAL_PASSWORD in .env (see .env.example)");
  }
}
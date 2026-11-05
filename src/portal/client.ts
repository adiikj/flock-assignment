import { config } from "../config.js";

const SESSION_COOKIE = "__Secure-better-auth.session_token";
const CLOCK_SKEW_TOLERANCE_MS = 30_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class PortalError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "PortalError";
  }
}

type HeaderFn = () => Record<string, string>;

export class PortalClient {
  private cookie: string | null = null;
  private expiresAt = 0;
  private loginInFlight: Promise<void> | null = null;
  private clockOffsetMs = 0;

  /** Current time according to the portal (local time unless the skew is significant). */
  portalNow(): number {
    return Date.now() + this.clockOffsetMs;
  }

  /** `extraHeaders` is a function so values like signatures are recomputed on every retry. */
  async getJson<T>(path: string, extraHeaders?: HeaderFn): Promise<T> {
    const res = await this.request(path, extraHeaders);
    return (await res.json()) as T;
  }

  private trackClock(res: Response) {
    const portalTime = Date.parse(res.headers.get("date") ?? "");
    if (Number.isNaN(portalTime)) return;
    const diff = portalTime - Date.now();
    this.clockOffsetMs = Math.abs(diff) > CLOCK_SKEW_TOLERANCE_MS ? diff : 0;
  }

  private async login(): Promise<void> {
    const res = await fetch(`${config.portalUrl}/login`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
        origin: config.portalUrl, // SvelteKit rejects cross-origin form posts
      },
      body: new URLSearchParams({ email: config.email, password: config.password }),
      redirect: "manual",
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    this.trackClock(res);

    // A failed SvelteKit action can still be HTTP 200, so the cookie is the real success signal.
    const setCookie = res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`));
    if (!setCookie) {
      const body = (await res.json().catch(() => null)) as { type?: string } | null;
      throw new PortalError(`Login failed (HTTP ${res.status}, result: ${body?.type ?? "unknown"})`, res.status);
    }

    this.cookie = setCookie.split(";")[0];
    const maxAge = Number(/max-age=(\d+)/i.exec(setCookie)?.[1] ?? 3600);
    this.expiresAt = Date.now() + (maxAge - 60) * 1000; // renew a minute early
  }

  private ensureSession(force = false): Promise<void> {
    if (force) this.cookie = null;
    if (this.cookie && Date.now() < this.expiresAt) return Promise.resolve();
    this.loginInFlight ??= this.login().finally(() => (this.loginInFlight = null));
    return this.loginInFlight;
  }

  private async request(path: string, extraHeaders?: HeaderFn, attempt = 1, reloggedIn = false): Promise<Response> {
    await this.ensureSession();

    let res: Response;
    try {
      res = await fetch(config.portalUrl + path, {
        headers: { cookie: this.cookie!, accept: "application/json", ...extraHeaders?.() },
        redirect: "manual",
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch (err) {
      if (attempt < config.maxRetries) {
        await sleep(500 * 2 ** attempt);
        return this.request(path, extraHeaders, attempt + 1, reloggedIn);
      }
      throw new PortalError(`Portal unreachable: ${(err as Error).message}`);
    }
    this.trackClock(res);

    const toLogin =
      res.status === 401 ||
      res.status === 403 ||
      (res.status >= 300 && res.status < 400 && (res.headers.get("location") ?? "").includes("/login"));
    if (toLogin && !reloggedIn) {
      await this.ensureSession(true);
      return this.request(path, extraHeaders, attempt, true);
    }

    if ((res.status === 429 || res.status >= 500) && attempt < config.maxRetries) {
      const retryAfterMs = Number(res.headers.get("retry-after")) * 1000;
      await sleep(retryAfterMs || 500 * 2 ** attempt);
      return this.request(path, extraHeaders, attempt + 1, reloggedIn);
    }

    if (!res.ok) throw new PortalError(`Portal returned HTTP ${res.status} for ${path}`, res.status);
    return res;
  }
}
import { describe, it, expect } from "vitest";
import { signRequest } from "../src/portal/signing.js";

// Verbatim logic of the portal's browser signing function (`C` in the Transformers page chunk).
async function browserSign(method: string, path: string, query: string, secret: string) {
  const timestamp = String(Math.floor(Date.now() / 1e3));
  const message = [method, path, query, timestamp].join("\n");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return { timestamp, signature: [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("") };
}

describe("signRequest", () => {
  it("produces exactly what the portal's browser code produces", async () => {
    const browser = await browserSign("GET", "/portal/export", "page=1", "test-secret");
    const ours = signRequest({
      method: "GET",
      pathname: "/portal/export",
      query: "page=1",
      secret: "test-secret",
      nowMs: Number(browser.timestamp) * 1000,
    });
    expect(ours).toEqual({ "x-timestamp": browser.timestamp, "x-signature": browser.signature });
  });

  it("uses Unix seconds, so the signature changes every second", () => {
    const base = { method: "GET", pathname: "/portal/export", query: "page=1", secret: "s" };
    const a = signRequest({ ...base, nowMs: 1_793_783_479_000 });
    const b = signRequest({ ...base, nowMs: 1_793_783_480_000 });
    expect(a["x-timestamp"]).toBe("1793783479");
    expect(a["x-signature"]).not.toBe(b["x-signature"]);
  });

  // Reproduces a signature captured from the live portal. The secret stays out of the repo:
  it.skipIf(!process.env.PORTAL_SIGNING_SECRET)("reproduces a signature captured from the portal", () => {
    const ours = signRequest({
      method: "GET",
      pathname: "/portal/export",
      query: "page=1",
      secret: process.env.PORTAL_SIGNING_SECRET!,
      nowMs: 1793783479 * 1000,
    });
    expect(ours["x-signature"]).toBe("dad83dc8a3837a63c8b326e1e93928c534905ef2721090502e362acc364d864c");
  });
});
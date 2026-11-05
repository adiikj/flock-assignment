import { createHmac } from "node:crypto";

export function signRequest(opts: { method: string; pathname: string; query: string; secret: string; nowMs?: number }) {
  const timestamp = String(Math.floor((opts.nowMs ?? Date.now()) / 1000));
  const message = [opts.method, opts.pathname, opts.query, timestamp].join("\n");
  const signature = createHmac("sha256", opts.secret).update(message, "utf8").digest("hex");
  return { "x-timestamp": timestamp, "x-signature": signature };
}
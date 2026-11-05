import { PortalError, type PortalClient } from "./client.js";
import { signRequest } from "./signing.js";
import type { RawPage, RawExportRow, RawDt, RawReading } from "./parse.js";

const enc = encodeURIComponent;

export function createPortalApi(client: PortalClient) {
  // The signing secret is served to any logged-in user by /portal/keys. Cached in memory, never written to disk.
  let secret: string | null = null;
  const getSecret = async (refresh = false) => {
    if (!secret || refresh) {
      secret = (await client.getJson<{ data: { signingSecret: string } }>("/portal/keys")).data.signingSecret;
    }
    return secret;
  };

  async function signedGet<T>(pathname: string, query: string): Promise<T> {
   const send = (key: string) =>
      client.getJson<T>(`${pathname}?${query}`, () =>
        signRequest({ method: "GET", pathname, query, secret: key, nowMs: client.portalNow() }),
      );
    try {
      return await send(await getSecret());
    } catch (err) {
      if (err instanceof PortalError && err.status === 401) return send(await getSecret(true));
      throw err;
    }
  }

  return {
    exportMeters: (page: number) => signedGet<RawPage<RawExportRow>>("/portal/export", `page=${page}`),

    listDts: (page: number) => client.getJson<RawPage<RawDt>>(`/portal/dts?page=${page}`),

    meterEnergy: async (meterId: string) =>
      (await client.getJson<{ data: RawReading[] }>(`/portal/meters/${enc(meterId)}/energy`)).data,
  };
}

export type PortalApi = ReturnType<typeof createPortalApi>;
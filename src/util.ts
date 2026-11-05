export const round = (n: number, dp = 3) => Math.round(n * 10 ** dp) / 10 ** dp;

export function countBy<T>(items: T[], key: (item: T) => string | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    const k = key(item) ?? "unknown";
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}
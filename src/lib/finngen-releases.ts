export const FINNGEN_RELEASES = {
  R12: { release: "R12", data_freeze: "DF12", base_url: "https://r12.finngen.fi", assembly: "GRCh38", public_release_date: "2024-11-04" },
  R13: { release: "R13", data_freeze: "DF13", base_url: "https://r13.finngen.fi", assembly: "GRCh38", public_release_date: "2026-06-02" },
} as const;

export type FinnGenRelease = keyof typeof FINNGEN_RELEASES;
export const DEFAULT_FINNGEN_RELEASE: FinnGenRelease = "R12";

export function parseFinnGenRelease(value: unknown): FinnGenRelease {
  if (value === undefined) return DEFAULT_FINNGEN_RELEASE;
  if (value === "R12" || value === "R13") return value;
  throw new Error("Unsupported FinnGen release. Select R12 or R13 explicitly; releases are never silently substituted.");
}

export function finnGenReleaseMetadata(release: FinnGenRelease): Record<string, unknown> {
  return {
    ...FINNGEN_RELEASES[release], provider: "FinnGen",
    documentation: "https://www.finngen.fi/en/access_results",
    effect_allele: "reference-genome alternate allele",
    retrieved_at: new Date().toISOString(),
  };
}

export function annotateFinnGen(data: unknown, release: FinnGenRelease): Record<string, unknown> {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Expected a FinnGen JSON object.");
  const meta = "meta" in data && data.meta && typeof data.meta === "object" ? data.meta : {};
  return { ...data, meta: { ...meta, finngen: finnGenReleaseMetadata(release) } };
}

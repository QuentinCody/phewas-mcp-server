import { hashCanonicalJson } from "@bio-mcp/shared";
import { FINNGEN_RELEASES, type FinnGenRelease, finnGenReleaseMetadata } from "./finngen-releases";

const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 20000;

function nativeFailure(error: Error, status: number | null, data: unknown) {
  const failure = error as Error & { status: number | null; data: unknown };
  failure.status = status;
  failure.data = data;
  return failure;
}

/** Exact source routes: FINNGEN/pheweb, pheweb/serve/server.py. */
export function finnGenPhenotypeRoute(path: string): boolean {
  return path === "/api/phenos" || /^\/api\/pheno\/[^/]+$/.test(path) || /^\/api\/variant\/[^/]+\/[^/]+$/.test(path);
}

export function validateFinnGenPhenotypePath(path: string, params: Record<string, unknown>) {
  if (Object.keys(params).length) throw new Error("FinnGen phenotype routes accept release selection and path parameters only.");
  if (path === "/api/phenos") return;
  const phenotype = decodeURIComponent(path.slice(path.lastIndexOf("/") + 1));
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/.test(phenotype)) throw new Error("Use an explicit FinnGen phenocode from the selected release's phenotype list.");
}

function hasNativeShape(path: string, native: unknown): boolean {
  const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
  if (path === "/api/phenos") return Array.isArray(native) && native.every(row => record(row) && typeof row.phenocode === "string");
  if (!record(native)) return false;
  if (path.startsWith("/api/pheno/")) return native.phenocode === decodeURIComponent(path.slice(path.lastIndexOf("/") + 1));
  return "results" in native;
}

/** Bounded native reads; never replace a failed response with an empty phenotype set. */
export async function fetchFinnGenPhenotype(path: string, release: FinnGenRelease, params: Record<string, unknown>) {
  validateFinnGenPhenotypePath(path, params);
  const sourceUrl = `${FINNGEN_RELEASES[release].base_url}${path}`;
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let response: Response | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const meta = createPhenotypeMetadata(release, sourceUrl);
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort(); void reader?.cancel().catch(() => {});
      reject(new Error("FinnGen phenotype request exceeded the 20-second local deadline"));
    }, TIMEOUT_MS);
  });
  try {
    const raw = await Promise.race([timeout, (async () => {
      const fetched = await fetch(sourceUrl, { headers: { Accept: "application/json" }, redirect: "manual", signal: controller.signal });
      if (controller.signal.aborted) { void fetched.body?.cancel().catch(() => {}); throw new Error("FinnGen request expired"); }
      response = fetched;
      meta.finngen.http_status = response.status;
      meta.finngen.headers = Object.fromEntries([...response.headers].filter(([name]) => ["etag", "last-modified", "retry-after", "content-type", "content-range"].includes(name)));
      const length = response.headers.get("content-length");
      if (length && /^\d+$/.test(length) && Number(length) > MAX_BYTES) {
        void response.body?.cancel().catch(() => {}); throw new Error("FinnGen phenotype response exceeds the 8 MiB local limit");
      }
      reader = response.body?.getReader();
      return await readPhenotypeText(reader);
    })()]);
    return await decodeFinnGenEvidence(raw, meta, response, path);
  } catch (error) {
    const failure = error instanceof Error ? error : new Error("FinnGen phenotype request failed");
    throw nativeFailure(failure, response?.status ?? null, "data" in failure ? failure.data : { meta });
  } finally {
    clearTimeout(timer); controller.abort(); void reader?.cancel().catch(() => {});
    meta.finngen.retrieved_at = new Date().toISOString();
  }
}

function createPhenotypeMetadata(release: FinnGenRelease, sourceUrl: string) {
  return {
    finngen: {
      ...finnGenReleaseMetadata(release), source_url: sourceUrl, retrieved_at: new Date().toISOString(),
      release_basis: "requested_host", identity_verified: false, trait_equivalence_verified: false,
      coverage_complete: false, body_read_complete: false, parsed_response_sha256: null as string | null,
      http_status: null as number | null, response_bytes: null as number | null,
      response_sha256: null as string | null, headers: {} as Record<string, string>
    }
  };
}

async function readPhenotypeText(reader: ReadableStreamDefaultReader<Uint8Array<ArrayBufferLike>> | undefined) {
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const parts: string[] = []; let bytes = 0;
  while (reader) {
    const part = await reader.read(); if (part.done) break;
    bytes += part.value.byteLength;
    if (bytes > MAX_BYTES) throw new Error("FinnGen phenotype response exceeds the 8 MiB local limit");
    parts.push(decoder.decode(part.value, { stream: true }));
  }
  parts.push(decoder.decode());
  return parts.join("");
}

async function decodeFinnGenEvidence(raw: string, meta: { finngen: { source_url: string; retrieved_at: string; release_basis: string; identity_verified: boolean; trait_equivalence_verified: boolean; coverage_complete: boolean; body_read_complete: boolean; parsed_response_sha256: string | null; http_status: number | null; response_bytes: number | null; response_sha256: string | null; headers: Record<string, string>; }; }, response: Response | undefined, path: string) {
  let native: unknown = raw;
  let parsed = false;
  try { native = JSON.parse(raw.replace(/^\uFEFF/, "")); parsed = true; } catch { /* Preserve non-JSON error bodies. */ }
  meta.finngen.body_read_complete = true;
  meta.finngen.response_bytes = new TextEncoder().encode(raw).byteLength;
  meta.finngen.response_sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw))), byte => byte.toString(16).padStart(2, "0")).join("");
  if (parsed) meta.finngen.parsed_response_sha256 = await hashCanonicalJson(native);
  const data = { data: native, meta };
  if (response?.status !== 200 || response.headers.has("content-range") || !parsed || !response.headers.get("content-type")?.includes("json") || !hasNativeShape(path, native)) {
    throw nativeFailure(new Error(`FinnGen phenotype HTTP ${response?.status ?? "unknown"}; ${parsed ? "inspect the native response" : "expected JSON, native text retained"}`), response?.status ?? null, data);
  }
  return { status: response.status, data };
}

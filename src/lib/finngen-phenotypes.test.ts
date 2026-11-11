import { hashCanonicalJson } from "@bio-mcp/shared";
import { afterEach, expect, it, vi } from "vitest";
import { createPhewasApiFetch } from "./api-adapter";

const api = createPhewasApiFetch();
const query = (path = "/finngen/api/phenos", release: unknown = "R13") => ({ method: "GET", path, params: { release } });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it.each(["R12", "R13"])("retains the native %s phenotype array and request/hash metadata without rewriting provider fields", async release => {
  const native = [{ phenocode: "E4_FIXTURE", phenostring: "Synthetic phenotype", n_cases: "0001", definition: { exclusions: ["OTHER"] }, meta: { finngen: "native" } }];
  const fetcher = vi.fn(async () => Response.json(native, { headers: { etag: '"fixture"' } })); vi.stubGlobal("fetch", fetcher);
  const result = await api(query(undefined, release));
  expect(result).toMatchObject({ status: 200, data: { data: native, meta: { finngen: { release, source_url: `https://${release.toLowerCase()}.finngen.fi/api/phenos`, parsed_response_sha256: await hashCanonicalJson(native), release_basis: "requested_host", body_read_complete: true, identity_verified: false, trait_equivalence_verified: false, coverage_complete: false, headers: { etag: '"fixture"' } } } } });
  expect(fetcher).toHaveBeenCalledExactlyOnceWith(`https://${release.toLowerCase()}.finngen.fi/api/phenos`, expect.objectContaining({ redirect: "manual", signal: expect.any(AbortSignal) }));
});

it("preserves a selected phenotype definition and the distinct native association shape", async () => {
  const definition = { phenocode: "E4_FIXTURE", codes: ["A", "B"], extra: null };
  const association = { results: { phenocode: "E4_FIXTURE", p_value: "1e-500", beta: "-0.010", future: [null, false] } };
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(definition)).mockResolvedValueOnce(Response.json(association)); vi.stubGlobal("fetch", fetcher);
  expect((await api(query("/finngen/api/pheno/E4_FIXTURE"))).data).toHaveProperty("data", definition);
  expect((await api(query("/finngen/api/variant/10:112998590-C-T/E4_FIXTURE"))).data).toHaveProperty("data", association);
  expect(fetcher.mock.calls.map(call => call[0])).toEqual(["https://r13.finngen.fi/api/pheno/E4_FIXTURE", "https://r13.finngen.fi/api/variant/10%3A112998590-C-T/E4_FIXTURE"]);
});

it.each([400, 404, 429, 503, 302])("retains native HTTP %i errors without retry or redirect", async status => {
  const native = { error: "fixture", details: "preserve", meta: { original: true } };
  const expectedHash = await hashCanonicalJson(native);
  const fetcher = vi.fn(async () => Response.json(native, { status, headers: { "retry-after": "120" } })); vi.stubGlobal("fetch", fetcher);
  await expect(api(query())).rejects.toMatchObject({ status, data: { data: native, meta: { finngen: { body_read_complete: true, http_status: status, parsed_response_sha256: expectedHash, headers: { "retry-after": "120" } } } } });
  expect(fetcher).toHaveBeenCalledOnce();
});

it.each([null, { error: "not a phenotype list" }, [null], [{ name: "missing code" }]])("rejects unexpected list shapes while retaining the native body: %j", async native => {
  vi.stubGlobal("fetch", async () => Response.json(native));
  await expect(api(query())).rejects.toMatchObject({ status: 200, data: { data: native, meta: { finngen: { body_read_complete: true } } } });
});

it("keeps an empty active-phenotype list without claiming full dataset coverage", async () => {
  vi.stubGlobal("fetch", async () => Response.json([]));
  expect((await api(query())).data).toMatchObject({ data: [], meta: { finngen: { coverage_complete: false } } });
});

it("rejects a mismatched phenotype definition and a variant error envelope", async () => {
  vi.stubGlobal("fetch", async () => Response.json({ phenocode: "OTHER" }));
  await expect(api(query("/finngen/api/pheno/E4_FIXTURE"))).rejects.toHaveProperty("data.data.phenocode", "OTHER");
  vi.stubGlobal("fetch", async () => Response.json({ error: "no association" }));
  await expect(api(query("/finngen/api/variant/10:112998590-C-T/E4_FIXTURE"))).rejects.toHaveProperty("data.data.error", "no association");
});

it("preserves HTML errors and handles a UTF-8 BOM without claiming a hash for unparsed text", async () => {
  vi.stubGlobal("fetch", async () => new Response("<html>unavailable</html>", { status: 503 }));
  await expect(api(query())).rejects.toMatchObject({ data: { data: "<html>unavailable</html>", meta: { finngen: { parsed_response_sha256: null } } } });
  vi.stubGlobal("fetch", async () => new Response("\uFEFF[]", { headers: { "content-type": "application/json" } }));
  expect((await api(query())).data).toHaveProperty("data", []);
});

it.each(["%2F", "..", "A%3Fq=x"])("rejects an invalid phenotype before rsID resolution or provider IO: %s", code => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  return expect(api(query(`/finngen/api/variant/rs1/${code}`))).rejects.toThrow("explicit FinnGen phenocode").then(() => expect(fetcher).not.toHaveBeenCalled());
});

it("rejects undocumented parameters, releases and mutation methods before IO", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await expect(api({ ...query(), params: { release: "R13", size: 10 } })).rejects.toThrow("path parameters only");
  await expect(api(query(undefined, "R14"))).rejects.toThrow("Unsupported FinnGen release");
  await expect(api({ ...query(), method: "POST" })).rejects.toThrow("GET reads only");
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([true, false])("rejects oversized bodies without retaining partial evidence (advertised=%s)", async advertised => {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(8 * 1024 * 1024 + 1)); }, cancel });
  vi.stubGlobal("fetch", async () => new Response(body, { headers: advertised ? { "content-length": String(8 * 1024 * 1024 + 1) } : {} }));
  await expect(api(query())).rejects.toMatchObject({ message: expect.stringContaining("8 MiB"), data: { meta: { finngen: { body_read_complete: false, parsed_response_sha256: null } } } });
  expect(cancel).toHaveBeenCalledOnce();
});

it("bounds a stalled fetch and body even if cancellation never settles", async () => {
  vi.useFakeTimers();
  for (const stalls of ["fetch", "body"]) {
    vi.stubGlobal("fetch", stalls === "fetch" ? () => new Promise(() => {}) : async () => new Response(new ReadableStream({ cancel: () => new Promise(() => {}) })));
    const result = expect(api(query())).rejects.toMatchObject({ message: expect.stringContaining("deadline"), data: { meta: { finngen: { body_read_complete: false } } } });
    await vi.advanceTimersByTimeAsync(20001); await result;
  }
});

it.each([206, 200])("retains but rejects a partial body at HTTP %s", async status => {
  const native = [{ phenocode: "PARTIAL" }];
  vi.stubGlobal("fetch", async () => Response.json(native, { status, headers: { "content-range": "bytes 0-25/100" } }));
  await expect(api(query())).rejects.toMatchObject({ status, data: { data: native, meta: { finngen: { body_read_complete: true, coverage_complete: false } } } });
});

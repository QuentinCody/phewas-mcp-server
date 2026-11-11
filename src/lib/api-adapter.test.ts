import { afterEach, expect, it, vi } from "vitest";
import { createPhewasApiFetch } from "./api-adapter";

afterEach(() => vi.unstubAllGlobals());
const api = createPhewasApiFetch();
const path = "/finngen/api/variant/10:112998590-C-T";
// Shape/values observed at R13 /api/variant/10:112998590-C-T on 2026-09-27.
const payload = { variant: { chrom: "10", pos: 112998590 }, regions: [], results: [{ phenocode: "AB1_CHLAMYDIA_OTHER", beta: -0.0823995, n_case: 2821, n_control: 484932, pval: 0.01457874031090632 }] };

it("preserves upstream rows and annotates release/build without forwarding the selector", async () => {
  const fetch = vi.fn(async (_input: unknown) => Response.json(payload));
  vi.stubGlobal("fetch", fetch);
  const result = await api({ method: "GET", path, params: { release: "R13" } });
  expect(result.data).toMatchObject({ ...payload, meta: { finngen: { release: "R13", data_freeze: "DF13", assembly: "GRCh38" } } });
  const url = new URL(String(fetch.mock.calls[0][0]));
  expect(url.origin).toBe("https://r13.finngen.fi");
  expect(decodeURIComponent(url.pathname)).toBe("/api/variant/10:112998590-C-T");
  expect(url.searchParams.has("release")).toBe(false);
});

it("preserves default R12 and other cohort results", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(payload)));
  expect((await api({ method: "GET", path })).data).toHaveProperty("meta.finngen.release", "R12");
  expect((await api({ method: "GET", path: "/bbj/api/variant/10:114758349-C-T" })).data).toEqual(payload);
});

it("discovers release hosts without contacting upstream", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  expect((await api({ method: "GET", path: "/finngen/releases" })).data).toMatchObject({ default_release: "R12", releases: [{ release: "R12" }, { release: "R13" }] });
  expect(fetch).not.toHaveBeenCalled();
});

it("rejects unvalidated releases and misplaced selectors before network access", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  await expect(api({ method: "GET", path, params: { release: "R14" } })).rejects.toThrow("Unsupported FinnGen release");
  await expect(api({ method: "GET", path: "/bbj/api/variant/rs7903146", params: { release: "R13" } })).rejects.toThrow("only supported for FinnGen");
  await expect(api({ method: "POST", path })).rejects.toThrow("GET reads only");
  expect(fetch).not.toHaveBeenCalled();
});

it("rejects API HTML and HTTP errors instead of treating them as data", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404 })));
  await expect(api({ method: "GET", path, params: { release: "R13" } })).rejects.toThrow("HTTP 404");
  vi.stubGlobal("fetch", vi.fn(async () => new Response("login", { headers: { "content-type": "text/html" } })));
  await expect(api({ method: "GET", path })).rejects.toThrow("Expected JSON");
  expect((await api({ method: "GET", path: "/finngen/variant/10:112998590-C-T", params: { release: "R13" } })).data).toMatchObject({ html: "login", meta: { finngen: { release: "R13" } } });
});

it("rejects an HTTP 200 error object instead of presenting it as FinnGen association data", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "backend unavailable" })));
  await expect(api({ method: "GET", path, params: { release: "R13" } })).rejects.toThrow("Unrecognized PheWAS");
});

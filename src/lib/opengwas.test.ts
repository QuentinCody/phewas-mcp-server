import { afterEach, expect, it, vi } from "vitest";
import { createOpenGwasFetch } from "./opengwas";

afterEach(() => vi.unstubAllGlobals());
const query = { method: "POST", path: "/opengwas/associations", body: { id: ["ieu-a-2"], variant: ["rs7903146"] } };

it("allows anonymous discovery and preserves partial upstream outages", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ SERVICES__PIPELINE: "Error", API__VERSION: "4.0.0" }));
  vi.stubGlobal("fetch", fetch);
  const result = await createOpenGwasFetch()({ method: "GET", path: "/opengwas/status" });
  expect(result.data).toMatchObject({ data: { SERVICES__PIPELINE: "Error" }, meta: { opengwas: { provider: "IEU OpenGWAS" } } });
  expect(fetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
});

it("rejects protected queries before network access without a configured token", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  await expect(createOpenGwasFetch()(query)).rejects.toThrow("OPENGWAS_JWT");
  expect(fetch).not.toHaveBeenCalled();
});

it("sends authenticated JSON queries and retains alleles, proxies and allowance metadata", async () => {
  const data = [{ id: "ieu-a-2", ea: "T", nea: "C", beta: 0.25, proxy: false }];
  const fetch = vi.fn().mockResolvedValue(Response.json(data, { headers: { "X-Allowance-Remaining": "900", "X-Allowance-Reset": "1790000000" } }));
  vi.stubGlobal("fetch", fetch);
  const result = await createOpenGwasFetch("fixture-token")(query);
  expect(result.data).toMatchObject({ data, meta: { opengwas: { input_coordinate_build: "GRCh37", rate_limits: { "x-allowance-remaining": "900" } } } });
  expect(fetch).toHaveBeenCalledWith("https://api.opengwas.io/api/associations", expect.objectContaining({ method: "POST", redirect: "manual", headers: { Accept: "application/json", Authorization: "Bearer fixture-token", "Content-Type": "application/json" }, body: JSON.stringify({ ...query.body, proxies: 0 }) }));
});

it.each([302, 401, 429, 503])("does not follow/retry HTTP %i or expose response-body credentials", async status => {
  const fetch = vi.fn().mockResolvedValue(new Response("fixture-token", { status, headers: { "Retry-After": "60" } }));
  vi.stubGlobal("fetch", fetch);
  const error = await createOpenGwasFetch("fixture-token")(query).catch(e => e);
  expect(error.status).toBe(status);
  expect(error.data.meta.opengwas.rate_limits).toEqual({ "retry-after": "60" });
  expect(String(error)).not.toContain("fixture-token");
  expect(fetch).toHaveBeenCalledOnce();
});

it("redacts credential echoes from successful responses", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ echo: "fixture-token" })));
  expect(JSON.stringify(await createOpenGwasFetch("fixture-token")(query))).not.toContain("fixture-token");
});

it.each([
  () => Promise.reject(new Error("fixture-token")),
  () => Promise.resolve(new Response("HTML")),
  () => Promise.resolve(new Response("{bad", { headers: { "content-type": "application/json" } })),
])("reports safe network and invalid-response errors", async response => {
  vi.stubGlobal("fetch", vi.fn(response));
  await expect(createOpenGwasFetch("fixture-token")(query)).rejects.toThrow(/^OpenGWAS/);
});

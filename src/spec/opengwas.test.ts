/// <reference types="node" />
import { runInNewContext } from "node:vm";
import { createApiProxyTool } from "@bio-mcp/shared/tools/api-proxy";
import { afterEach, expect, it, vi } from "vitest";
import { createPhewasApiFetch } from "../lib/api-adapter";
import { phewasCatalog } from "./catalog";
import { openGwasEndpoints } from "./opengwas";

afterEach(() => vi.unstubAllGlobals());

it("executes every OpenGWAS example through the real catalog proxy and adapter", async () => {
  const fetch = vi.fn().mockImplementation(async () => Response.json([{ id: "ieu-a-2", build: "HG19/GRCh37", is_nc: true }]));
  vi.stubGlobal("fetch", fetch);
  // SAFETY: these small fixture responses never use DO/session capabilities.
  const proxy = createApiProxyTool({ catalog: phewasCatalog, apiFetch: createPhewasApiFetch("fixture-token"), doNamespace: {} as DurableObjectNamespace, stagingPrefix: "phewas" });
  // SAFETY: no staged response in this catalog routing fixture.
  const context = {} as Parameters<typeof proxy.handler>[1];
  const api = {
    get: (path: string) => proxy.handler({ method: "GET", path }, context),
    post: (path: string, body: unknown) => proxy.handler({ method: "POST", path, body }, context),
  };
  for (const endpoint of openGwasEndpoints) {
    const result = await runInNewContext(`(async()=>{${endpoint.example}})()`, { api });
    expect(result.__api_error).not.toBe(true);
    expect(result).toMatchObject({ data: [{ build: "HG19/GRCh37", is_nc: true }], meta: { opengwas: { provider: "IEU OpenGWAS" } } });
  }
  expect(fetch).toHaveBeenCalledTimes(6);
  expect(phewasCatalog.endpointCount).toBe(phewasCatalog.endpoints.length);
});

it("retains quota metadata in the proxy error envelope", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("rate limited", { status: 429, headers: { "Retry-After": "120" } })));
  // SAFETY: the error response never accesses the DO.
  const proxy = createApiProxyTool({ catalog: phewasCatalog, apiFetch: createPhewasApiFetch("fixture-token"), doNamespace: {} as DurableObjectNamespace, stagingPrefix: "phewas" });
  // SAFETY: this upstream error never accesses session capabilities.
  const context = {} as Parameters<typeof proxy.handler>[1];
  const result = await proxy.handler({ method: "POST", path: "/opengwas/phewas", body: { variant: ["rs7903146"] } }, context);
  expect(result).toMatchObject({ __api_error: true, status: 429, data: { meta: { opengwas: { rate_limits: { "retry-after": "120" } } } } });
});

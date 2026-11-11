/// <reference types="node" />
import { runInNewContext } from "node:vm";
import { createApiProxyTool } from "@bio-mcp/shared/tools/api-proxy";
import { afterEach, expect, it, vi } from "vitest";
import { createPhewasApiFetch } from "../lib/api-adapter";
import { phewasCatalog } from "./catalog";

afterEach(() => vi.unstubAllGlobals());
it("executes FinnGen release examples through the real catalog proxy", async () => {
  const fetch = vi.fn(async (_input: unknown) => Response.json({ results: [] }));
  vi.stubGlobal("fetch", fetch);
  // SAFETY: these small fixtures don't use the DO or session capabilities.
  const proxy = createApiProxyTool({ catalog: phewasCatalog, apiFetch: createPhewasApiFetch(), doNamespace: {} as DurableObjectNamespace, stagingPrefix: "phewas" });
  // SAFETY: only GET requests with inline fixture responses are executed.
  const context = {} as Parameters<typeof proxy.handler>[1];
  const api = { get: (path: string, params?: Record<string, unknown>) => proxy.handler({ method: "GET", path, params }, context) };
  for (const endpoint of phewasCatalog.endpoints.filter(e => e.example && e.category === "finngen")) {
    const result = await runInNewContext(`(async()=>{${endpoint.example}})()`, { api });
    expect(result.__api_error).not.toBe(true);
  }
  expect(fetch).toHaveBeenCalledOnce();
  expect(String(fetch.mock.calls[0][0])).toBe("https://r13.finngen.fi/api/variant/10%3A112998590-C-T");
  expect(phewasCatalog.endpointCount).toBe(phewasCatalog.endpoints.length);
});

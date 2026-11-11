import { hashCanonicalJson } from "@bio-mcp/shared";
import { DynamicWorkerExecutor } from "@bio-mcp/shared/codemode/execute-tool";
import { McpServer } from "@bio-mcp/shared/mcp";
import { afterEach, expect, it, vi } from "vitest";
import { phewasResponse } from "../lib/tool-result";
import { registerCodeMode } from "./code-mode";
import { registerGetSchema } from "./get-schema";
import { registerQueryData } from "./query-data";
import { registerVariantLookup } from "./variant-lookup";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function fixture() {
  const stored: unknown[] = [];
  const namespace = { idFromName: (name: string) => name, get: () => ({ fetch: async (request: Request) => {
    const path = new URL(request.url).pathname;
    if (path === "/process") {
      const { data } = await request.json() as { data: unknown };
      stored.push(typeof data === "string" ? JSON.parse(data) : data);
      return Response.json({ success: true, tables_created: ["payloads"], total_rows: 1 });
    }
    if (path === "/query") return Response.json({ success: true, results: [{ evidence: "α".repeat(20000) }], row_count: 1 });
    return Response.json({ success: true, schema: { tables: { rows: { columns: [{ name: "evidence", description: "α".repeat(20000) }] } } } });
  } }) };
  const env = { PHEWAS_DATA_DO: namespace, CODE_MODE_LOADER: { get: () => ({}) } } as unknown as Parameters<typeof registerCodeMode>[1];
  const server = new McpServer({ name: "fixture", version: "1" });
  registerCodeMode(server, env); registerQueryData(server, env); registerGetSchema(server, env); registerVariantLookup(server, env);
  const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown, extra: unknown) => Promise<Record<string, unknown>> }> })._registeredTools;
  return { stored, env, tools };
}

it("registers all ten aliases and discovers the native phenotype routes through both search names", async () => {
  const { tools } = fixture();
  expect(Object.keys(tools).sort()).toEqual(["search", "execute", "get_schema", "query_data", "variant_lookup"].flatMap(name => [`phewas_${name}`, `mcp_phewas_${name}`]).sort());
  for (const name of ["phewas_search", "mcp_phewas_search"]) {
    const result = await tools[name].handler({ query: "FinnGen phenotype", max_results: 25 }, {});
    expect(result).toMatchObject({ content: expect.any(Array), structuredContent: { success: true } });
    expect(JSON.stringify(result)).toContain("/finngen/api/phenos");
    expect(JSON.stringify(result)).toContain("/finngen/api/variant/{variant}/{phenocode}");
  }
});

it.each(["phewas_execute", "mcp_phewas_execute"])("stages the complete phenotype source through %s and the real API proxy", async name => {
  const { tools, stored } = fixture();
  const native = [{ phenocode: "E4_FIXTURE", note: "α".repeat(55000), n_cases: "0001" }];
  vi.stubGlobal("fetch", async () => Response.json(native));
  vi.spyOn(DynamicWorkerExecutor.prototype, "execute").mockImplementation(async (_code, functions) => ({ result: await functions.__api_proxy({ method: "GET", path: "/finngen/api/phenos", params: { release: "R13" } }) }));
  const result = await tools[name].handler({ code: "return await api.get('/finngen/api/phenos', {release: 'R13'});" }, {});
  expect(result).toMatchObject({ content: expect.any(Array), structuredContent: { success: true, _meta: { citation: { result_hash: expect.any(String) } } } });
  expect(JSON.stringify(result)).toContain("data_access_id");
  expect(stored).toContainEqual(expect.objectContaining({ data: native, meta: expect.objectContaining({ finngen: expect.objectContaining({ parsed_response_sha256: await hashCanonicalJson(native), release: "R13" }) }) }));
  expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThan(30000);
});

it.each(["phewas_execute", "mcp_phewas_execute"])("bounds a large composed result and preserves its full-envelope hash through %s", async name => {
  const { tools, stored } = fixture();
  const native = { definitions: [{ phenocode: "E4_FIXTURE", note: "α".repeat(55000) }], association: { results: { pval: "1e-500" } } };
  vi.spyOn(DynamicWorkerExecutor.prototype, "execute").mockResolvedValue({ result: native });
  const result = await tools[name].handler({ code: "return composed;" }, {});
  expect(result).toMatchObject({ structuredContent: { success: true, staged: true, _staging: expect.any(Object) } });
  const original = stored.find(value => (value as { structuredContent?: { data?: unknown } }).structuredContent?.data !== undefined);
  expect(original).toMatchObject({ structuredContent: { data: native } });
  expect(result).toMatchObject({ structuredContent: { _meta: { citation: { result_scope: "staged:full_result", result_hash: await hashCanonicalJson(original) } } } });
  expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThan(30000);
});

it.each(["phewas_query_data", "mcp_phewas_query_data", "phewas_get_schema", "mcp_phewas_get_schema"])("preserves complete oversized SQL/schema output through %s", async name => {
  const { tools, stored } = fixture();
  expect(await tools[name].handler({ data_access_id: "fixture", sql: "SELECT evidence FROM rows" }, {})).toMatchObject({ content: expect.any(Array), structuredContent: { success: true, staged: true, _staging: expect.any(Object) } });
  expect(JSON.stringify(stored)).toContain("α".repeat(20000));
});

it("keeps large error evidence and explicitly fails when staging is unavailable", async () => {
  const { env, stored } = fixture();
  const original = { content: [{ type: "text" as const, text: "provider error" }], structuredContent: { success: false, error: { native: "α".repeat(20000) } } };
  expect(await phewasResponse(async () => original, env, "phewas_execute", {}, {})).toMatchObject({ isError: true, content: expect.any(Array), structuredContent: { success: false, staged: true } });
  const storedError = stored.find(value => (value as typeof original).structuredContent?.error) as typeof original;
  expect(storedError.content).toEqual(original.content);
  expect(storedError.structuredContent.error).toEqual(original.structuredContent.error);
  expect(storedError).toMatchObject({ isError: true, structuredContent: { success: false } });
  const failed = await phewasResponse(async () => original, {}, "phewas_execute", {}, {});
  const { _meta, ...payload } = failed.structuredContent!;
  expect(failed).toMatchObject({ isError: true, content: expect.any(Array), structuredContent: { success: false, error: { code: "RESPONSE_ERROR" } } });
  expect(_meta).toMatchObject({ citation: { result_scope: "structured_content:root_without_meta", result_hash: await hashCanonicalJson(payload) } });
});

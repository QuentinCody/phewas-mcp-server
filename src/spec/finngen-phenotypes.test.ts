import { createApiProxyTool } from "@bio-mcp/shared/tools/api-proxy";
import { afterEach, expect, it, vi } from "vitest";
import { createPhewasApiFetch } from "../lib/api-adapter";
import { phewasCatalog } from "./catalog";
import { finnGenPhenotypeWorkflow } from "./finngen-phenotypes";

afterEach(() => vi.unstubAllGlobals());
const run = (api: unknown, selected = false) => new Function("api", `return (async () => {${selected ? finnGenPhenotypeWorkflow.code.replace('const phenocode = "";', 'const phenocode = "E4_FIXTURE";') : finnGenPhenotypeWorkflow.code}})();`)(api);

it("requires an explicit phenotype selection before any request", async () => {
  const get = vi.fn();
  expect(await run({ get })).toMatchObject({ selection_required: true, release: "R13" });
  expect(get).not.toHaveBeenCalled();
});

it("executes the selected definition/association recipe through the actual proxy and retains native fields", async () => {
  const definition = { phenocode: "E4_FIXTURE", phenostring: "Synthetic", exclusions: ["OTHER"] };
  const association = { results: { pval: "1e-500", beta: "-0.03" } };
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(definition)).mockResolvedValueOnce(Response.json(association)); vi.stubGlobal("fetch", fetcher);
  const proxy = createApiProxyTool({ catalog: phewasCatalog, apiFetch: createPhewasApiFetch(), doNamespace: {} as DurableObjectNamespace, stagingPrefix: "phewas" });
  const get = (path: string, params: Record<string, unknown>) => proxy.handler({ method: "GET", path, params }, {} as Parameters<typeof proxy.handler>[1]);
  expect(await run({ get }, true)).toMatchObject({ definition: { data: definition, meta: { finngen: { release: "R13" } } }, association: { data: association }, trait_equivalence_verified: false, gene_score_contribution: false });
  expect(fetcher.mock.calls.map(call => call[0])).toEqual(["https://r13.finngen.fi/api/pheno/E4_FIXTURE", "https://r13.finngen.fi/api/variant/10%3A112998590-C-T/E4_FIXTURE"]);
});

it.each([{ __staged: true, data_access_id: "fixture" }, { __api_error: true, status: 404 }, { data: { phenocode: "OTHER" } }, { data: {} }])("does not issue an association read when the selected definition cannot be inspected: %j", async definition => {
  const get = vi.fn(async () => definition);
  expect(await run({ get }, true)).toHaveProperty("definition", definition);
  expect(get).toHaveBeenCalledOnce();
});

it("retains a staged association handle alongside the inspected definition", async () => {
  const association = { __staged: true, data_access_id: "association" };
  const get = vi.fn().mockResolvedValueOnce({ data: { phenocode: "E4_FIXTURE" } }).mockResolvedValueOnce(association);
  expect(await run({ get }, true)).toHaveProperty("association", association);
});

import type { McpServer } from "@bio-mcp/shared/mcp";
import { lookupRsid, resolveVariant } from "@bio-mcp/shared/variants/resolve";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { registerVariantLookup } from "./variant-lookup";

vi.mock("@bio-mcp/shared/variants/resolve", async original => ({
  ...await original<typeof import("@bio-mcp/shared/variants/resolve")>(), lookupRsid: vi.fn(), resolveVariant: vi.fn(),
}));

const resolved = {
  input: { type: "rsid" as const, value: "rs7903146" },
  rsid: "rs7903146", warnings: [],
  grch38: { chr: "10", pos: 112998590, ref: "C", alt: "T", canonical: "10:112998590-C-T" },
  grch37: { chr: "10", pos: 114758349, ref: "C", alt: "T", canonical: "10:114758349-C-T" },
};
function registration() {
  const registerTool = vi.fn();
  // SAFETY: test captures SDK registrations and invokes the registered callback only.
  registerVariantLookup({ registerTool } as unknown as McpServer);
  return registerTool.mock.calls;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(lookupRsid).mockResolvedValue({ chr: "10", pos: 112998590, ref: "C", alts: ["T"] });
  vi.mocked(resolveVariant).mockResolvedValue(resolved);
});
afterEach(() => vi.unstubAllGlobals());

it("registers both aliases and validates release/assembly choices", () => {
  const calls = registration();
  expect(calls.map(c => c[0])).toEqual(["phewas_variant_lookup", "mcp_phewas_variant_lookup"]);
  expect(calls[0][2]).toBe(calls[1][2]);
  expect(() => calls[0][1].inputSchema.finngen_release.parse("R14")).toThrow();
  expect(calls[0][1].inputSchema.input_build.parse(undefined)).toBeUndefined();
});

it.each([undefined, "R13"])("uses the selected FinnGen release %s in data and URLs", async release => {
  const fetch = vi.fn(async (_input: unknown) => Response.json({ results: [{ phenocode: "E4_DM2", pval: 0, beta: 0.462, n_case: 66187, n_control: 434161 }] }));
  vi.stubGlobal("fetch", fetch);
  const result = await registration()[0][2]({ variant: "rs7903146", cohorts: ["finngen"], finngen_release: release }, {});
  const expected = release ?? "R12";
  expect(String(fetch.mock.calls[0][0])).toContain(`https://${expected.toLowerCase()}.finngen.fi/`);
  expect(result.structuredContent.data.results[0]).toMatchObject({ assembly: "GRCh38", source: { release: expected }, top_associations: [{ phenotype_id: "E4_DM2", n_cases: 66187, n_controls: 434161 }] });
  expect(result.structuredContent.data.results[0].variant_url).toContain(`${expected.toLowerCase()}.finngen.fi`);
  expect(result.structuredContent).toHaveProperty("_meta.citation.result_hash");
});

it("uses the declared input assembly and never retries a different build", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ results: [] })));
  const handler = registration()[0][2];
  await handler({ variant: "10:114758349-C-T", input_build: "GRCh37", cohorts: ["finngen"] }, {});
  expect(resolveVariant).toHaveBeenCalledWith("grch37", "10:114758349-C-T");
  vi.mocked(resolveVariant).mockRejectedValue(new Error("No coordinate in GRCh37"));
  const result = await handler({ variant: "10:114758349-C-T", input_build: "GRCh37", cohorts: ["finngen"] }, {});
  expect(result.isError).toBe(true);
  expect(resolveVariant).not.toHaveBeenCalledWith("grch38", expect.anything());
});

it("preserves release metadata for a missing variant", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404 })));
  const result = await registration()[0][2]({ variant: "rs7903146", cohorts: ["finngen"], finngen_release: "R13" }, {});
  expect(result.structuredContent.data.results[0]).toMatchObject({ status: "not_found", source: { release: "R13" }, association_count_total: 0 });
});

it("returns unsupported release errors with both fields before resolving a variant", async () => {
  const result = await registration()[0][2]({ variant: "rs7903146", cohorts: ["finngen"], finngen_release: "R14" }, {});
  expect(result).toMatchObject({ isError: true, structuredContent: { success: false } });
  expect(result.content).toBeDefined();
  expect(lookupRsid).not.toHaveBeenCalled();
});

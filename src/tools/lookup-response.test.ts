import { stageToDoAndRespond } from "@bio-mcp/shared/staging/utils";
import { beforeEach, expect, it, vi } from "vitest";
import { formatLookupResponse } from "./lookup-response";

vi.mock("@bio-mcp/shared/staging/utils", async original => ({
  ...await original<typeof import("@bio-mcp/shared/staging/utils")>(), stageToDoAndRespond: vi.fn(),
}));
const options = { textSummary: "PheWAS results", query: { finngen_release: "R13" }, extra: {} };
// SAFETY: the DO boundary is mocked in these formatting tests.
const env = { PHEWAS_DATA_DO: {} as DurableObjectNamespace };
beforeEach(() => vi.clearAllMocks());

it("cites small results with both MCP fields", async () => {
  const r = await formatLookupResponse({ results: [] }, env, options);
  expect(r.structuredContent).toHaveProperty("_meta.citation.result_hash");
  expect(r.content).toHaveLength(1);
  expect(stageToDoAndRespond).not.toHaveBeenCalled();
});

it("stages oversized UTF-8 results and preserves the citation hash", async () => {
  // SAFETY: the formatter consumes only the supplied fields of StageResult.
  vi.mocked(stageToDoAndRespond).mockResolvedValue({ dataAccessId: "staged", tablesCreated: ["results"], totalRows: 1, _staging: { payload_hash: "sha256:example" } } as Awaited<ReturnType<typeof stageToDoAndRespond>>);
  const r = await formatLookupResponse({ data: "🧬".repeat(9000) }, env, options);
  expect(stageToDoAndRespond).toHaveBeenCalledOnce();
  expect(r.structuredContent).toMatchObject({ success: true, _staging: { data_access_id: "staged" }, _meta: { citation: { result_hash: expect.any(String) } } });
  expect(JSON.stringify(r).length).toBeLessThan(100_000);
});

it("fails closed without a staging binding", async () => {
  const r = await formatLookupResponse({ data: "x".repeat(110_000) }, undefined, options);
  expect(r).toMatchObject({ isError: true, structuredContent: { success: false } });
});

it("bounds oversized metadata from staging", async () => {
  // SAFETY: malformed staging metadata deliberately exercises the envelope guard.
  vi.mocked(stageToDoAndRespond).mockResolvedValue({ dataAccessId: "x".repeat(110_000), tablesCreated: [], totalRows: 1, _staging: {} } as unknown as Awaited<ReturnType<typeof stageToDoAndRespond>>);
  expect(await formatLookupResponse({ data: "x".repeat(40_000) }, env, options)).toMatchObject({ isError: true });
});

it("returns an error for an error-only result and preserves bounded resolution reasons", async () => {
  const r = await formatLookupResponse({ results: [{ cohort: "finngen", status: "error", error: "No coordinate" }], warnings: ["Ambiguous alleles"] }, env, options);
  expect(r).toMatchObject({ isError: true, structuredContent: { error: { details: { warnings: ["Ambiguous alleles"] } } } });
});

it("keeps partial cohort successes and genuine not-found results distinguishable", async () => {
  const r = await formatLookupResponse({ results: [{ cohort: "finngen", status: "not_found" }, { cohort: "bbj", status: "error", error: "offline" }] }, env, options);
  expect(r.structuredContent).toHaveProperty("success", true);
});

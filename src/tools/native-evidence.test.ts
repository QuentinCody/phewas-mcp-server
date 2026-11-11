import { verifyCitationEnvelope } from "@bio-mcp/shared";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ RpcTarget: class {}, DurableObject: class { constructor(public ctx: unknown, public env: unknown) {} } }));

import { fixture, recover } from "./staging-fixture";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function invoke(f: ReturnType<typeof fixture>, name: string, args: unknown, failed = false) {
  const result = await f.tools[name].handler(args, {});
  expect(result.isError === true, JSON.stringify(result).slice(0, 500)).toBe(failed);
  const sc = result.structuredContent;
  const id = sc.staged ? sc.data_access_id : sc.data?.__staged ? sc.data.data_access_id : undefined;
  const staged = id ? await recover(f, id, "") : undefined;
  const proof = await verifyCitationEnvelope({ citation: sc._meta?.citation, structuredContent: sc, toolArguments: args,
    ...(staged ? { materialized: { value: staged } } : {}) });
  expect(proof.verification).toMatchObject({ query: "verified", result: "verified" });
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(30720);
  return { sc, id, data: sc.staged ? staged.structuredContent.data : sc.data?.__staged ? staged : sc.data };
}

it.each(["", "mcp_"])("verifies citations and bounded responses through every %s alias", async prefix => {
  const f = fixture();
  vi.stubGlobal("fetch", async () => Response.json({ results: [{ phenocode: "fixture", pval: 0.01 }] }));
  try {
    await invoke(f, `${prefix}phewas_search`, { query: "FinnGen phenotype" });
    await invoke(f, `${prefix}phewas_execute`, { code: "return {value:'001'};" });
    await invoke(f, `${prefix}phewas_execute`, { code: "" }, true);
    await invoke(f, `${prefix}phewas_query_data`, { data_access_id: "missing", sql: "SELECT * FROM missing" }, true);
    await invoke(f, `${prefix}phewas_get_schema`, { data_access_id: "missing" });
    await invoke(f, `${prefix}phewas_variant_lookup`, { variant: "10:112998590-C-T", cohorts: ["finngen"] });
    await invoke(f, `${prefix}phewas_variant_lookup`, { variant: "10:112998590-C-T", cohorts: ["invalid"] }, true);
  } finally { f.close(); }
});

it.each([
  { path: "/finngen/api/phenos", native: [{ phenocode: "0001", phenostring: "α😀".repeat(7000), gc_lambda: { "0.1": "0.00001" }, exclusions: [null, "A|B"] }], table: "data", key: "phenocode", context: "records" },
  { path: "/finngen/api/variant/10:112998590-C-T", native: { results: [{ phenocode: "0001", note: "α😀".repeat(7000), pval: 0, nested: { significant: false } }], variant: { ref: "C", alt: "T" }, regions: [{ start: 1 }] }, table: "associations", key: "phenocode", context: "evidence_context" },
  { path: "/ukb-topmed/api/variant/10:112998590-C-T", native: { phenos: [{ phenocode: "008.5", note: "α😀".repeat(7000), pval: 1e-10, codes: ["001", "002"] }], ref: "C", alt: "T" }, table: "associations", key: "phenocode", context: "evidence_context" },
  { path: "/genebass/api/phewas/ENSG00000130203", native: { phewas: [{ phenocode: "001", note: "α😀".repeat(7000), Pvalue: 0.002, coding: "0001", modifier: "" }], gene: { gene_id: "ENSG00000130203" } }, table: "gene_burden", key: "coding", context: "evidence_context" },
])("recovers native values and legacy SQL projections for $table at $path", async ({ path, native, table, key, context }) => {
  const f = fixture();
  vi.stubGlobal("fetch", async () => Response.json(native));
  try {
    const result = await invoke(f, "phewas_execute", { code: `return await api.get(${JSON.stringify(path)});` });
    expect(result.sc._meta.completeness.complete).toBe(false);
    const provider = path.endsWith("phenos") ? result.data.data : result.data;
    expect(provider).toMatchObject(native);
    const schema = await invoke(f, "mcp_phewas_get_schema", { data_access_id: result.id });
    expect(schema.data.schema.tables).toHaveProperty(table);
    expect(schema.data.schema.tables).toHaveProperty(context);
    const projected = await invoke(f, "phewas_query_data", { data_access_id: result.id, sql: `SELECT ${key},typeof(${key}) AS kind FROM ${table}` });
    expect(projected.data.rows[0].kind).toBe("text");
    const expectedRows = Array.isArray(native) ? native : "results" in native ? native.results : "phenos" in native ? native.phenos : native.phewas;
    const page = await invoke(f, "phewas_query_data", { data_access_id: result.id, sql: `SELECT native_json FROM ${table}` });
    expect(page.data.rows.map((row: { native_json: string }) => JSON.parse(row.native_json))).toEqual(expectedRows);
  } finally { f.close(); }
});

it("preserves the complete composed envelope after SQL recovery", async () => {
  const f = fixture();
  try {
    const result = await invoke(f, "mcp_phewas_execute", { code: 'return {notes:"α😀".repeat(12000),values:[null,0,"0001"]};' });
    expect(result.sc.staged).toBe(true);
    expect(result.data).toEqual({ notes: "α😀".repeat(12000), values: [null, 0, "0001"] });
  } finally { f.close(); }
});

it("keeps full native HTTP failure bodies through the real API proxy and SQL recovery", async () => {
  const f = fixture();
  const body = `<html>${"unavailable α".repeat(7000)}</html>`;
  vi.stubGlobal("fetch", async () => new Response(body, { status: 404, headers: { "content-type": "text/html" } }));
  try {
    const result = await invoke(f, "mcp_phewas_execute", { code: 'return await api.get("/finngen/api/pheno/MISSING",{release:"R13"});' }, true);
    expect(result.data).toMatchObject({ __api_error: true, status: 404 });
    const evidence = result.data.data.__staged ? await recover(f, result.data.data.data_access_id, "") : result.data.data;
    expect(evidence).toMatchObject({ data: body, meta: { finngen: { http_status: 404, body_read_complete: true, coverage_complete: false } } });
  } finally { f.close(); }
});

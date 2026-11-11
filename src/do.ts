import { RestStagingDO } from "@bio-mcp/shared/staging/rest-staging-do";
import { flattenObject, type SchemaHints } from "@bio-mcp/shared/staging/schema-inference";

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const row = (value: unknown) => ({
  ...(record(value) ? { ...flattenObject(value, 2), ...Object.fromEntries(Object.entries(value).map(([key, item]) =>
    [key, item !== null && typeof item === "object" ? JSON.stringify(item) : item])) } : { value }),
  native_json: JSON.stringify(value),
});
const unwrap = (value: unknown) => record(value) && Array.isArray(value.content) && record(value.structuredContent) && "data" in value.structuredContent
  ? value.structuredContent.data : value;

/** Keep existing association tables while retaining every native row and its context. */
export class PhewasDataDO extends RestStagingDO {
  protected getTabularData(value: unknown): unknown {
    const data = unwrap(value);
    if (Array.isArray(data)) return { associations: data.map(row) };
    if (!record(data)) return data;
    if (typeof data.sql === "string" && Array.isArray(data.rows)) return { query_rows: data.rows.map(row) };
    if (Array.isArray(data.data)) return {
      data: data.data.map(row),
      records: [{ native_json: JSON.stringify(Object.fromEntries(Object.entries(data).filter(([key]) => key !== "data"))) }],
    };
    const key = ["results", "phenos", "phewas"].find(name => Array.isArray(data[name]));
    if (key) return {
      [key === "phewas" ? "gene_burden" : "associations"]: (data[key] as unknown[]).map(row),
      evidence_context: [{ native_json: JSON.stringify(Object.fromEntries(Object.entries(data).filter(([name]) => name !== key))) }],
    };
    return { native_observations: [row(data)] };
  }

  protected getSchemaHints(value: unknown): SchemaHints {
    const tables = this.getTabularData(value);
    const columnTypes: Record<string, string> = { native_json: "TEXT" };
    if (record(tables)) for (const values of Object.values(tables)) {
      if (!Array.isArray(values)) continue;
      for (const item of values) if (record(item)) for (const [key, value] of Object.entries(item)) {
        // Preserve numeric-looking identifiers and lexical values without coercion.
        if (typeof value === "string") columnTypes[key] = "TEXT";
      }
    }
    return { columnTypes };
  }
}

import { buildPassthroughCitation } from "@bio-mcp/shared";
import { createCodeModeError, createCodeModeResponse } from "@bio-mcp/shared/codemode/response";
import { shouldStage, stageToDoAndRespond } from "@bio-mcp/shared/staging/utils";
import { PHEWAS_SOURCE } from "../lib/http";

export interface LookupEnv { PHEWAS_DATA_DO: DurableObjectNamespace }

function cohortFailures(data: Record<string, unknown>): string[] {
  if (!Array.isArray(data.results) || data.results.some(row => row.status === "ok" || row.status === "not_found")) return [];
  return data.results.filter(row => row.status === "error").slice(0, 5)
    .map(row => `${String(row.cohort).slice(0, 40)}: ${String(row.error).slice(0, 500)}`);
}

export async function formatLookupResponse(
  data: Record<string, unknown>, env: LookupEnv | undefined,
  options: { textSummary: string; query: Record<string, unknown>; extra: Record<string, unknown> },
): Promise<ReturnType<typeof createCodeModeResponse> | ReturnType<typeof createCodeModeError>> {
  const failures = cohortFailures(data);
  if (failures.length) return failedLookup(failures, data.warnings);
  const citation = await buildPassthroughCitation({ source: PHEWAS_SOURCE, server: "phewas", tool: "phewas_variant_lookup", query: options.query, result: data });
  let response = createCodeModeResponse(data, { textSummary: options.textSummary, meta: citation });
  if (shouldStage(new TextEncoder().encode(JSON.stringify(response.structuredContent)).byteLength)) {
    if (!env) return createCodeModeError("STAGING_UNAVAILABLE", "Large PheWAS result requires PHEWAS_DATA_DO.");
    const staged = await stageToDoAndRespond(data, env.PHEWAS_DATA_DO, "phewas", undefined, undefined, "phewas", options.extra);
    const stagedCitation = await buildPassthroughCitation({ source: PHEWAS_SOURCE, server: "phewas", tool: "phewas_variant_lookup", query: options.query, result: data, dataAccessId: staged.dataAccessId });
    response = createCodeModeResponse({ data_access_id: staged.dataAccessId, tables_created: staged.tablesCreated }, {
      textSummary: `${options.textSummary} Use phewas_query_data for the staged result.`,
      meta: { ...stagedCitation, staged: true, data_access_id: staged.dataAccessId, tables_created: staged.tablesCreated, total_rows: staged.totalRows, payload_hash: staged._staging.payload_hash, completeness: staged._staging.completeness },
    });
  }
  if (new TextEncoder().encode(JSON.stringify(response.structuredContent)).byteLength > 100_000) {
    return createCodeModeError("RESPONSE_TOO_LARGE", "PheWAS staging metadata exceeds the transport limit.");
  }
  return response;
}

function failedLookup(failures: string[], warnings: unknown) {
  const detail = Array.isArray(warnings) ? warnings.slice(0, 5).map(value => String(value).slice(0, 500)) : [];
  return createCodeModeError("UPSTREAM_ERROR", "No requested cohort lookup succeeded.", { failures, warnings: detail });
}

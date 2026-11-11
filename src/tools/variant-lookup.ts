/**
 * phewas_variant_lookup — hand-built cross-cohort PheWAS tool.
 *
 * JUSTIFICATION (per server build plan):
 *   This endpoint requires multi-step orchestration that Code Mode JS
 *   would struggle with — it must (a) accept rsID / GRCh37 / GRCh38 /
 *   canonical input, (b) resolve the variant against Ensembl for both
 *   builds, (c) select the cohort-appropriate build per COHORT_BUILD,
 *   (d) format the coord for each cohort, (e) fan out four concurrent
 *   HTTPS requests, (f) rank each cohort's associations by p-value, and
 *   (g) merge heterogeneous schemas into a unified row shape. Doing all
 *   that in a user-facing Code Mode script is fragile and token-heavy.
 *   Exposing a single dedicated tool is both safer and cheaper.
 */

import {
    createCodeModeError,
} from "@bio-mcp/shared/codemode/response";
import type { McpServer } from "@bio-mcp/shared/mcp";
import {
    COHORT_BUILD,
    type Cohort,
    formatForCohort,
    type ResolvedVariant,
    type VariantCoord,
} from "@bio-mcp/shared/variants/resolve";
import { z } from "zod";
import { extractAssociations, rankTopAssociations, type TopAssociation } from "../lib/associations";
import { type FinnGenRelease, finnGenReleaseMetadata, parseFinnGenRelease } from "../lib/finngen-releases";
import { type CohortKey, cohortBaseUrl, cohortFetch } from "../lib/http";
import { resolvePhewasInput } from "../lib/resolve-input";
import { phewasResponse } from "../lib/tool-result";
import { formatLookupResponse, type LookupEnv } from "./lookup-response";

const VARIANT_COHORTS: readonly Cohort[] = [
    "finngen",
    "ukb-topmed",
    "bbj",
    "tpmi",
] as const;

/** Default cohort set advertised to callers (genebass is gene-level; see note). */
const DEFAULT_COHORT_LABELS = [
    "finngen",
    "ukb-topmed",
    "bbj",
    "tpmi",
    "genebass",
] as const;

interface CohortResult {
    cohort: string;
    variant_format_used: string | null;
    assembly?: string;
    source?: Record<string, unknown>;
    status: "ok" | "not_found" | "skipped" | "error";
    top_associations: TopAssociation[];
    association_count_total?: number;
    variant_url?: string;
    error?: string;
}

const COHORT_ENDPOINT_PATHS: Record<Cohort, string> = {
    finngen: "/api/variant",
    "ukb-topmed": "/api/variant",
    bbj: "/api/variant",
    tpmi: "/api/variant",
};

const COHORT_PAGE_PATHS: Record<Cohort, string> = {
    finngen: "/variant",
    "ukb-topmed": "/variant",
    bbj: "/variant",
    tpmi: "/variant",
};

function pickCoordForCohort(
    resolved: ResolvedVariant,
    cohort: Cohort,
): VariantCoord | null {
    const build = COHORT_BUILD[cohort];
    return build === "GRCh37" ? resolved.grch37 : resolved.grch38;
}

async function fetchCohort(
    cohort: Cohort,
    resolved: ResolvedVariant,
    maxResults: number,
    release: FinnGenRelease,
): Promise<CohortResult> {
    const source = cohort === "finngen" ? finnGenReleaseMetadata(release) : { base_url: cohortBaseUrl(cohort) };
    const coord = pickCoordForCohort(resolved, cohort);
    if (!coord || !coord.canonical) {
        return {
            cohort, assembly: COHORT_BUILD[cohort], source,
            variant_format_used: null,
            status: "error",
            top_associations: [],
            error: `No ${COHORT_BUILD[cohort]} coordinate resolved for this variant.`,
        };
    }
    const formatted = formatForCohort(coord, cohort);
    const apiPath = `${COHORT_ENDPOINT_PATHS[cohort]}/${encodeURIComponent(formatted)}`;
    const pagePath = `${COHORT_PAGE_PATHS[cohort]}/${encodeURIComponent(formatted)}`;
    const variantUrl = `${cohortBaseUrl(cohort, release)}${pagePath}`;

    try {
        const response = await cohortFetch(cohort as CohortKey, apiPath, undefined, { finngenRelease: release });
        if (response.status === 404) {
            return {
                cohort, assembly: COHORT_BUILD[cohort], source,
                variant_format_used: formatted,
                status: "not_found",
                top_associations: [],
                association_count_total: 0,
                variant_url: variantUrl,
            };
        }
        if (!response.ok) {
            const body = await response.text().catch(() => "");
            return {
                cohort, assembly: COHORT_BUILD[cohort], source,
                variant_format_used: formatted,
                status: "error",
                top_associations: [],
                variant_url: variantUrl,
                error: `HTTP ${response.status}${body ? `: ${body.slice(0, 180)}` : ""}`,
            };
        }
        const contentType = response.headers.get("content-type") || "";
        if (!contentType.includes("json")) {
            return {
                cohort, assembly: COHORT_BUILD[cohort], source,
                variant_format_used: formatted,
                status: "error",
                top_associations: [],
                variant_url: variantUrl,
                error: `Non-JSON response (content-type: ${contentType || "unknown"}).`,
            };
        }
        const data = await response.json();
        const rows = extractAssociations(data);
        const top = rankTopAssociations(rows, maxResults);
        return {
            cohort, assembly: COHORT_BUILD[cohort], source,
            variant_format_used: formatted,
            status: "ok",
            top_associations: top,
            association_count_total: rows.length,
            variant_url: variantUrl,
        };
    } catch (err) {
        return {
            cohort, assembly: COHORT_BUILD[cohort], source,
            variant_format_used: formatted,
            status: "error",
            top_associations: [],
            variant_url: variantUrl,
            error: err instanceof Error ? err.message : String(err),
        };
    }
}

const variantLookupSchema = {
        title: "Cross-cohort PheWAS variant lookup",
        description:
            "Fan out a single variant across FinnGen, UKB-TOPMed, BioBank Japan, and TPMI PheWAS cohorts. " +
            "Accepts rsID or coordinates in input_build (default GRCh38). Select finngen_release R13 for DF13. " +
            "Each cohort's response is normalised to a uniform row shape with the top associations ranked by p-value. " +
            "Genebass is gene-level — list it in `cohorts` to get an explicit skipped row; otherwise call /genebass/api/phewas/{ensembl_gene_id} via phewas_execute.",
        inputSchema: {
            variant: z
                .string()
                .min(1)
                .describe(
                    "Variant identifier — rsID (rs7903146), or coordinates in input_build (e.g. GRCh38 10:112998590-C-T).",
                ),
            finngen_release: z.enum(["R12", "R13"]).optional().describe("FinnGen public release; R12 remains the default."),
            input_build: z.enum(["GRCh37", "GRCh38"]).optional().describe("Coordinate assembly; defaults to GRCh38, ignored for rsIDs. Never inferred by retrying another build."),
            cohorts: z
                .array(z.string())
                .max(5)
                .optional()
                .describe(
                    "Subset of cohorts to query. Defaults to all 5: finngen, ukb-topmed, bbj, tpmi, genebass. " +
                    "Genebass is gene-level and will be marked skipped for a variant input.",
                ),
            max_results: z
                .number()
                .int()
                .positive()
                .max(50)
                .optional()
                .describe("Max top associations per cohort (default 10, max 50)."),
        },
    } as const;

function lookupSummary(variantArg: string, resolved: ResolvedVariant, results: CohortResult[], genebassRequested: boolean): string {
            const successful = results.filter((r) => r.status === "ok").length;
            const notFound = results.filter((r) => r.status === "not_found").length;
            const failed = results.filter((r) => r.status === "error").length;

            return `PheWAS lookup for ${variantArg} ` +
                `(resolved rsid=${resolved.rsid ?? "n/a"}): ` +
                `${successful} ok, ${notFound} not_found, ${failed} error` +
                (genebassRequested ? " (genebass skipped — gene-level)" : "") +
                ".";
}

export function registerVariantLookup(server: McpServer, env?: LookupEnv): void {
    const handler = async (args: Record<string, unknown>, extra: Record<string, unknown>) => {
        try {
            const variantArg = String(args.variant ?? "").trim();
            if (!variantArg) {
                return createCodeModeError(
                    "MISSING_REQUIRED_PARAM",
                    "`variant` is required (rsID, chr-pos-ref-alt, or canonical string).",
                );
            }
            const requestedCohorts = Array.isArray(args.cohorts)
                ? (args.cohorts as unknown[]).map((c) => String(c).toLowerCase())
                : [...DEFAULT_COHORT_LABELS];

            const maxResults =
                typeof args.max_results === "number" && args.max_results > 0
                    ? Math.min(args.max_results, 50)
                    : 10;

            // Validate cohort names.
            const unknown = requestedCohorts.filter(
                (c) => !DEFAULT_COHORT_LABELS.includes(c as typeof DEFAULT_COHORT_LABELS[number]),
            );
            if (unknown.length > 0) {
                return createCodeModeError(
                    "INVALID_ARGUMENTS",
                    `Unknown cohort(s): ${unknown.join(", ")}. Allowed: ${DEFAULT_COHORT_LABELS.join(", ")}.`,
                );
            }

            const release = parseFinnGenRelease(args.finngen_release);
            const build = args.input_build === "GRCh37" ? "GRCh37" : "GRCh38";

            // Variant-keyed cohorts
            const variantCohortsRequested = requestedCohorts.filter((c) =>
                VARIANT_COHORTS.includes(c as Cohort),
            ) as Cohort[];

            const resolved = await resolvePhewasInput(variantArg, build, variantCohortsRequested.map(c => COHORT_BUILD[c]));
            const warnings = resolved.warnings;
            const genebassRequested = requestedCohorts.includes("genebass");

            const results = await Promise.all(
                variantCohortsRequested.map((c) => fetchCohort(c, resolved, maxResults, release)),
            );

            if (genebassRequested) {
                // Genebass is gene-level — a variant input cannot be directly mapped
                // to a burden lookup without a variant->gene mapping step. Document
                // the skip here rather than silently dropping it.
                results.push({
                    cohort: "genebass",
                    variant_format_used: null,
                    status: "skipped",
                    top_associations: [],
                    error:
                        "Genebass is gene-level (burden) PheWAS, not variant-keyed. " +
                        "Call GET /genebass/api/phewas/{ensembl_gene_id} via phewas_execute instead.",
                });
            }

            const textSummary = lookupSummary(variantArg, resolved, results, genebassRequested);

            return await formatLookupResponse(
                {
                    variant_input: variantArg,
                    resolved: {
                        rsid: resolved.rsid,
                        grch37: resolved.grch37,
                        grch38: resolved.grch38,
                    },
                    max_results_per_cohort: maxResults,
                    cohorts_requested: requestedCohorts,
                    results,
                    warnings,
                },
                env,
                { textSummary, query: args, extra },
            );
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return createCodeModeError("API_ERROR", `phewas_variant_lookup failed: ${msg}`);
        }
    };



    // Dual registration per monorepo convention (CLAUDE.md "Tool Dual Registration").
    const respond = (args: Record<string, unknown>, extra: Record<string, unknown>) =>
        phewasResponse(() => handler(args, extra), env ?? {}, "phewas_variant_lookup", extra, args);
    server.registerTool("phewas_variant_lookup", variantLookupSchema, respond);
    server.registerTool("mcp_phewas_variant_lookup", variantLookupSchema, respond);
}

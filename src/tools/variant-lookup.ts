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

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
    createCodeModeResponse,
    createCodeModeError,
} from "@bio-mcp/shared/codemode/response";
import {
    COHORT_BUILD,
    type Cohort,
    formatForCohort,
    parseVariantString,
    resolveRsid,
    resolveVariant,
    type ResolvedVariant,
    type VariantCoord,
} from "@bio-mcp/shared/variants/resolve";
import { cohortFetch, COHORT_BASE_URLS, type CohortKey } from "../lib/http";

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

interface TopAssociation {
    phenotype: string | null;
    p_value: number | null;
    beta: number | null;
    n_cases: number | null;
    n_controls: number | null;
}

interface CohortResult {
    cohort: string;
    variant_format_used: string | null;
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

function toNumber(v: unknown): number | null {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) {
        return Number(v);
    }
    return null;
}

function extractAssociations(data: unknown): Record<string, unknown>[] {
    if (!data) return [];
    if (Array.isArray(data)) return data as Record<string, unknown>[];
    if (typeof data === "object") {
        const obj = data as Record<string, unknown>;
        if (Array.isArray(obj.results)) return obj.results as Record<string, unknown>[];
        if (Array.isArray(obj.phenos)) return obj.phenos as Record<string, unknown>[];
    }
    return [];
}

function summariseAssociation(row: Record<string, unknown>): TopAssociation {
    const phenotype =
        (row.phenostring as string | undefined) ??
        (row.phenocode as string | undefined) ??
        (row.phenotype as string | undefined) ??
        (row.description as string | undefined) ??
        null;
    const pRaw = row.pval ?? row.p_value ?? row.pvalue ?? row.Pvalue ?? row.p;
    const betaRaw = row.beta ?? row.BETA ?? row.effect ?? row.or;
    const nCases = row.num_cases ?? row.n_cases ?? row.nCases;
    const nControls = row.num_controls ?? row.n_controls ?? row.nControls;
    return {
        phenotype: phenotype ? String(phenotype) : null,
        p_value: toNumber(pRaw),
        beta: toNumber(betaRaw),
        n_cases: toNumber(nCases),
        n_controls: toNumber(nControls),
    };
}

function rankTopAssociations(
    rows: Record<string, unknown>[],
    limit: number,
): TopAssociation[] {
    const enriched = rows.map(summariseAssociation);
    enriched.sort((a, b) => {
        const ap = a.p_value ?? Number.POSITIVE_INFINITY;
        const bp = b.p_value ?? Number.POSITIVE_INFINITY;
        return ap - bp;
    });
    return enriched.slice(0, limit);
}

function pickCoordForCohort(
    resolved: ResolvedVariant,
    cohort: Cohort,
): VariantCoord | null {
    const build = COHORT_BUILD[cohort];
    return build === "GRCh37" ? resolved.grch37 : resolved.grch38;
}

/** Heuristic: is the input an rsID? */
function isRsid(input: string): boolean {
    return /^rs\d+$/i.test(input.trim());
}

/** Heuristic: does the input look like chr:pos-ref-alt? */
function looksLikeCoord(input: string): boolean {
    try {
        parseVariantString(input);
        return true;
    } catch {
        return false;
    }
}

async function resolveInput(variant: string): Promise<ResolvedVariant> {
    const trimmed = variant.trim();
    if (!trimmed) throw new Error("`variant` is empty.");
    if (isRsid(trimmed)) return resolveRsid(trimmed);

    if (!looksLikeCoord(trimmed)) {
        throw new Error(
            "Unrecognised variant format. Supply an rsID (rs7903146), or chr:pos-ref-alt (e.g. 10:112998590-C-T).",
        );
    }

    // Caller may have given us either GRCh37 or GRCh38. Try GRCh38 first (most
    // cohorts); fall back to GRCh37 if the Ensembl overlap endpoint yields
    // nothing on GRCh38.
    try {
        return await resolveVariant("grch38", trimmed);
    } catch (err38) {
        try {
            return await resolveVariant("grch37", trimmed);
        } catch (err37) {
            const m38 = err38 instanceof Error ? err38.message : String(err38);
            const m37 = err37 instanceof Error ? err37.message : String(err37);
            throw new Error(
                `Could not resolve ${trimmed} on either GRCh38 (${m38}) or GRCh37 (${m37}).`,
            );
        }
    }
}

async function fetchCohort(
    cohort: Cohort,
    resolved: ResolvedVariant,
    maxResults: number,
): Promise<CohortResult> {
    const coord = pickCoordForCohort(resolved, cohort);
    if (!coord || !coord.canonical) {
        return {
            cohort,
            variant_format_used: null,
            status: "error",
            top_associations: [],
            error: `No ${COHORT_BUILD[cohort]} coordinate resolved for this variant.`,
        };
    }
    const formatted = formatForCohort(coord, cohort);
    const apiPath = `${COHORT_ENDPOINT_PATHS[cohort]}/${encodeURIComponent(formatted)}`;
    const pagePath = `${COHORT_PAGE_PATHS[cohort]}/${encodeURIComponent(formatted)}`;
    const variantUrl = `${COHORT_BASE_URLS[cohort as CohortKey]}${pagePath}`;

    try {
        const response = await cohortFetch(cohort as CohortKey, apiPath);
        if (response.status === 404) {
            return {
                cohort,
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
                cohort,
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
                cohort,
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
            cohort,
            variant_format_used: formatted,
            status: "ok",
            top_associations: top,
            association_count_total: rows.length,
            variant_url: variantUrl,
        };
    } catch (err) {
        return {
            cohort,
            variant_format_used: formatted,
            status: "error",
            top_associations: [],
            variant_url: variantUrl,
            error: err instanceof Error ? err.message : String(err),
        };
    }
}

export function registerVariantLookup(server: McpServer): void {
    const handler = async (args: Record<string, unknown>) => {
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

            const resolved = await resolveInput(variantArg);
            const warnings: string[] = [...resolved.warnings];

            // Variant-keyed cohorts
            const variantCohortsRequested = requestedCohorts.filter((c) =>
                VARIANT_COHORTS.includes(c as Cohort),
            ) as Cohort[];

            const genebassRequested = requestedCohorts.includes("genebass");

            const results = await Promise.all(
                variantCohortsRequested.map((c) => fetchCohort(c, resolved, maxResults)),
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

            const successful = results.filter((r) => r.status === "ok").length;
            const notFound = results.filter((r) => r.status === "not_found").length;
            const failed = results.filter((r) => r.status === "error").length;

            const textSummary =
                `PheWAS lookup for ${variantArg} ` +
                `(resolved rsid=${resolved.rsid ?? "n/a"}): ` +
                `${successful} ok, ${notFound} not_found, ${failed} error` +
                (genebassRequested ? " (genebass skipped — gene-level)" : "") +
                ".";

            return createCodeModeResponse(
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
                { textSummary, meta: { fetched_at: new Date().toISOString() } },
            );
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return createCodeModeError("API_ERROR", `phewas_variant_lookup failed: ${msg}`);
        }
    };

    const schema = {
        title: "Cross-cohort PheWAS variant lookup",
        description:
            "Fan out a single variant across FinnGen, UKB-TOPMed, BioBank Japan, and TPMI PheWAS cohorts. " +
            "Accepts rsID, GRCh37 `chr:pos-ref-alt`, or GRCh38 `chr:pos-ref-alt`. " +
            "Each cohort's response is normalised to a uniform row shape with the top associations ranked by p-value. " +
            "Genebass is gene-level — list it in `cohorts` to get an explicit skipped row; otherwise call /genebass/api/phewas/{ensembl_gene_id} via phewas_execute.",
        inputSchema: {
            variant: z
                .string()
                .min(1)
                .describe(
                    "Variant identifier — rsID (rs7903146), chr-pos-ref-alt in either build (10-112998590-C-T, 10:114758349:C:T), or canonical string.",
                ),
            cohorts: z
                .array(z.string())
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

    // Dual registration per monorepo convention (CLAUDE.md "Tool Dual Registration").
    server.registerTool("phewas_variant_lookup", schema, handler);
    server.registerTool("mcp_phewas_variant_lookup", schema, handler);
}

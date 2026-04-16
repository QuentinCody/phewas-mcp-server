import { restFetch, type RestFetchOptions } from "@bio-mcp/shared/http/rest-fetch";

/**
 * Per-cohort base URLs. Sourced from the OpenAI life-science plugin scripts:
 *   - FinnGen:    scripts/finngen_phewas.py        -> https://r12.finngen.fi
 *   - UKB-TOPMed: scripts/ukb_topmed_phewas.py     -> https://pheweb.org/UKB-TOPMed
 *   - BBJ:        scripts/biobankjapan_phewas.py   -> https://pheweb.jp
 *   - TPMI:       scripts/tpmi_phewas.py           -> https://pheweb.ibms.sinica.edu.tw
 *   - Genebass:   scripts/genebass_gene_burden.py  -> https://main.genebass.org (API at /api)
 */
export const COHORT_BASE_URLS = {
    finngen: "https://r12.finngen.fi",
    "ukb-topmed": "https://pheweb.org/UKB-TOPMed",
    bbj: "https://pheweb.jp",
    tpmi: "https://pheweb.ibms.sinica.edu.tw",
    genebass: "https://main.genebass.org",
} as const;

export type CohortKey = keyof typeof COHORT_BASE_URLS;

export interface PhewasFetchOptions extends Omit<RestFetchOptions, "retryOn"> {
    baseUrl?: string;
}

/** Fetch helper specialised per cohort with sensible retry/timeout defaults. */
export async function cohortFetch(
    cohort: CohortKey,
    path: string,
    params?: Record<string, unknown>,
    opts?: PhewasFetchOptions,
): Promise<Response> {
    const baseUrl = opts?.baseUrl ?? COHORT_BASE_URLS[cohort];
    const headers: Record<string, string> = {
        Accept: "application/json",
        ...(opts?.headers ?? {}),
    };

    return restFetch(baseUrl, path, params, {
        ...opts,
        headers,
        retryOn: [429, 500, 502, 503],
        retries: opts?.retries ?? 2,
        timeout: opts?.timeout ?? 30_000,
        userAgent: "phewas-mcp-server/1.0 (bio-mcp)",
    });
}

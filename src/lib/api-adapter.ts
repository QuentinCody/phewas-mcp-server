/**
 * PheWAS Hub API adapter.
 *
 * Routes Code Mode `api.get()` / `api.post()` calls to one of five
 * cohort-specific base URLs based on the first path segment:
 *
 *   /finngen/...     -> release-selected R12/R13 (default R12)
 *   /ukb-topmed/...  -> https://pheweb.org/UKB-TOPMed
 *   /bbj/...         -> https://pheweb.jp
 *   /tpmi/...        -> https://pheweb.ibms.sinica.edu.tw
 *   /genebass/...    -> https://main.genebass.org
 *
 * The catalog exposes these virtual cohort-prefixed paths; the adapter
 * strips the prefix and forwards the remainder to the upstream PheWeb
 * instance. Path params (e.g. `{variant}`) that the isolate already
 * substituted are left in place. If the isolate did not substitute a
 * `{variant}` placeholder, we attempt in-adapter resolution via the
 * shared `@bio-mcp/shared/variants/resolve` helpers so that rsIDs and
 * cross-build coordinates are normalised to the build each cohort
 * expects (BBJ = GRCh37, the rest = GRCh38).
 */

import type { ApiFetchFn } from "@bio-mcp/shared/codemode/catalog";
import {
    COHORT_BUILD,
    formatForCohort,
} from "@bio-mcp/shared/variants/resolve";
import { extractAssociations } from "./associations";
import { fetchFinnGenPhenotype, finnGenPhenotypeRoute, validateFinnGenPhenotypePath } from "./finngen-phenotypes";
import { annotateFinnGen, DEFAULT_FINNGEN_RELEASE, FINNGEN_RELEASES, finnGenReleaseMetadata, parseFinnGenRelease } from "./finngen-releases";
import { type CohortKey, cohortFetch } from "./http";
import { createOpenGwasFetch } from "./opengwas";
import { resolvePhewasInput } from "./resolve-input";

const COHORTS: readonly CohortKey[] = [
    "finngen",
    "ukb-topmed",
    "bbj",
    "tpmi",
    "genebass",
] as const;

function detectCohort(path: string): { cohort: CohortKey; rest: string } {
    const trimmed = path.replace(/^\/+/, "");
    for (const cohort of COHORTS) {
        if (trimmed === cohort) {
            return { cohort, rest: "/" };
        }
        if (trimmed.startsWith(`${cohort}/`)) {
            return { cohort, rest: `/${trimmed.slice(cohort.length + 1)}` };
        }
    }
    throw new Error(
        `Unknown cohort prefix in path '${path}'. Expected one of: ${COHORTS.join(", ")}.`,
    );
}

/**
 * If a caller passes an unresolved `{variant}` placeholder or a raw rsID
 * where a cohort-formatted coordinate is required, normalise it here so
 * the cohort API receives the build-appropriate `chr:pos-ref-alt` string.
 *
 * Only runs for the four single-variant cohorts (finngen, ukb-topmed, bbj,
 * tpmi). Genebass is gene-level and is passed through untouched.
 */
async function resolveVariantSegment(
    cohort: CohortKey,
    segment: string,
): Promise<string> {
    if (cohort === "genebass") return segment;

    const decoded = (() => {
        try {
            return decodeURIComponent(segment);
        } catch {
            return segment;
        }
    })();

    const build = COHORT_BUILD[cohort];
    const match = decoded.match(/^(grch37|grch38|hg19|hg38):(.+)$/i);
    const declared = match ? (/^(grch37|hg19)$/i.test(match[1]) ? "GRCh37" : "GRCh38") : build;
    const resolved = await resolvePhewasInput(match ? match[2] : decoded, declared, [build]);
    const coord = build === "GRCh37" ? resolved.grch37 : resolved.grch38;
    if (!coord?.canonical) throw new Error(`Cannot resolve ${decoded} for ${cohort}: ${resolved.warnings.join("; ")}`);
    return formatForCohort(coord, cohort);
}

/**
 * Replace the trailing variant segment after `/api/variant/` with a
 * cohort-normalised coordinate if one was supplied.
 */
async function maybeRewriteVariantPath(
    cohort: CohortKey,
    restPath: string,
): Promise<string> {
    const match = restPath.match(/^(.*\/api\/variant\/)(.+?)(\/.*)?$/);
    if (!match) return restPath;
    const [, prefix, segment, suffix = ""] = match;
    // Never try to resolve a literal placeholder that slipped through.
    if (segment === "{variant}" || segment === ":variant") return restPath;
    const resolved = await resolveVariantSegment(cohort, segment);
    return `${prefix}${encodeURIComponent(resolved)}${suffix}`;
}

function createCohortApiFetch(): ApiFetchFn {
    return async (request) => {
        if (request.method !== "GET") throw new Error("PheWAS supports GET reads only.");
        const { cohort, rest } = detectCohort(request.path);
        const { release, ...params } = request.params ?? {};
        if (release !== undefined && cohort !== "finngen") throw new Error("The release parameter is only supported for FinnGen.");
        const selectedRelease = parseFinnGenRelease(release);
        if (cohort === "finngen" && rest === "/releases") {
            return { status: 200, data: { default_release: DEFAULT_FINNGEN_RELEASE, releases: Object.values(FINNGEN_RELEASES), documentation: "https://www.finngen.fi/en/access_results" } };
        }
        if (cohort === "finngen" && finnGenPhenotypeRoute(rest)) validateFinnGenPhenotypePath(rest, params);
        const rewritten = await maybeRewriteVariantPath(cohort, rest);

        if (cohort === "finngen" && finnGenPhenotypeRoute(rewritten)) {
            return fetchFinnGenPhenotype(rewritten, selectedRelease, params);
        }

        const response = await cohortFetch(cohort, rewritten, params, { finngenRelease: selectedRelease });

        if (!response.ok) {
            let errorBody: string;
            try {
                errorBody = await response.text();
            } catch {
                errorBody = response.statusText;
            }
            const err = new Error(
                `HTTP ${response.status}: ${errorBody.slice(0, 200)}`,
            ) as Error & { status: number; data: unknown };
            err.status = response.status;
            err.data = errorBody;
            throw err;
        }

        const contentType = response.headers.get("content-type") || "";
        if (!contentType.includes("json")) {
            const text = await response.text();
            if (rest.startsWith("/api/")) throw new Error(`Expected JSON from ${cohort}; received ${contentType || "unknown content type"}.`);
            return { status: response.status, data: cohort === "finngen" ? { html: text, meta: { finngen: finnGenReleaseMetadata(selectedRelease) } } : text };
        }

        const data = await response.json();
        if (cohort === "finngen" && rest.startsWith("/api/variant/")) extractAssociations(data);
        return { status: response.status, data: cohort === "finngen" ? annotateFinnGen(data, selectedRelease) : data };
    };
}

export function createPhewasApiFetch(openGwasJwt?: string): ApiFetchFn {
    const openGwas = createOpenGwasFetch(openGwasJwt);
    const cohort = createCohortApiFetch();
    return request => request.path.startsWith("/opengwas/") ? openGwas(request) : cohort(request);
}

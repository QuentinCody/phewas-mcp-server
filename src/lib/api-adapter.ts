/**
 * PheWAS Hub API adapter.
 *
 * Routes Code Mode `api.get()` / `api.post()` calls to one of five
 * cohort-specific base URLs based on the first path segment:
 *
 *   /finngen/...     -> https://r12.finngen.fi
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
    type Cohort,
    formatForCohort,
    parseVariantString,
    resolveRsid,
    liftover,
} from "@bio-mcp/shared/variants/resolve";
import { cohortFetch, type CohortKey } from "./http";

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

    // rsID path — resolve via Ensembl and format for the cohort's build.
    if (/^rs\d+$/i.test(decoded)) {
        const resolved = await resolveRsid(decoded);
        const build = COHORT_BUILD[cohort as Cohort];
        const coord = build === "GRCh37" ? resolved.grch37 : resolved.grch38;
        if (!coord || !coord.canonical) {
            throw new Error(
                `Could not resolve ${decoded} to ${build} for cohort '${cohort}'.`,
            );
        }
        return formatForCohort(coord, cohort as Cohort);
    }

    // Canonical chr:pos-ref-alt form — if it parses, lift over as needed.
    // The cohort catalog paths assume the caller already supplied a coord
    // in *some* build; if the separator format hints an explicit build
    // prefix (e.g. `grch37:...`) we peel that off.
    const buildMatch = decoded.match(/^(grch37|grch38|hg19|hg38):(.+)$/i);
    const raw = buildMatch ? buildMatch[2] : decoded;
    let parsed: ReturnType<typeof parseVariantString>;
    try {
        parsed = parseVariantString(raw);
    } catch {
        // Not a recognisable variant form — pass through untouched.
        return segment;
    }

    const cohortBuild = COHORT_BUILD[cohort as Cohort];
    const declaredBuild = buildMatch
        ? buildMatch[1].toLowerCase() === "grch37" || buildMatch[1].toLowerCase() === "hg19"
            ? "GRCh37"
            : "GRCh38"
        : cohortBuild;

    if (declaredBuild === cohortBuild) {
        return formatForCohort(
            { chr: parsed.chr, pos: parsed.pos, ref: parsed.ref, alt: parsed.alt },
            cohort as Cohort,
        );
    }

    const lifted = await liftover(parsed, declaredBuild, cohortBuild);
    return formatForCohort(lifted, cohort as Cohort);
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

export function createPhewasApiFetch(): ApiFetchFn {
    return async (request) => {
        const { cohort, rest } = detectCohort(request.path);
        const rewritten = await maybeRewriteVariantPath(cohort, rest);

        const response = await cohortFetch(cohort, rewritten, request.params);

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
            return { status: response.status, data: text };
        }

        const data = await response.json();
        return { status: response.status, data };
    };
}

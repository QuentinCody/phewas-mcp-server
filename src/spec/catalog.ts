/**
 * PheWAS Hub catalog — five cohorts behind one MCP endpoint.
 *
 * Each cohort-specific path is namespaced with a cohort prefix
 * (/finngen, /ukb-topmed, /bbj, /tpmi, /genebass). The adapter in
 * src/lib/api-adapter.ts strips the prefix and routes the remainder
 * to the correct upstream base URL.
 *
 * Variant-cohort coordinate builds:
 *   - FinnGen, UKB-TOPMed, TPMI -> GRCh38  (chr:pos-ref-alt)
 *   - BioBank Japan (BBJ)       -> GRCh37
 *   - Genebass is gene-level (Ensembl gene IDs), not variant-keyed.
 */

import type { ApiCatalog } from "@bio-mcp/shared/codemode/catalog";

export const phewasCatalog: ApiCatalog = {
    name: "PheWAS Hub (FinnGen + UKB-TOPMed + BBJ + TPMI + Genebass)",
    baseUrl: "https://phewas-mcp-server.workers.dev",
    version: "1.0",
    auth: "none",
    endpointCount: 13,
    notes:
        "- Multi-cohort PheWAS server. Every path is namespaced by cohort prefix.\n" +
        "- FinnGen / UKB-TOPMed / TPMI expect GRCh38 chr:pos-ref-alt variants.\n" +
        "- BioBank Japan expects GRCh37 chr:pos-ref-alt variants.\n" +
        "- Genebass takes Ensembl gene IDs (ENSG...) and a burden set.\n" +
        "- If you pass an rsID in a {variant} slot the adapter auto-resolves it\n" +
        "  via Ensembl and formats it for the cohort's build before calling out.\n" +
        "- For cross-cohort lookups use the hand-built mcp_phewas_variant_lookup tool.\n" +
        "- Canonical query shape: api.get('/finngen/api/variant/10:112998590-C-T')\n" +
        "- Genebass phewas endpoint returns { gene, phewas: [...] } with Pvalue per phenocode.",
    endpoints: [
        // ---------------------------------------------------------------
        // FinnGen (r12) — https://r12.finngen.fi
        // ---------------------------------------------------------------
        {
            method: "GET",
            path: "/finngen/api/variant/{variant}",
            summary: "FinnGen r12 PheWAS associations for a GRCh38 variant (chr:pos-ref-alt or rsID).",
            category: "finngen",
            pathParams: [
                {
                    name: "variant",
                    type: "string",
                    required: true,
                    description: "GRCh38 chr:pos-ref-alt (e.g. 10:112998590-C-T) or rsID (auto-resolved).",
                },
            ],
        },
        {
            method: "GET",
            path: "/finngen/variant/{variant}",
            summary: "FinnGen human-facing variant page (HTML). Useful for producing `variant_url`.",
            category: "finngen",
            pathParams: [
                { name: "variant", type: "string", required: true, description: "GRCh38 chr:pos-ref-alt." },
            ],
        },
        // NOTE: /finngen/api/top_hits was removed 2026-04-17 — upstream returns
        // HTTP 404. FinnGen hosts a summary PheWeb page but no top-hits JSON
        // endpoint. Use /finngen/api/variant/{variant} for targeted lookups.
        // ---------------------------------------------------------------
        // UKB-TOPMed — https://pheweb.org/UKB-TOPMed
        // ---------------------------------------------------------------
        {
            method: "GET",
            path: "/ukb-topmed/api/variant/{variant}",
            summary: "UKB-TOPMed PheWAS associations for a GRCh38 variant (chr:pos-ref-alt or rsID).",
            category: "ukb-topmed",
            pathParams: [
                {
                    name: "variant",
                    type: "string",
                    required: true,
                    description: "GRCh38 chr:pos-ref-alt (e.g. 10:112998590-C-T) or rsID (auto-resolved).",
                },
            ],
        },
        {
            method: "GET",
            path: "/ukb-topmed/variant/{variant}",
            summary: "UKB-TOPMed variant detail page (HTML). Useful for producing `variant_url`.",
            category: "ukb-topmed",
            pathParams: [
                { name: "variant", type: "string", required: true, description: "GRCh38 chr:pos-ref-alt." },
            ],
        },
        // NOTE: /ukb-topmed/api/top_hits was removed 2026-04-17 — upstream
        // returns HTTP 404 (same pattern as FinnGen; PheWeb frontends host
        // top-hits as HTML tables, not a JSON endpoint).
        // ---------------------------------------------------------------
        // BioBank Japan (BBJ) — https://pheweb.jp
        // ---------------------------------------------------------------
        {
            method: "GET",
            path: "/bbj/api/variant/{variant}",
            summary: "BioBank Japan PheWAS associations for a GRCh37 variant (chr:pos-ref-alt or rsID).",
            category: "bbj",
            pathParams: [
                {
                    name: "variant",
                    type: "string",
                    required: true,
                    description: "GRCh37 chr:pos-ref-alt (e.g. 10:114758349-C-T) or rsID (auto-resolved).",
                },
            ],
        },
        {
            method: "GET",
            path: "/bbj/variant/{variant}",
            summary: "BBJ variant detail page (HTML). Useful for producing `variant_url`.",
            category: "bbj",
            pathParams: [
                { name: "variant", type: "string", required: true, description: "GRCh37 chr:pos-ref-alt." },
            ],
        },
        // ---------------------------------------------------------------
        // TPMI — https://pheweb.ibms.sinica.edu.tw
        // (Plan listed pheweb.tpmi.org.tw; the actual PheWeb-backed API
        // lives at pheweb.ibms.sinica.edu.tw per tpmi_phewas.py.)
        // ---------------------------------------------------------------
        {
            method: "GET",
            path: "/tpmi/api/variant/{variant}",
            summary: "TPMI (Taiwan Precision Medicine Initiative) PheWAS associations for a GRCh38 variant.",
            category: "tpmi",
            pathParams: [
                {
                    name: "variant",
                    type: "string",
                    required: true,
                    description: "GRCh38 chr:pos-ref-alt or rsID (auto-resolved).",
                },
            ],
        },
        {
            method: "GET",
            path: "/tpmi/variant/{variant}",
            summary: "TPMI variant detail page (HTML).",
            category: "tpmi",
            pathParams: [
                { name: "variant", type: "string", required: true, description: "GRCh38 chr:pos-ref-alt." },
            ],
        },
        // ---------------------------------------------------------------
        // Genebass (gene-level burden) — https://main.genebass.org/api
        // ---------------------------------------------------------------
        {
            method: "GET",
            path: "/genebass/api/phewas/{ensembl_gene_id}",
            summary:
                "Genebass gene burden PheWAS across ~4k phenotypes for a single Ensembl gene ID. " +
                "Use burdenSet query param.",
            category: "genebass",
            pathParams: [
                {
                    name: "ensembl_gene_id",
                    type: "string",
                    required: true,
                    description: "Ensembl gene ID (e.g. ENSG00000173531).",
                },
            ],
            queryParams: [
                {
                    name: "burdenSet",
                    type: "string",
                    required: false,
                    description: "Burden set: pLoF, missense|LC, or synonymous. Default: pLoF.",
                    enum: ["pLoF", "missense|LC", "synonymous"],
                },
            ],
        },
        {
            method: "GET",
            path: "/genebass/api/phenotypes",
            summary:
                "Genebass phenotype dictionary — lists all phenotypes tested, with analysis_id and description.",
            category: "genebass",
        },
    ],
};

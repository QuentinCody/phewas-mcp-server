import { RestStagingDO } from "@bio-mcp/shared/staging/rest-staging-do";
import type { SchemaHints } from "@bio-mcp/shared/staging/schema-inference";

/**
 * Staging Durable Object for PheWAS responses (FinnGen, UKB-TOPMed, BBJ,
 * TPMI, Genebass). All five cohorts return roughly similar shapes, so we
 * apply hints for the most common array payloads.
 */
export class PhewasDataDO extends RestStagingDO {
    protected getSchemaHints(data: unknown): SchemaHints | undefined {
        if (!data || typeof data !== "object") return undefined;

        const obj = data as Record<string, unknown>;

        // FinnGen top-level shape: { results: [...], variant, regions }
        if (Array.isArray(obj.results) && (obj.results as unknown[]).length > 0) {
            return {
                tableName: "associations",
                indexes: ["phenostring", "phenocode", "pval", "beta"],
            };
        }

        // UKB-TOPMed / TPMI style: { phenos: [...], chrom, pos, ref, alt }
        if (Array.isArray(obj.phenos) && (obj.phenos as unknown[]).length > 0) {
            return {
                tableName: "associations",
                indexes: ["phenostring", "phenocode", "pval"],
            };
        }

        // Genebass: { gene, phewas: [...] }
        if (Array.isArray(obj.phewas) && (obj.phewas as unknown[]).length > 0) {
            return {
                tableName: "gene_burden",
                indexes: ["phenocode", "trait_type", "Pvalue"],
            };
        }

        if (Array.isArray(data)) {
            const sample = data[0];
            if (sample && typeof sample === "object") {
                const s = sample as Record<string, unknown>;
                if ("phenocode" in s || "phenostring" in s) {
                    return {
                        tableName: "associations",
                        indexes: ["phenocode", "phenostring"],
                    };
                }
            }
        }

        return undefined;
    }
}

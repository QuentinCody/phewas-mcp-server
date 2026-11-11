import type { Completeness } from "@bio-mcp/shared";

export function phewasCompleteness(): Completeness {
  return {
    complete: false,
    truncation: {
      reason: "unknown",
      detail: "One selected cohort, release or bounded association summary. A complete response body does not establish exhaustive phenotype coverage or equivalent traits across cohorts.",
      remedy: "Retain native phenotype definitions, build, alleles, release host and query scope. Inspect cohort errors and native rows before comparing associations; do not infer absence or causality.",
    },
  };
}

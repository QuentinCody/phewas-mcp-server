export interface TopAssociation {
  phenotype: string | null;
  phenotype_id: string | null;
  p_value: number | null;
  beta: number | null;
  odds_ratio: number | null;
  n_cases: number | null;
  n_controls: number | null;
}

function toNumber(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function extractAssociations(data: unknown): Record<string, unknown>[] {
  const parsed = typeof data === "object" && data !== null ? data : {};
  const rows = Array.isArray(parsed) ? parsed : "results" in parsed ? parsed.results : "phenos" in parsed ? parsed.phenos : undefined;
  if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== "object" || Array.isArray(row))) {
    throw new Error("Unrecognized PheWAS association response; expected results/phenos rows.");
  }
  return rows;
}

function summariseAssociation(row: Record<string, unknown>): TopAssociation {
  const phenotype = row.phenostring ?? row.phenocode ?? row.phenotype ?? row.description;
  return {
    phenotype: phenotype == null ? null : String(phenotype),
    phenotype_id: row.phenocode == null ? null : String(row.phenocode),
    p_value: toNumber(row.pval ?? row.p_value ?? row.pvalue ?? row.Pvalue ?? row.p),
    beta: toNumber(row.beta ?? row.BETA ?? row.effect),
    odds_ratio: toNumber(row.or ?? row.odds_ratio),
    n_cases: toNumber(row.n_case ?? row.num_cases ?? row.n_cases ?? row.nCases),
    n_controls: toNumber(row.n_control ?? row.num_controls ?? row.n_controls ?? row.nControls),
  };
}

export function rankTopAssociations(rows: Record<string, unknown>[], limit: number): TopAssociation[] {
  return rows.map(summariseAssociation)
    .sort((a, b) => (a.p_value ?? Number.POSITIVE_INFINITY) - (b.p_value ?? Number.POSITIVE_INFINITY))
    .slice(0, limit);
}

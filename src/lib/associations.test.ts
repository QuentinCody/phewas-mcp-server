import { expect, it } from "vitest";
import { extractAssociations, rankTopAssociations } from "./associations";

it("preserves FinnGen DF13 case/control counts and phenotype identifiers", () => {
  // Observed R13 response for rs7903146, 2026-09-27; not derived from normalization code.
  const rows = extractAssociations({ results: [{ phenocode: "AB1_CHLAMYDIA_OTHER", phenostring: "Other sexually transmitted chlamydial diseases", beta: -0.0823995, n_case: 2821, n_control: 484932, pval: 0.01457874031090632 }] });
  expect(rankTopAssociations(rows, 1)[0]).toMatchObject({ phenotype_id: "AB1_CHLAMYDIA_OTHER", beta: -0.0823995, n_cases: 2821, n_controls: 484932, p_value: 0.01457874031090632 });
});

it("keeps odds ratios distinct from beta and ranks missing/nonfinite p-values last", () => {
  const result = rankTopAssociations([{ pval: "Infinity", beta: true }, { or: 2.4, pval: "0.001", n_cases: "50", n_controls: "200" }, { pval: 0, beta: -0.3 }, { pval: "", n_cases: [] }], 4);
  expect(result[0]).toMatchObject({ p_value: 0, beta: -0.3 });
  expect(result[1]).toMatchObject({ beta: null, odds_ratio: 2.4, n_cases: 50, n_controls: 200 });
  expect(result[2]).toMatchObject({ p_value: null, beta: null, phenotype: null });
  expect(result[3]).toMatchObject({ p_value: null, n_cases: null });
});

it.each([null, {}, { results: "error" }, { results: [null] }])("rejects malformed data %j instead of reporting zero associations", data => {
  expect(() => extractAssociations(data)).toThrow("Unrecognized");
});

it("accepts empty results and alternate cohort envelopes", () => {
  expect(extractAssociations([])).toEqual([]);
  expect(extractAssociations({ phenos: [{ Pvalue: 0.01 }] })).toEqual([{ Pvalue: 0.01 }]);
  expect(rankTopAssociations([{ phenocode: "A", Pvalue: 0.01 }], 1)[0]).toMatchObject({ phenotype: "A", phenotype_id: "A" });
});

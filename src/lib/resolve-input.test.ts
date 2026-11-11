import { lookupRsid, resolveVariant } from "@bio-mcp/shared/variants/resolve";
import { beforeEach, expect, it, vi } from "vitest";
import { resolvePhewasInput } from "./resolve-input";

vi.mock("@bio-mcp/shared/variants/resolve", async original => ({
  ...await original<typeof import("@bio-mcp/shared/variants/resolve")>(), lookupRsid: vi.fn(), resolveVariant: vi.fn(),
}));
beforeEach(() => vi.resetAllMocks());

it("uses explicit coordinates without an unnecessary Ensembl dependency", async () => {
  const result = await resolvePhewasInput("10:112998590-C-T", "GRCh38", ["GRCh38"]);
  expect(result.grch38).toMatchObject({ ref: "C", alt: "T", canonical: "10:112998590-C-T" });
  expect(resolveVariant).not.toHaveBeenCalled();
});

it("retains the input build when cross-build lookup fails", async () => {
  vi.mocked(resolveVariant).mockRejectedValue(new Error("Ensembl HTTP 500"));
  const result = await resolvePhewasInput("10:114758349-C-T", "GRCh37", ["GRCh37", "GRCh38"]);
  expect(result.grch37).toHaveProperty("alt", "T");
  expect(result.grch38).toBeNull();
  expect(result.warnings.join()).toContain("Input-build coordinates retained");
});

it("rejects ambiguous rsID alleles rather than selecting the first", async () => {
  vi.mocked(lookupRsid).mockResolvedValue({ chr: "10", pos: 112998590, ref: "C", alts: ["G", "T"] });
  const result = await resolvePhewasInput("rs7903146", "GRCh38", ["GRCh38"]);
  expect(result.grch38).toBeNull();
  expect(result.warnings.join()).toContain("ambiguous");
});

it("accepts unambiguous per-build rsID mappings", async () => {
  vi.mocked(lookupRsid).mockResolvedValue({ chr: "10", pos: 112998590, ref: "C", alts: ["T"] });
  const result = await resolvePhewasInput("rs7903146", "GRCh38", ["GRCh38", "GRCh38"]);
  expect(result.grch38).toHaveProperty("canonical", "10:112998590-C-T");
  expect(lookupRsid).toHaveBeenCalledOnce();
});

it("rejects a cross-build allele substitution", async () => {
  vi.mocked(resolveVariant).mockResolvedValue({ input: { type: "grch38", value: "10:112998590-C-T" }, rsid: "rs7903146", grch38: null, grch37: { chr: "10", pos: 114758349, ref: "C", alt: "G" }, warnings: [] });
  const result = await resolvePhewasInput("10:112998590-C-T", "GRCh38", ["GRCh37"]);
  expect(result.grch37).toBeNull();
  expect(result.grch38).toHaveProperty("alt", "T");
});
it("retains matching cross-build coordinates", async () => {
  vi.mocked(resolveVariant).mockResolvedValue({ input: { type: "grch38", value: "10:112998590-C-T" }, rsid: "rs7903146", grch38: null, grch37: { chr: "10", pos: 114758349, ref: "C", alt: "T" }, warnings: [] });
  expect((await resolvePhewasInput("10:112998590-C-T", "GRCh38", ["GRCh37"])).grch37).toHaveProperty("alt", "T");
});

it("retains a verified GRCh37-to-GRCh38 mapping", async () => {
  vi.mocked(resolveVariant).mockResolvedValue({ input: { type: "grch37", value: "10:114758349-C-T" }, rsid: "rs7903146", grch37: null, grch38: { chr: "10", pos: 112998590, ref: "C", alt: "T" }, warnings: [] });
  expect((await resolvePhewasInput("10:114758349-C-T", "GRCh37", ["GRCh38"])).grch38).toHaveProperty("pos", 112998590);
});

it("resolves an unambiguous GRCh37 rsID and reports missing target records", async () => {
  vi.mocked(lookupRsid).mockResolvedValueOnce({ chr: "10", pos: 114758349, ref: "C", alts: ["T"] }).mockResolvedValueOnce(null);
  const result = await resolvePhewasInput("rs7903146", "GRCh37", ["GRCh37", "GRCh38"]);
  expect(result.grch37).toHaveProperty("pos", 114758349);
  expect(result.grch38).toBeNull();
  expect(result.warnings).toHaveLength(1);
});

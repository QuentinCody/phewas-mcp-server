import { expect, it } from "vitest";
import { annotateFinnGen, FINNGEN_RELEASES, finnGenReleaseMetadata, parseFinnGenRelease } from "./finngen-releases";

// Release dates/browser mapping: https://www.finngen.fi/en/access_results (2026-09-27).
it("retains the existing R12 default and explicitly supports the public DF13 browser", () => {
  expect(parseFinnGenRelease(undefined)).toBe("R12");
  expect(FINNGEN_RELEASES[parseFinnGenRelease("R13")]).toMatchObject({ data_freeze: "DF13", base_url: "https://r13.finngen.fi", public_release_date: "2026-06-02" });
  expect(finnGenReleaseMetadata(parseFinnGenRelease("R12"))).toMatchObject({ assembly: "GRCh38", provider: "FinnGen", effect_allele: "reference-genome alternate allele" });
});

it.each(["R14", "latest", "r13", "https://example.com", null, 13])("rejects unvalidated release %j", value => {
  expect(() => parseFinnGenRelease(value)).toThrow("never silently substituted");
});

it("preserves provider metadata in the staging-compatible meta envelope", () => {
  expect(annotateFinnGen({ results: [], meta: { note: "upstream" } }, "R13")).toMatchObject({ meta: { note: "upstream", finngen: { release: "R13" } } });
  expect(annotateFinnGen({}, "R12")).toHaveProperty("meta.finngen.release", "R12");
});

it.each([null, [], "html"])("rejects a malformed FinnGen payload %j", data => {
  expect(() => annotateFinnGen(data, "R13")).toThrow("JSON object");
});

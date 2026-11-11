import { afterEach, expect, it, vi } from "vitest";
import { cohortBaseUrl, cohortFetch } from "./http";

afterEach(() => vi.unstubAllGlobals());

it("selects distinct release hosts without changing other cohorts", async () => {
  const fetch = vi.fn(async (_input: unknown) => Response.json({ results: [] }));
  vi.stubGlobal("fetch", fetch);
  await cohortFetch("finngen", "/api/variant/10:112998590-C-T");
  await cohortFetch("finngen", "/api/variant/10:112998590-C-T", undefined, { finngenRelease: "R13" });
  expect(String(fetch.mock.calls[0]?.[0])).toContain("https://r12.finngen.fi/");
  expect(String(fetch.mock.calls[1]?.[0])).toContain("https://r13.finngen.fi/");
  expect(cohortBaseUrl("bbj", "R13")).toBe("https://pheweb.jp");
});

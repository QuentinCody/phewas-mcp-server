import { expect, it } from "vitest";
import { openGwasRequest } from "./opengwas-request";

it("requires explicit bounded dataset selection for metadata", () => {
  expect(openGwasRequest({ method: "POST", path: "/opengwas/gwasinfo", body: { id: ["ieu-a-2"] } }).body).toEqual({ id: ["ieu-a-2"] });
  for (const body of [{}, { id: [] }, { id: Array(101).fill("ieu-a-2") }]) {
    expect(() => openGwasRequest({ method: "POST", path: "/opengwas/gwasinfo", body })).toThrow("Invalid");
  }
});

it("preserves GRCh37 coordinates, rsIDs and explicit proxy controls", () => {
  const body = { id: ["ieu-a-2"], variant: ["rs7903146", "10:114758349", "7:105561135-105563135"], proxies: 1, population: "EAS", r2: 0.9 };
  expect(openGwasRequest({ method: "POST", path: "/opengwas/associations", body }).body).toEqual(body);
  expect(openGwasRequest({ method: "POST", path: "/opengwas/associations", body: { id: ["ieu-a-2"], variant: ["rs7903146"] } }).body).toMatchObject({ proxies: 0 });
});

it("sets bounded PheWAS and preclumped top-hit defaults", () => {
  expect(openGwasRequest({ method: "POST", path: "/opengwas/phewas", body: { variant: ["rs7903146"], index_list: ["ieu-a"] } }).body).toEqual({ variant: ["rs7903146"], index_list: ["ieu-a"], pval: 1e-5 });
  expect(openGwasRequest({ method: "POST", path: "/opengwas/tophits", body: { id: ["ieu-a-2"] } }).body).toEqual({ id: ["ieu-a-2"], pval: 5e-8, preclumped: 1, clump: 1 });
});

it.each([
  { method: "GET", path: "/opengwas/../user" },
  { method: "POST", path: "/opengwas/status" },
  { method: "GET", path: "/opengwas/batches", body: {} },
  { method: "GET", path: "/opengwas/status", params: { token: "do-not-send" } },
  { method: "POST", path: "/opengwas/phewas", body: { variant: ["grch38:10:112998590-C-T"] } },
  { method: "POST", path: "/opengwas/phewas", body: { variant: ["rs7903146"], pval: 0.02 } },
  { method: "POST", path: "/opengwas/phewas", body: { variant: ["rs7903146"], token: "do-not-send" } },
])("rejects unsupported requests without reflecting input: %j", request => {
  expect(() => openGwasRequest(request)).toThrow();
});

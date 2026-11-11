import type { ApiEndpoint } from "@bio-mcp/shared/codemode/catalog";

export const openGwasEndpoints: ApiEndpoint[] = [
  {
    method: "GET", path: "/opengwas/status", category: "opengwas",
    summary: "IEU OpenGWAS service status and API version (anonymous). Preserve individual service errors even when HTTP is 200.",
    example: "return await api.get('/opengwas/status');",
  },
  {
    method: "GET", path: "/opengwas/batches", category: "opengwas",
    summary: "Discover IEU OpenGWAS dataset batches and their descriptions (anonymous). Batch releases can differ from direct cohort browsers; do not equate finn-b with FinnGen R13.",
    example: "return await api.get('/opengwas/batches');",
  },
  {
    method: "POST", path: "/opengwas/gwasinfo", category: "opengwas",
    summary: "IEU OpenGWAS metadata for explicit study IDs; requires configured OPENGWAS_JWT. Retains build, population, sample sizes, publications and access/license fields.",
    body: { contentType: "application/json", description: "{id: string[]} — 1–100 explicit study IDs. Whole-catalog enumeration is intentionally unsupported because it has a different allowance cost." },
    example: "return await api.post('/opengwas/gwasinfo', {id: ['ieu-a-2']});",
  },
  {
    method: "POST", path: "/opengwas/associations", category: "opengwas",
    summary: "IEU OpenGWAS variant–trait associations in selected studies; requires OPENGWAS_JWT. Coordinates are GRCh37/hg19; no automatic liftover. Effect alleles and proxy annotations remain intact.",
    body: { contentType: "application/json", description: "{id: string[1..10], variant: string[1..64], proxies?: 0|1 (default 0), population?: EUR|SAS|EAS|AFR|AMR, r2?: number[0..1], align_alleles?: 0|1, palindromes?: 0|1, maf_threshold?: number[0..0.5]}. Variants: rsID, chr:pos, chr:start-end. Proxies increase allowance cost; never treat a proxy as the requested variant." },
    example: "return await api.post('/opengwas/associations', {id: ['ieu-a-2'], variant: ['rs7903146'], proxies: 0});",
  },
  {
    method: "POST", path: "/opengwas/phewas", category: "opengwas",
    summary: "IEU OpenGWAS PheWAS across selected or all batches; requires OPENGWAS_JWT. GRCh37 coordinates or rsIDs. Costs scale with variants and returned associations.",
    body: { contentType: "application/json", description: "{variant: string[1..10], pval?: number (0 < pval <= 0.01; default 0.00001), index_list?: string[0..100]}. Missing/empty index_list searches all batches. Use /opengwas/batches to select batches; retain study IDs for provenance." },
    example: "return await api.post('/opengwas/phewas', {variant: ['rs7903146'], pval: 1e-5, index_list: ['ieu-a']});",
  },
  {
    method: "POST", path: "/opengwas/tophits", category: "opengwas",
    summary: "IEU OpenGWAS top associations for selected studies; requires OPENGWAS_JWT. Defaults to preclumped results; changing clumping can increase allowance cost.",
    body: { contentType: "application/json", description: "{id: string[1..10], pval?: number (0 < pval <= 0.01; default 5e-8), preclumped?: 0|1 (default 1), clump?: 0|1 (default 1), r2?: number[0..1], kb?: integer[1..100000], pop?: EUR|SAS|EAS|AFR|AMR}. Study IDs/batch labels are not dataset releases." },
    example: "return await api.post('/opengwas/tophits', {id: ['ieu-a-2'], pval: 5e-8});",
  },
];

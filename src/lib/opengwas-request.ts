import type { ApiFetchFn } from "@bio-mcp/shared/codemode/catalog";
import { z } from "zod";

const id = z.string().min(1).max(200);
const ids = z.array(id).min(1).max(100);
const variants = z.array(z.string().regex(/^(rs\d+|(?:[1-9]|1\d|2[0-2]|X|Y):[1-9]\d*(?:-[1-9]\d*)?)$/)).min(1).max(64);
const flag = z.union([z.literal(0), z.literal(1)]);
const probability = z.number().min(0).max(1);
const population = z.enum(["EUR", "SAS", "EAS", "AFR", "AMR"]);
const pval = z.number().gt(0).max(0.01);
const bodies: Record<string, z.ZodType> = {
  gwasinfo: z.object({ id: ids }).strict(),
  associations: z.object({
    id: ids.max(10), variant: variants, proxies: flag.default(0),
    population: population.optional(), r2: probability.optional(),
    align_alleles: flag.optional(), palindromes: flag.optional(),
    maf_threshold: z.number().min(0).max(0.5).optional(),
  }).strict(),
  phewas: z.object({ variant: variants.max(10), pval: pval.default(1e-5), index_list: z.array(id).max(100).optional() }).strict(),
  tophits: z.object({
    id: ids.max(10), pval: pval.default(5e-8), preclumped: flag.default(1), clump: flag.default(1),
    r2: probability.optional(), kb: z.number().int().positive().max(100000).optional(), pop: population.optional(),
  }).strict(),
};

export function openGwasRequest(request: Parameters<ApiFetchFn>[0]): { route: string; method: string; authenticated: boolean; body: unknown } {
  const route = request.path.match(/^\/opengwas\/(status|batches|gwasinfo|associations|phewas|tophits)$/)?.[1];
  if (!route) throw new Error("Unsupported OpenGWAS path. Discover /opengwas endpoints with phewas_search.");
  if (Object.keys(request.params ?? {}).length) throw new Error("OpenGWAS requests use JSON bodies, not query parameters.");
  const schema = bodies[route];
  const method = schema ? "POST" : "GET";
  if (request.method !== method) throw new Error(`OpenGWAS ${route} requires ${method}.`);
  if (!schema && request.body !== undefined) throw new Error("OpenGWAS public GET requests do not accept a body.");
  const parsed = schema?.safeParse(request.body);
  if (parsed && !parsed.success) throw new Error(`Invalid OpenGWAS ${route} body. Check the catalog's bounds and GRCh37 variant syntax.`);
  return { route, method, authenticated: Boolean(schema), body: parsed?.data };
}

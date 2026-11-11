import type { ApiEndpoint, WorkflowRecipe } from "@bio-mcp/shared/codemode/catalog";

const release = { name: "release", type: "string" as const, required: false, enum: ["R12", "R13"], default: "R12", description: "Explicit public FinnGen release host. Does not establish an immutable snapshot or equivalence to an OpenGWAS dataset." };
const phenocode = { name: "phenocode", type: "string" as const, required: true, description: "Exact release-specific FinnGen endpoint code selected from /finngen/api/phenos. Not an EFO ID or a phenotype label." };
const description = "Provider-source contract from FINNGEN/pheweb server.py. Native JSON is returned under data with meta.finngen request/source/hash context; arrays and objects remain unchanged. The phenotype definition route can contain only browser metadata, not full diagnostic coding criteria. No phenotype equivalence, variant identity or complete association coverage is inferred. Reads cap at 8 MiB and 20 seconds, without automatic retry, redirects or host fallback. Large results/errors stage with lossless native payload recovery.";

export const finnGenPhenotypeEndpoints: ApiEndpoint[] = [
  { method: "GET", path: "/finngen/api/phenos", category: "finngen", summary: "Discover the active phenotype definitions on the selected FinnGen release", description,
    queryParams: [release], responseShape: "{data: native phenotype array, meta: {finngen: request/source/hash context}}. Provider filters this list to active endpoints; no undocumented pagination or query filtering is added." },
  { method: "GET", path: "/finngen/api/pheno/{phenocode}", category: "finngen", summary: "Read one exact FinnGen phenotype definition before comparing associations", description,
    pathParams: [phenocode], queryParams: [release], responseShape: "{data: native phenotype definition, meta: {finngen: request/source/hash context}}. Preserve coding criteria, exclusions, counts and all other native fields." },
  { method: "GET", path: "/finngen/api/variant/{variant}/{phenocode}", category: "finngen", summary: "Read a FinnGen variant association for one explicitly selected phenotype", description,
    pathParams: [{ name: "variant", type: "string", required: true, description: "GRCh38 chr:pos-ref-alt or an unambiguous rsID; existing resolver rules apply." }, phenocode], queryParams: [release],
    responseShape: "{data: native provider response with results, meta: {finngen: request/source/hash context}}. Preserve the native results shape; it is not assumed to be the variant-wide association array." },
];

export const finnGenPhenotypeWorkflow: WorkflowRecipe = {
  title: "Review a selected FinnGen phenotype and its variant association",
  description: "First inspect /finngen/api/phenos and choose an exact phenocode from the same release. Fill in that code below; the unedited recipe makes no request. Retain the native definition and association response or staged handles. Do not map to EFO or infer clinical equivalence from names.",
  keywords: ["finngen", "phenotype", "phenocode", "trait", "endpoint definition", "R13"],
  code: `const phenocode = "";
if (!phenocode) return {selection_required: true, discovery_path: "/finngen/api/phenos", release: "R13"};
const release = "R13";
const definition = await api.get("/finngen/api/pheno/{phenocode}", {phenocode, release});
if (definition?.__staged || definition?.__api_error) return {definition};
if (definition?.data?.phenocode !== phenocode) return {definition, association_not_attempted: true, reason: "Phenotype identity is missing or differs from the selected code"};
const association = await api.get("/finngen/api/variant/{variant}/{phenocode}", {variant: "10:112998590-C-T", phenocode, release});
return {definition, association, trait_equivalence_verified: false, gene_score_contribution: false};`,
};

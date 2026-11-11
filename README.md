# phewas-mcp-server

Cross-cohort PheWAS MCP server wrapping cohort APIs and IEU OpenGWAS behind a
single Cloudflare Worker + Code Mode namespace.

Cohorts (build in parens):
- FinnGen R12/R13 (GRCh38) — https://r12.finngen.fi / https://r13.finngen.fi
- UKB-TOPMed (GRCh38) — https://pheweb.org/UKB-TOPMed
- BioBank Japan (GRCh37) — https://pheweb.jp
- TPMI (GRCh38) — https://pheweb.ibms.sinica.edu.tw
- Genebass gene burden — https://main.genebass.org/api

Hand-built tool: `phewas_variant_lookup` fans out a single variant (rsID or
`chr:pos-ref-alt` with `input_build: "GRCh37"` or `"GRCh38"`, default GRCh38) across the four variant-keyed cohorts in
parallel, using the shared `@bio-mcp/shared/variants/resolve` helpers for
build-appropriate coordinate formatting. Genebass is gene-level and is
exposed through Code Mode at `/genebass/api/phewas/{ensembl_gene_id}`.

FinnGen defaults to R12 for reproducibility. Select public DF13 explicitly:

```javascript
return await api.get('/finngen/api/variant/{variant}', {
  variant: '10:112998590-C-T', release: 'R13'
});
```

`api.get('/finngen/releases')` lists validated release URLs, dates and assemblies.
The [public DF13 release](https://www.finngen.fi/en/access_results) adds updated
health-register follow-up. R14 and `latest` are not accepted selectors. Raw
results preserve all provider fields plus `meta.finngen` provenance. Large
responses stage automatically; that metadata remains on the returned pointer.
Use `api.query(data_access_id, sql)` or `phewas_query_data` for the stored rows.

FinnGen phenotype discovery exposes three routes from the
[provider's PheWeb implementation](https://github.com/FINNGEN/pheweb/blob/master/pheweb/serve/server.py):

- `/finngen/api/phenos` lists the selected release's active phenotype definitions.
- `/finngen/api/pheno/{phenocode}` reads an exact definition.
- `/finngen/api/variant/{variant}/{phenocode}` reads the selected phenotype's
  association response for a variant, preserving its native `results` shape.

Start with discovery, then select a `phenocode` from that same release:

```javascript
return await api.get('/finngen/api/phenos', {release: 'R13'});
```

These three routes return `{data: nativeJSON, meta: {finngen: ...}}`, preserving
all native fields, numeric strings and arrays. Metadata records the requested
release host, retrieval time, HTTP status, selected response headers, body size,
native byte SHA-256 and a separate canonical JSON SHA-256 hash. The release host is request provenance, not proof
of an immutable snapshot, variant identity or equivalence to an EFO trait.
The catalog includes a workflow that requires explicit phenotype selection
before reading the definition and association; it retains staged handles.

Each native read is limited to 8 MiB and 20 seconds, without automatic retries,
redirects or host fallback. Complete provider error bodies are retained;
oversized or timed-out responses are marked incomplete without a partial hash.
HTTP 206 and Content-Range responses are retained as explicit errors.

October 4, 2026 native acceptance observed 2,470 active phenotypes on R12 and
2,754 on R13. These active lists differ from the provider's release-level
endpoint counts and do not establish complete coverage. The selected `T2D`
definition has browser metadata and counts; it does not include complete
diagnostic coding criteria. R12/R13 variant-wide responses preserve null
p-values and all native rows. The single-phenotype route returns fewer digits
for some p-values than the variant-wide route; neither value is substituted
for the other. See the repository's dated upstream implementation tracker for
the native receipts and local Worker acceptance scope.

All five tool families have both `phewas_*` and `mcp_phewas_*` names. Code Mode
continues to support composition and SQL access. Complete composed results,
errors and SQL/schema responses over 30 KiB stage through the existing Durable
Object, with citation hashes and `_staging` metadata on the returned handle.
All aliases cite inline success and error results as well. `payloads` and
`content_chunks` retain the full original JSON. Existing `associations`,
`gene_burden` and phenotype-list `data` tables add `native_json` for exact row
recovery; nested arrays/objects remain JSON text alongside scalar projections.
Numeric-looking string identifiers remain TEXT. `evidence_context` or `records`
preserves source context, variant/gene metadata and sibling arrays. Full-response
staging also applies to composed results and SQL/schema output.

The hand-built tool (also named `mcp_phewas_variant_lookup`) accepts
`finngen_release: "R13"`. Each FinnGen result reports its release, assembly,
source and matching browser URL. Summaries retain phenotype codes and
`n_case`/`n_control`, and keep odds ratios separate from beta coefficients.
FinnGen effect sizes refer to the reference-genome alternate allele. The
hand-built tool also stages oversized summaries and attaches citation hashes.

For Code Mode, bare coordinates are assumed to use the cohort's build;
prefix coordinates with `grch37:` or `grch38:` to specify a different input
assembly. An rsID requires an unambiguous alternate allele in each requested
Ensembl assembly; otherwise supply explicit coordinates. Same-build coordinate
queries do not depend on Ensembl. Cross-build failure retains input-build
coordinates and reports the unavailable mapping without changing alleles.
An error-only cohort result is returned as an MCP error, not a successful lookup.

[IEU OpenGWAS](https://api.opengwas.io/api/) is available as a separate source
under `/opengwas`, through Code Mode. Anonymous `GET /opengwas/status` and
`GET /opengwas/batches` discover service health and dataset batches. Read-only
JSON POST queries expose `gwasinfo`, `associations`, `phewas` and `tophits`.
These require a provider-issued JWT in the Worker secret `OPENGWAS_JWT`
(`pnpm exec wrangler secret put OPENGWAS_JWT` from this server directory), or
in the local `.dev.vars`. Tokens currently expire after 14 days. Never put a
token in Code Mode or source control. The server fails before making a
protected request when no token is configured.

```javascript
return await api.post('/opengwas/phewas', {
  variant: ['rs7903146'], pval: 1e-5, index_list: ['ieu-a']
});
```

OpenGWAS coordinates use GRCh37/hg19; this adapter does not lift them over.
Its responses retain the upstream payload in `data` and attribution, retrieval
time, input-coordinate convention and allowance headers in `meta.opengwas`.
Study metadata, alleles, effect sizes and proxy flags remain unchanged. Large
results use the existing staging/SQL path. Dataset licenses and access rules
still apply; the adapter does not claim commercial approval on your behalf.

Catalog entries describe local request bounds. Metadata queries require
1–100 explicit study IDs to avoid unexpectedly costly whole-catalog queries.
Associations allow up to 10 studies and 64 variants; PheWAS up to 10 variants;
top hits up to 10 studies. Proxies default off. There are no automatic retries,
including on HTTP 429; respect `Retry-After` and `X-Allowance-*` metadata before
another request. The adapter does not coordinate quota across Worker instances.

Batch names do not establish data-release equivalence: the September 27, 2026
public batch listing describes `finn-b` as FinnGen round 5, independently of the
direct R12/R13 browsers. Other PheWeb deployments likewise retain independent
schemas and availability; a FinnGen release selector never applies to them.

Dev: `./scripts/dev-servers.sh phewas` (port 8889).

<!-- license-and-data-terms:start -->
## License and data terms

The code in this repository is licensed under the Apache License 2.0 (see `LICENSE`).
If you use it in your work, please cite it (see `CITATION.cff`). Citation is requested, not required.

The license covers the code only. Data that this server returns comes from FinnGen, UKB-TOPMed, BBJ, TPMI, Genebass and stays under the terms of that source: FinnGen, UKB-TOPMed: no license; BioBank Japan (NBDC): research and development use, no redistribution grant; TPMI: all rights reserved; Genebass: CC BY 4.0, bound by UK Biobank terms.
You are responsible for your use of the data under those terms.
<!-- license-and-data-terms:end -->

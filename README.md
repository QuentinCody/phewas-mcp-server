# phewas-mcp-server

Cross-cohort PheWAS MCP server wrapping five summary-stats APIs behind a
single Cloudflare Worker + Code Mode namespace.

Cohorts (build in parens):
- FinnGen r12 (GRCh38) — https://r12.finngen.fi
- UKB-TOPMed (GRCh38) — https://pheweb.org/UKB-TOPMed
- BioBank Japan (GRCh37) — https://pheweb.jp
- TPMI (GRCh38) — https://pheweb.ibms.sinica.edu.tw
- Genebass gene burden — https://main.genebass.org/api

Hand-built tool: `phewas_variant_lookup` fans out a single variant (rsID or
`chr:pos-ref-alt` in either build) across the four variant-keyed cohorts in
parallel, using the shared `@bio-mcp/shared/variants/resolve` helpers for
build-appropriate coordinate formatting. Genebass is gene-level and is
exposed through Code Mode at `/genebass/api/phewas/{ensembl_gene_id}`.

Dev: `./scripts/dev-servers.sh phewas` (port 8889).

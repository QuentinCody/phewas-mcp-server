import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createSearchTool } from "@bio-mcp/shared/codemode/search-tool";
import { createExecuteTool } from "@bio-mcp/shared/codemode/execute-tool";
import { phewasCatalog } from "../spec/catalog";
import { createPhewasApiFetch } from "../lib/api-adapter";

interface CodeModeEnv {
    PHEWAS_DATA_DO: DurableObjectNamespace;
    CODE_MODE_LOADER: WorkerLoader;
}

// Preamble surfaces cohort/build rules to the isolate so Code Mode authors
// don't need to know @bio-mcp/shared/variants/resolve internals. The
// api-adapter auto-resolves rsID / GRCh37 / GRCh38 inputs into the cohort-
// specific canonical string before calling upstream.
const PHEWAS_PREAMBLE = `
// --- PheWAS cohort & variant-resolution notes ---
// 1. api.get('/finngen/api/variant/{variant}', { variant: 'rs7903146' })
//      — pass an rsID OR a chr-pos-ref-alt string in any build; the adapter
//      calls the shared resolver (Ensembl GRCh37/GRCh38 overlap) and emits
//      the cohort-specific canonical string automatically.
// 2. Cohort → build:
//      finngen:     GRCh38
//      ukb-topmed:  GRCh38
//      tpmi:        GRCh38
//      bbj:         GRCh37 (the outlier — resolver lifts GRCh38 inputs)
//      genebass:    gene-level, not variant — use /genebass/api/phewas/{ensembl_gene_id}
// 3. For a pre-resolved variant view across all cohorts, use the hand-built
//    'phewas_variant_lookup' MCP tool — it fans out in parallel and returns
//    per-cohort status rows. Not callable from inside the isolate; exit
//    Code Mode and call it directly.
// 4. TPMI community mirror can return HTTP 530 if its DNS flaps. Treat TPMI
//    errors as isolated to that cohort; other cohorts still resolve.
// 5. FinnGen /api/top_hits and UKB-TOPMed /api/top_hits return 404 upstream
//    despite being documented — skip them. Use /api/variant/{variant} instead.
`;

export function registerCodeMode(
    server: McpServer,
    env: CodeModeEnv,
): void {
    const apiFetch = createPhewasApiFetch();

    const searchTool = createSearchTool({
        prefix: "phewas",
        catalog: phewasCatalog,
    });
    searchTool.register(server as unknown as { tool: (...args: unknown[]) => void });

    const executeTool = createExecuteTool({
        prefix: "phewas",
        // Verifiable provenance: phewas_execute results carry a _meta.citation.
        source: { id: "phewas", name: "PheWAS Catalog", url: "https://phewascatalog.org" },
        catalog: phewasCatalog,
        apiFetch,
        doNamespace: env.PHEWAS_DATA_DO,
        loader: env.CODE_MODE_LOADER,
        preamble: PHEWAS_PREAMBLE,
    });
    executeTool.register(server as unknown as { tool: (...args: unknown[]) => void });
}

import { createExecuteTool } from "@bio-mcp/shared/codemode/execute-tool";
import { createSearchTool } from "@bio-mcp/shared/codemode/search-tool";
import type { McpServer } from "@bio-mcp/shared/mcp";
import { createPhewasApiFetch } from "../lib/api-adapter";
import { PHEWAS_SOURCE } from "../lib/http";
import { phewasResponse } from "../lib/tool-result";
import { phewasCatalog } from "../spec/catalog";

interface CodeModeEnv {
    OPENGWAS_JWT?: string;
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
//      — pass an rsID or coordinates in the cohort's build. For a different
//      coordinate build, prefix with grch37: or grch38:. Bare coordinates
//      are assumed to use the cohort's build; build is never guessed.
//      FinnGen also accepts release: 'R13'; default remains 'R12'.
//      /finngen/releases lists validated releases; meta.finngen preserves provenance.
//      Discover phenocodes with /finngen/api/phenos, then read
//      /finngen/api/pheno/{phenocode} and /finngen/api/variant/{variant}/{phenocode}.
//      These return {data: nativeJSON, meta: {finngen: requestAndHashContext}}.
//      Keep the same release; phenotype names do not establish equivalence.
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
// 6. /opengwas is a separate IEU OpenGWAS source; use api.post for queries.
//    Coordinates are GRCh37 without automatic liftover. Results have data and
//    meta.opengwas. Configure OPENGWAS_JWT server-side; never pass credentials
//    in code. Honor allowance/Retry-After metadata before another query.
`;

export function registerCodeMode(
    server: McpServer,
    env: CodeModeEnv,
): void {
    const apiFetch = createPhewasApiFetch(env.OPENGWAS_JWT);
    const registrar = { tool: (...args: unknown[]) => {
        const [name, ...rest] = args;
        // Shared factories supply the SDK's registration arguments and handler.
        const handler = rest.pop() as (input: unknown, extra: unknown) => ReturnType<typeof phewasResponse>;
        const respond = (input: unknown, extra: unknown) => phewasResponse(() => handler(input, extra), env, String(name), extra, input);
        const register = server.tool.bind(server) as (...values: unknown[]) => void;
        register(name, ...rest, respond);
        register(`mcp_${String(name)}`, ...rest, respond);
    } };

    const searchTool = createSearchTool({
        prefix: "phewas",
        catalog: phewasCatalog,
    });
    searchTool.register(registrar);

    const executeTool = createExecuteTool({
        prefix: "phewas",
        // Verifiable provenance: phewas_execute results carry a _meta.citation.
        source: PHEWAS_SOURCE,
        catalog: phewasCatalog,
        apiFetch,
        preserveApiErrors: true,
        maxInlineBytes: 30 * 1024,
        stagingThreshold: 30 * 1024,
        doNamespace: env.PHEWAS_DATA_DO,
        loader: env.CODE_MODE_LOADER,
        preamble: PHEWAS_PREAMBLE,
    });
    executeTool.register(registrar);
}

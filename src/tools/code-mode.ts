import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createSearchTool } from "@bio-mcp/shared/codemode/search-tool";
import { createExecuteTool } from "@bio-mcp/shared/codemode/execute-tool";
import { phewasCatalog } from "../spec/catalog";
import { createPhewasApiFetch } from "../lib/api-adapter";

interface CodeModeEnv {
    PHEWAS_DATA_DO: DurableObjectNamespace;
    CODE_MODE_LOADER: WorkerLoader;
}

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
        catalog: phewasCatalog,
        apiFetch,
        doNamespace: env.PHEWAS_DATA_DO,
        loader: env.CODE_MODE_LOADER,
    });
    executeTool.register(server as unknown as { tool: (...args: unknown[]) => void });
}

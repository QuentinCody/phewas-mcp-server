import type { ApiFetchFn } from "@bio-mcp/shared/codemode/catalog";
import { openGwasRequest } from "./opengwas-request";

const BASE_URL = "https://api.opengwas.io/api";

function metadata(response: Response, route: string) {
  const allowance = Object.fromEntries([...response.headers].filter(([name]) => name.startsWith("x-allowance-") || name === "retry-after"));
  return { opengwas: {
    provider: "IEU OpenGWAS", documentation: `${BASE_URL}/`, source_url: `${BASE_URL}/${route}`,
    retrieved_at: new Date().toISOString(), input_coordinate_build: "GRCh37",
    rate_limits: allowance,
  } };
}

async function readResponse(response: Response, route: string, jwt?: string) {
  const meta = metadata(response, route);
  if (!response.ok) {
    const hint = response.status === 429 ? " Respect Retry-After and X-Allowance headers before another query." : " Check credentials, dataset access and provider status.";
    throw Object.assign(new Error(`OpenGWAS HTTP ${response.status}.${hint}`), { status: response.status, data: { meta } });
  }
  if (!response.headers.get("content-type")?.includes("json")) throw new Error("OpenGWAS returned a non-JSON response.");
  const raw = await response.text();
  // An upstream echo must never expose the configured credential to the isolate.
  const safe = jwt ? raw.split(jwt).join("[REDACTED]") : raw;
  let data: unknown;
  try { data = JSON.parse(safe); } catch { throw new Error("OpenGWAS returned invalid JSON."); }
  return { status: response.status, data: { data, meta } };
}

/** Fixed, read-only operations. No automatic retries: POST queries consume allowance. */
export function createOpenGwasFetch(jwt?: string): ApiFetchFn {
  return async request => {
    const input = openGwasRequest(request);
    if (input.authenticated && !jwt) throw new Error("OpenGWAS requires a server-side OPENGWAS_JWT. Obtain a token at https://api.opengwas.io/api/; do not pass tokens through Code Mode.");
    const headers: Record<string, string> = { Accept: "application/json" };
    if (input.authenticated) {
      headers.Authorization = `Bearer ${jwt}`;
      headers["Content-Type"] = "application/json";
    }
    let response: Response;
    try {
      response = await fetch(`${BASE_URL}/${input.route}`, {
        method: input.method, headers, body: input.body ? JSON.stringify(input.body) : undefined,
        redirect: "manual", signal: AbortSignal.timeout(60000),
      });
    } catch { throw new Error("OpenGWAS request failed or timed out; no automatic retry was attempted."); }
    return readResponse(response, input.route, jwt);
  };
}

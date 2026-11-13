import { readRequestBody } from "@modelcontextprotocol/sdk/server/requestBody.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { mcpServer } from "@/server/mcp";

function rpcError(status: number, code: number, message: string, headers?: HeadersInit) {
  return Response.json({ jsonrpc: "2.0", error: { code, message }, id: null }, { status, headers });
}

export async function POST(request: Request) {
  const body = await readRequestBody(request);
  if (body.tooLarge) return rpcError(413, -32000, "Request body too large.");
  let message: unknown;
  try {
    message = JSON.parse(body.text);
  } catch {
    return rpcError(400, -32700, "Parse error: Invalid JSON");
  }
  // MCP dropped batches in 2025-06-18. Allowing them would let one POST fan out into hundreds of Croma calls.
  if (Array.isArray(message)) return rpcError(400, -32600, "Send one message per request; batches are not supported.");

  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  await mcpServer(new URL(request.url).origin).connect(transport);
  return transport.handleRequest(request, { parsedBody: message });
}

/** Without sessions there is no stream to open or close, so only POST is served. */
function notAllowed() {
  return rpcError(405, -32000, "Method not allowed.", { Allow: "POST" });
}

export { notAllowed as DELETE, notAllowed as GET };

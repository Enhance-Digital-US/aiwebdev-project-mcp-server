import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../src/index.js';

export const BASE = 'http://localhost:8787';

export async function call(request: Request, bindings: typeof env = env): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, bindings, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

export interface JsonRpcResponse {
  id?: number;
  result?: any;
  error?: { code: number; message: string };
}

// MCP responses arrive as JSON or as SSE (`data:` lines, possibly multi-line).
async function readJsonRpc(response: Response): Promise<JsonRpcResponse> {
  const text = await response.text();
  if (!text.trimStart().startsWith('event:') && !text.trimStart().startsWith('data:')) {
    return JSON.parse(text);
  }
  const messages = text
    .split(/\r?\n\r?\n/)
    .map((event) =>
      event
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).replace(/^ /, ''))
        .join('\n'),
    )
    .filter(Boolean)
    .map((data) => JSON.parse(data) as JsonRpcResponse);
  return messages.find((message) => message.id !== undefined) ?? messages[messages.length - 1];
}

export async function mcp(
  token: string | undefined,
  method: string,
  params: Record<string, unknown> = {},
  bindings: typeof env = env,
): Promise<{ status: number; headers: Headers; body?: JsonRpcResponse }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await call(
    new Request(`${BASE}/mcp`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
    bindings,
  );
  if (response.status !== 200) return { status: response.status, headers: response.headers };
  return { status: 200, headers: response.headers, body: await readJsonRpc(response) };
}

// Text of a tools/call result (isError results carry the error message as text).
export function toolText(body: JsonRpcResponse | undefined): string {
  if (body?.error) return body.error.message;
  return (body?.result?.content ?? []).map((part: { text?: string }) => part.text ?? '').join('\n');
}

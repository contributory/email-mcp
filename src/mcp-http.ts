import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createMcpServer } from './mcp-server.js';

/* ═══════════════════════════════════════════════════════════
   MCP server qua HTTP (Streamable HTTP) — endpoint `/mcp`
   Cho phép MCP client kết nối từ xa (Claude Desktop, Cursor,
   VS Code Copilot…) tới bản deploy EdgeOne Pages hoặc web local.
   - Mỗi session có riêng McpServer + transport, lưu trong Map
     module-level (tồn tại trong cùng isolate edge runtime).
   - Khi isolate bị đóng (scale-to-zero), session cũ mất — client
     sẽ initialize lại, đây là hành vi chuẩn của Streamable HTTP.
   ═══════════════════════════════════════════════════════════ */

interface McpSession {
  server: McpServer;
  transport: WebStandardStreamableHTTPServerTransport;
}

const sessions = new Map<string, McpSession>();

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers':
      'content-type, mcp-session-id, mcp-protocol-version, authorization, accept, last-event-id',
  };
}

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders())) headers.set(k, v);
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

function jsonError(status: number, message: string): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32603, message },
      id: null,
    }),
    {
      status,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    }
  );
}

/**
 * Spec MCP Streamable HTTP yêu cầu client khai báo `Accept` gồm cả
 * text/event-stream (POST: application/json + text/event-stream, GET:
 * text/event-stream). Server tự chèn header để mọi client gọi được
 * JSON-RPC thuần mà không cần biết tới SSE.
 */
function withAccept(req: Request): Request {
  const headers = new Headers(req.headers);
  const accept = headers.get('accept') || '';
  const needed =
    req.method === 'GET' ? ['text/event-stream'] : ['application/json', 'text/event-stream'];
  const missing = needed.filter((t) => !accept.includes(t));
  if (missing.length) {
    const merged = accept ? `${accept}, ${missing.join(', ')}` : missing.join(', ');
    headers.set('accept', merged);
  }
  return new Request(req, { headers });
}

/** Xử lý mọi request tới `/mcp` — trả về Response Web Standard */
export async function handleMcpRequest(request: Request): Promise<Response> {
  // Preflight CORS (cho MCP client chạy trong trình duyệt)
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  request = withAccept(request);

  const sessionId = request.headers.get('mcp-session-id') || undefined;
  const existing = sessionId ? sessions.get(sessionId) : undefined;

  // Request thuộc session đã có → dùng lại transport
  if (existing) {
    try {
      return withCors(await existing.transport.handleRequest(request));
    } catch (err: any) {
      return jsonError(500, err?.message || 'Lỗi xử lý request MCP');
    }
  }

  // Session mới: tạo transport + MCP server riêng (7 tools email)
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    // JSON-RPC thuần qua POST (Streamable HTTP), không dùng SSE stream cũ
    enableJsonResponse: true,
  });
  const server = createMcpServer();
  await server.connect(transport);

  let response: Response;
  try {
    response = await transport.handleRequest(request);
  } catch (err: any) {
    await server.close().catch(() => {});
    return jsonError(500, err?.message || 'Lỗi xử lý request MCP');
  }

  // Session ID được sinh trong lúc xử lý initialize — lưu lại sau khi xong
  const sid = transport.sessionId;
  if (sid && !sessions.has(sid)) {
    sessions.set(sid, { server, transport });
    transport.onclose = () => {
      sessions.delete(sid);
      server.close().catch(() => {});
    };
  }

  return withCors(response);
}

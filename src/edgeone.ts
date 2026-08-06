import { setEnvOverlay } from './config.js';
import { createInMemoryClient } from './mcp-server.js';
import { createWebApp } from './api-app.js';
import { handleMcpRequest } from './mcp-http.js';

/* ════════════════════════════════════════════════════════════
   Entry cho EdgeOne Functions (functions/index.tsx gọi tới đây).
   Trên EdgeOne:
   - KHÔNG có filesystem → cấu hình LÔN lấy từ BIẾN MÔI TRƯỞNG
     (đặt trong bảng điều khiển EdgeOne)
   - File tĩnh được phục vụ bằng cách re-fetch URL (như template gốc)
   ═══════════════════════════════════════════════════════════ */

export async function emailOnRequest(context: {
  request: Request;
  params: Record<string, string>;
  env: Record<string, any>;
}): Promise<Response> {
  // EdgeOne Pages đưa biến môi trường vào `context.env` (KHÔNG phải process.env
  // — trên edge runtime process.env có thể không tồn tại hoặc read-only), nên
  // nạp trực tiếp vào overlay để getMailConfig() đọc được.
  setEnvOverlay(context.env);

  // Endpoint MCP Streamable HTTP — cho MCP client kết nối từ xa
  const url = new URL(context.request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path === '/mcp') {
    return handleMcpRequest(context.request);
  }

  const mcp = await createInMemoryClient();
  const app = createWebApp(mcp.client);

  // Phục vụ file tĩnh từ public/ (EdgeOne tự resolve đường dẫn)
  app.notFound(async (c) => {
    const url = new URL(c.req.url);
    if (url.pathname === '/') url.pathname = '/index.html';
    try {
      const res = await fetch(url.toString(), { headers: c.req.header() });
      if (res.ok) {
        const contentType = res.headers.get('Content-Type')!;
        const body = await res.arrayBuffer();
        return new Response(body, {
          status: res.status,
          headers: {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=3600',
          },
        });
      }
    } catch {
      // fall-through
    }
    return c.json({ error: 'Không tìm thấy' }, 404);
  });

  return app.fetch(context.request, context.env);
}

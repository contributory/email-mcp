import { setEdgeOneMode, setKvBinding } from './config.js';
import { createInMemoryClient } from './mcp-server.js';
import { createWebApp } from './api-app.js';

/* ═══════════════════════════════════════════════════════════
   Entry cho EdgeOne Functions (functions/index.tsx gọi tới đây).
   Trên EdgeOne:
   - KHÔNG có filesystem → cấu hình lấy từ BIẾN MÔI TRƯỜNG
     (đặt trong bảng điều khiển EdgeOne, không cần KV)
   - Nếu sau này có KV binding `my_kv` thì vẫn dùng để lưu settings
   - File tĩnh được phục vụ bằng cách re-fetch URL (như template gốc)
   ═══════════════════════════════════════════════════════════ */

export async function emailOnRequest(context: {
  request: Request;
  params: Record<string, string>;
  env: Record<string, any>;
}): Promise<Response> {
  // Chế độ EdgeOne: ưu tiên biến môi trường; KV chỉ dùng nếu có binding
  setEdgeOneMode(true);
  setKvBinding(context.env?.my_kv || null);

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

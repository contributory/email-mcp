import fs from 'node:fs';
import path from 'node:path';
import { serve, type ServerType } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createInMemoryClient, type McpClientHandle } from './mcp-server.js';
import { createWebApp } from './api-app.js';
import { handleMcpRequest } from './mcp-http.js';

const PORT = Number(process.env.PORT || 3000);

export interface WebServerHandle {
  server: ServerType;
  close: () => Promise<void>;
}

/** Khởi động web app local (SPA + REST API gọi qua MCP client in-memory) */
export async function startWeb(): Promise<WebServerHandle> {
  const mcp: McpClientHandle = await createInMemoryClient();
  const app = createWebApp(mcp.client);

  /* ------------------------- MCP Streamable HTTP ------------------------- */

  app.all('/mcp', async (c) => handleMcpRequest(c.req.raw));

  /* ------------------------- Static SPA (Node) ------------------------- */

  app.get('/', (c) => {
    try {
      return c.html(fs.readFileSync(path.join(process.cwd(), 'public', 'index.html'), 'utf-8'));
    } catch {
      return c.text('index.html không tồn tại', 500);
    }
  });
  app.use(
    '/*',
    serveStatic({
      root: './public',
      rewriteRequestPath: (p) => p,
    })
  );

  app.notFound((c) => c.json({ error: 'Không tìm thấy' }, 404));

  const server = serve({ fetch: app.fetch, port: PORT });

  const addr = `http://localhost:${PORT}`;
  console.log('');
  console.log('  ┌──────────────────────────────────────────────┐');
  console.log('  │   ✉️  Mail MCP — Web UI                       │');
  console.log('  │   MCP server: kết nối in-memory ✔            │');
  console.log(`  │   Mở trình duyệt: ${addr.padEnd(31)}│`);
  console.log('  └──────────────────────────────────────────────┘');
  console.log('');

  return {
    server,
    close: async () => {
      await mcp.close();
      server.close();
    },
  };
}

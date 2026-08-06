import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

/* ═══════════════════════════════════════════════════════════
   Hono app với đầy đủ REST API (gọi qua MCP client).
   KHÔNG import bất kỳ module Node nào để chạy được cả trên
   Node.js (web-server.ts) lẫn EdgeOne Functions (edgeone.ts).
   ═══════════════════════════════════════════════════════════ */

function parseToolResult(res: any): any {
  if (res.isError) {
    const text = res.content?.[0]?.text || 'Lỗi không xác định';
    throw new Error(text.replace(/^Lỗi:\s*/, ''));
  }
  const text = res.content?.[0]?.text;
  if (text) {
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }
  return res.structuredContent ?? {};
}

export function createWebApp(client: Client): Hono {
  const app = new Hono();
  app.use('*', cors({ origin: '*' }));

  const callTool = async (name: string, args: Record<string, unknown> = {}) =>
    parseToolResult(await client.callTool({ name, arguments: args }));

  /* ------------------------- REST API ------------------------- */

  app.get('/api/health', (c) => c.json({ ok: true, service: 'email-mcp', mcp: 'connected' }));

  app.get('/api/account', async (c) => {
    try {
      const data = await callTool('get_account_info');
      return c.json(data);
    } catch (err: any) {
      return c.json({ error: err?.message || String(err) }, 502);
    }
  });

  app.get('/api/emails', async (c) => {
    try {
      const folder = c.req.query('folder') || 'INBOX';
      const limit = Number(c.req.query('limit') || 50);
      const since = c.req.query('since');
      const data = await callTool('list_emails', { folder, limit, since });
      return c.json(data);
    } catch (err: any) {
      return c.json({ error: err?.message || String(err) }, 502);
    }
  });

  app.get('/api/emails/:uid', async (c) => {
    try {
      const uid = Number(c.req.param('uid'));
      const folder = c.req.query('folder') || 'INBOX';
      const data = await callTool('read_email', { uid, folder });
      return c.json(data);
    } catch (err: any) {
      return c.json({ error: err?.message || String(err) }, 502);
    }
  });

  app.get('/api/emails/:uid/attachment/:partId', async (c) => {
    try {
      const uid = Number(c.req.param('uid'));
      const partId = c.req.param('partId');
      const folder = c.req.query('folder') || 'INBOX';
      const data = await callTool('get_attachment', { uid, partId, folder });
      const buf = Buffer.from(data.contentBase64 || '', 'base64');
      const safeName = data.filename?.replace(/[^\w.\- ]+/g, '_') || 'attachment';
      return new Response(buf, {
        status: 200,
        headers: {
          'Content-Type': data.contentType || 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(data.filename || safeName)}`,
          'Content-Length': String(buf.length),
        },
      });
    } catch (err: any) {
      return c.json({ error: err?.message || String(err) }, 502);
    }
  });

  app.post('/api/emails/:uid/read', async (c) => {
    try {
      const uid = Number(c.req.param('uid'));
      const body = (await c.req.json().catch(() => ({}))) as { seen?: boolean; folder?: string };
      const data = await callTool('mark_email_read', {
        uid,
        seen: body.seen !== false,
        folder: body.folder || 'INBOX',
      });
      return c.json(data);
    } catch (err: any) {
      return c.json({ error: err?.message || String(err) }, 502);
    }
  });

  app.get('/api/search', async (c) => {
    try {
      const query = c.req.query('q') || '';
      const folder = c.req.query('folder') || 'INBOX';
      const limit = Number(c.req.query('limit') || 50);
      const data = await callTool('search_emails', { query, folder, limit });
      return c.json(data);
    } catch (err: any) {
      return c.json({ error: err?.message || String(err) }, 502);
    }
  });

  app.post('/api/send', async (c) => {
    try {
      const body: Record<string, any> = await c.req.json();
      const result = await callTool('send_email', {
        to: body.to || '',
        cc: body.cc || undefined,
        bcc: body.bcc || undefined,
        subject: body.subject || '',
        text: body.text || undefined,
        html: body.html || undefined,
        attachments: body.attachments || undefined,
      });
      return c.json(result);
    } catch (err: any) {
      return c.json({ error: err?.message || String(err) }, 502);
    }
  });

  app.onError((err, c) => {
    console.error('[email-mcp] Lỗi server:', err);
    return c.json({ error: err?.message || 'Lỗi server' }, 500);
  });

  return app;
}

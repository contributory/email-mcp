import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { z } from 'zod';
import {
  getAttachment,
  getEmail,
  listEmails,
  listMailboxes,
  searchEmails,
  sendEmail,
  setEmailSeen,
} from './email-service.js';
import { getMailConfig } from './config.js';

function textResult(data: unknown, indent = 2) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, indent) }] };
}

function errorResult(message: string) {
  return {
    content: [{ type: 'text' as const, text: `Lỗi: ${message}` }],
    isError: true as const,
  };
}

/* ------------------------- Zod schemas ------------------------- */

const folderSchema = z
  .string()
  .optional()
  .describe('Tên thư mục IMAP, mặc định "INBOX"');
const limitSchema = z
  .number()
  .int()
  .min(1)
  .max(200)
  .optional()
  .describe('Số email tối đa cần lấy, mặc định 50');

const listEmailsSchema = z.object({
  folder: folderSchema,
  limit: limitSchema,
  since: z
    .string()
    .optional()
    .describe('Chỉ lấy email từ ngày này trở đi, định dạng ISO (vd: 2025-01-01)'),
});

const readEmailSchema = z.object({
  uid: z.number().int().positive().describe('UID của email (lấy từ list_emails)'),
  folder: folderSchema,
});

const searchEmailsSchema = z.object({
  query: z.string().min(1).describe('Từ khóa tìm kiếm'),
  folder: folderSchema,
  limit: limitSchema,
});

const sendEmailSchema = z.object({
  to: z.string().describe('Địa chỉ người nhận, phân cách nhiều email bằng dấu phẩy'),
  subject: z.string().describe('Tiêu đề email'),
  text: z.string().optional().describe('Nội dung dạng văn bản thuần'),
  html: z.string().optional().describe('Nội dung dạng HTML'),
  cc: z.string().optional().describe('Danh sách CC, phân cách bằng dấu phẩy'),
  bcc: z.string().optional().describe('Danh sách BCC, phân cách bằng dấu phẩy'),
  attachments: z
    .array(
      z.object({
        filename: z.string().describe('Tên file'),
        contentType: z.string().optional().describe('MIME type, vd: application/pdf'),
        contentBase64: z.string().describe('Nội dung file mã hóa base64'),
      })
    )
    .optional()
    .describe('Danh sách file đính kèm'),
});

const getAttachmentSchema = z.object({
  uid: z.number().int().positive().describe('UID của email'),
  partId: z.string().describe('Mã BODYPART của file đính kèm (từ read_email)'),
  folder: folderSchema,
});

/* ------------------------- MCP server ------------------------- */

/**
 * Wrapper đăng ký tool — ép kiểu `any` để tránh lỗi suy diễn generic quá sâu
 * của SDK + zod trên TypeScript 5.9. Zod schema vẫn validate input ở runtime.
 */
function registerTool(
  server: McpServer,
  name: string,
  config: {
    title: string;
    description: string;
    inputSchema: z.ZodTypeAny;
  },
  handler: (args: any) => Promise<{ content: any[]; isError?: boolean }>
) {
  server.registerTool(name, config as any, handler as any);
}

/** Tạo MCP server email với đầy đủ tools */
export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'email-mcp',
    version: '1.0.0',
  });

  registerTool(
    server,
    'list_emails',
    {
      title: 'Danh sách email',
      description:
        'Liệt kê email trong một thư mục (mặc định INBOX), mới nhất trước. Trả về tiêu đề, người gửi, ngày, cờ seen/flagged và đoạn trích nội dung.',
      inputSchema: listEmailsSchema,
    },
    async (args: z.infer<typeof listEmailsSchema>) => {
      try {
        const cfg = await getMailConfig();
        const result = await listEmails(cfg, args);
        return textResult({
          folder: result.folder,
          total: result.total,
          count: result.emails.length,
          emails: result.emails,
        });
      } catch (err: any) {
        return errorResult(err?.message || String(err));
      }
    }
  );

  registerTool(
    server,
    'read_email',
    {
      title: 'Đọc email',
      description:
        'Đọc toàn bộ nội dung một email theo UID (lấy từ list_emails): nội dung text/html, người gửi/nhận, CC, và danh sách file đính kèm.',
      inputSchema: readEmailSchema,
    },
    async (args: z.infer<typeof readEmailSchema>) => {
      try {
        const cfg = await getMailConfig();
        const email = await getEmail(cfg, args.uid, args.folder);
        return textResult(email);
      } catch (err: any) {
        return errorResult(err?.message || String(err));
      }
    }
  );

  registerTool(
    server,
    'search_emails',
    {
      title: 'Tìm kiếm email',
      description:
        'Tìm kiếm email theo từ khóa trong người gửi, người nhận, tiêu đề hoặc nội dung (IMAP SEARCH).',
      inputSchema: searchEmailsSchema,
    },
    async (args: z.infer<typeof searchEmailsSchema>) => {
      try {
        const cfg = await getMailConfig();
        const result = await searchEmails(cfg, args.query, {
          folder: args.folder,
          limit: args.limit,
        });
        return textResult({
          query: args.query,
          folder: result.folder,
          total: result.total,
          count: result.emails.length,
          emails: result.emails,
        });
      } catch (err: any) {
        return errorResult(err?.message || String(err));
      }
    }
  );

  registerTool(
    server,
    'send_email',
    {
      title: 'Gửi email',
      description:
        'Gửi email qua SMTP. Hỗ trợ To/Cc/Bcc, nội dung dạng text hoặc HTML, và file đính kèm (base64).',
      inputSchema: sendEmailSchema,
    },
    async (args: z.infer<typeof sendEmailSchema>) => {
      try {
        if (!args.to.trim()) return errorResult('Thiếu địa chỉ người nhận (to)');
        if (!args.subject.trim() && !args.text && !args.html) return errorResult('Email phải có tiêu đề hoặc nội dung');
        const cfg = await getMailConfig();
        const result = await sendEmail(cfg, args);
        return textResult({
          message: 'Email đã được gửi thành công',
          messageId: result.messageId,
          accepted: result.accepted,
          rejected: result.rejected,
        });
      } catch (err: any) {
        return errorResult(err?.message || String(err));
      }
    }
  );

  registerTool(
    server,
    'get_attachment',
    {
      title: 'Tải file đính kèm',
      description:
        'Tải nội dung một file đính kèm của email dưới dạng base64 (dùng partId lấy từ read_email).',
      inputSchema: getAttachmentSchema,
    },
    async (args: z.infer<typeof getAttachmentSchema>) => {
      try {
        const cfg = await getMailConfig();
        const result = await getAttachment(cfg, args.uid, args.partId, args.folder);
        return textResult(result);
      } catch (err: any) {
        return errorResult(err?.message || String(err));
      }
    }
  );

  registerTool(
    server,
    'get_account_info',
    {
      title: 'Thông tin tài khoản',
      description:
        'Trả về thông tin tài khoản email đang cấu hình (người dùng, máy chủ) và danh sách thư mục IMAP kèm số tin nhắn / chưa đọc.',
      inputSchema: z.object({}),
    },
    async (args: z.infer<z.ZodObject<{}>>) => {
      try {
        const cfg = await getMailConfig();
        const folders = await listMailboxes(cfg);
        return textResult({
          account: cfg.imapUser,
          imapHost: cfg.imapHost,
          imapPort: cfg.imapPort,
          smtpHost: cfg.smtpHost,
          smtpPort: cfg.smtpPort,
          from: cfg.from,
          folders,
        });
      } catch (err: any) {
        return errorResult(err?.message || String(err));
      }
    }
  );

  registerTool(
    server,
    'mark_email_read',
    {
      title: 'Đánh dấu đã đọc',
      description:
        'Đánh dấu email là đã đọc hoặc chưa đọc (cờ \\Seen) theo UID.',
      inputSchema: z.object({
        uid: z.number().int().positive().describe('UID của email'),
        seen: z
          .boolean()
          .optional()
          .describe('true = đánh dấu đã đọc, false = chưa đọc. Mặc định true'),
        folder: folderSchema,
      }),
    },
    async (args: any) => {
      try {
        const cfg = await getMailConfig();
        const result = await setEmailSeen(cfg, args.uid, args.seen !== false, args.folder);
        return textResult(result);
      } catch (err: any) {
        return errorResult(err?.message || String(err));
      }
    }
  );

  return server;
}

/** Chạy MCP server qua stdio (dùng cho Claude Desktop, VS Code Copilot, …) */
export async function runStdio(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    '[email-mcp] Đã kết nối stdio. Tools sẵn sàng: list_emails, read_email, search_emails, send_email, get_attachment, get_account_info\n'
  );
}

export interface McpClientHandle {
  client: Client;
  close: () => Promise<void>;
}

/** Tạo MCP client in-memory nối tới MCP server — dùng cho web app */
export async function createInMemoryClient(): Promise<McpClientHandle> {
  const server = createMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client(
    { name: 'email-mcp-web', version: '1.0.0' },
    { capabilities: {} }
  );
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    close: async () => {
      await client.close().catch(() => {});
      await server.close().catch(() => {});
    },
  };
}

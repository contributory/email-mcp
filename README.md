# ✉️ Mail MCP — Xem & Gửi Email qua MCP Server

Ứng dụng email đầy đủ: **MCP server** (chuẩn [Model Context Protocol](https://modelcontextprotocol.io)) để xem/gửi email qua IMAP/SMTP + **Web UI** hiện đại để dùng trên trình duyệt. Web UI gọi **MCP server qua in-memory MCP client**, và cùng MCP server đó có thể kết nối với Claude Desktop, VS Code Copilot, hay bất kỳ MCP client nào qua stdio.

## ✨ Tính năng

### MCP Server (6 tools)
| Tool | Mô tả |
|---|---|
| `list_emails` | Liệt kê email (thư mục, giới hạn, từ ngày) kèm đoạn trích nội dung |
| `read_email` | Đọc chi tiết email: text/HTML, CC/BCC, danh sách file đính kèm |
| `search_emails` | Tìm kiếm theo người gửi / người nhận / tiêu đề / nội dung |
| `send_email` | Gửi email qua SMTP (To/Cc/Bcc, HTML, đính kèm base64) |
| `get_attachment` | Tải nội dung file đính kèm (base64) |
| `get_account_info` | Thông tin tài khoản + danh sách thư mục & số chưa đọc |
| `mark_email_read` | Đánh dấu đã đọc / chưa đọc |

### Web UI (Vietnamese)
- 📥 **Inbox** 3 cột: thư mục + danh sách email + khung đọc, dark/light mode tự động
- 📖 **Đọc email**: render HTML an toàn (sanitize XSS), text/plain, tải file đính kèm
- ✍️ **Soạn email**: editor định dạng (B/I/U/list/trích dẫn/link), đính kèm file, reply/reply-all/forward
- 🔍 **Tìm kiếm** với debounce, đánh dấu đã đọc tự động
- ⚙️ **Cấu hình qua biến môi trường** — hiển thị hướng dẫn ngay trên UI khi thiếu cấu hình

## 🚀 Cài đặt

```bash
npm install
npm run build
```

## ▶️ Chạy

### 1. Web UI (kèm MCP server nội bộ)

```bash
npm start            # hoặc: npm run dev (hot reload)
# Mở http://localhost:3000 — nhớ đặt biến môi trường IMAP/SMTP trước (xem .env.example)
```

### 2. MCP server qua stdio (cho Claude Desktop, VS Code Copilot…)

```bash
npm run mcp          # hoặc: node dist/index.js
```

Ví dụ cấu hình `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "email-mcp": {
      "command": "node",
      "args": ["/duong/dan/tuyet-doi/to/email-mcp/dist/index.js"]
    }
  }
}
```

Hoặc cài toàn cục: `npm link` rồi dùng `mcp-email`.

## ⚙️ Cấu hình tài khoản

Toàn bộ cấu hình lấy từ **biến môi trường** (local dùng file `.env`, EdgeOne dùng dashboard). Không có cách nhập/lưu cấu hình qua Web UI.

1. Copy `.env.example` → `.env` và điền thông tin (local), hoặc
2. Đặt biến môi trường trong dashboard EdgeOne Pages (deploy)

| Biến | Mô tả | Mặc định |
|---|---|---|
| `IMAP_HOST` / `IMAP_PORT` / `IMAP_SECURE` | Máy chủ IMAP | imap.gmail.com / 993 / true |
| `IMAP_USER` / `IMAP_PASSWORD` | Tài khoản IMAP | — |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` | Máy chủ SMTP | smtp.gmail.com / 465 / true |
| `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM` | Tài khoản SMTP & địa chỉ From | = IMAP |
| `PORT` | Cổng Web UI | 3000 |

> 💡 **Gmail**: bật *2 bước xác minh* rồi tạo *App password* tại myaccount.google.com/apppasswords — không dùng mật khẩu đăng nhập thường.

Khi thiếu cấu hình, Web UI hiển thị banner hướng dẫn đặt biến môi trường rồi tải lại trang — nhất quán trên cả Node.js local lẫn EdgeOne Pages (không cần filesystem, không cần KV).

## 🔌 Kết nối MCP từ xa qua HTTP (`/mcp`)

Web app (local lẫn EdgeOne) mở sẵn endpoint **MCP Streamable HTTP** tại `/mcp` —
trả lời **JSON-RPC thuần** (không cần SSE), giúp Claude Desktop, Cursor, Claude Code…
kết nối trực tiếp tới bản deploy:

```json
{
  "mcpServers": {
    "email": {
      "type": "http",
      "url": "https://<project>.edgeone.app/mcp"
    }
  }
}
```

Luồng chuẩn (JSON-RPC qua POST): `initialize` → `notifications/initialized` →
`tools/list` → `tools/call`. Server tự chèn header `Accept` cần thiết nên client nào
cũng gọi được; mỗi session có `Mcp-Session-Id` riêng (tự dọn khi đóng).

## 🚀 Deploy lên EdgeOne Pages

```bash
npm run deploy        # EdgeOne Pages — cần đã đăng nhập `edgeone login` (hoặc token trong .edgeone/.token)
npm run deploy:ci     # Dành cho CI: dùng token qua biến môi trường EDGEONE_PAGES_API_TOKEN
```

1. Trong bảng điều khiển EdgeOne Pages → Settings, đặt các **biến môi trường**:
   `IMAP_HOST`, `IMAP_PORT`, `IMAP_USER`, `IMAP_PASSWORD`, `SMTP_HOST`, `SMTP_PORT`,
   `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` (xem `.env.example`)
2. Deploy: thư mục `functions/` là entry EdgeOne (`functions/index.tsx` gọi `src/edgeone.ts`), `public/` là file tĩnh
3. Kiểm tra type-check trước khi deploy: `npm run typecheck:functions`


## 🗂️ Cấu trúc dự án

```
src/
├── config.ts          # Cấu hình từ biến môi trường + mask mật khẩu
├── mcp-http.ts        # Endpoint /mcp: MCP Streamable HTTP (JSON-RPC, không SSE)
├── email-service.ts   # Lõi IMAP (imapflow) + SMTP (nodemailer)
├── mcp-server.ts      # MCP server: 7 tools, stdio + in-memory client
├── api-app.ts         # Hono REST API (không phụ thuộc Node — chạy được trên EdgeOne)
├── web-server.ts      # Node web server: SPA + serve static (chỉ dùng local)
├── edgeone.ts         # Entry EdgeOne Functions: phục vụ API + file tĩnh
└── index.ts           # CLI: `mcp-email` (stdio) | `mcp-email web` (port 3000)
public/                # Web UI: index.html + style.css + app.js
functions/             # EdgeOne Pages entry: index.tsx → src/edgeone.ts
```

## 🔌 API Web (REST)

| Endpoint | Mô tả |
|---|---|
| `GET /api/health` | Kiểm tra MCP server |
| `GET /api/account` | Tài khoản + thư mục |
| `GET /api/emails?folder=&limit=` | Danh sách email |
| `GET /api/emails/:uid?folder=` | Chi tiết email |
| `GET /api/emails/:uid/attachment/:partId` | Tải file đính kèm |
| `POST /api/emails/:uid/read` | Đánh dấu đã đọc |
| `GET /api/search?q=&folder=` | Tìm kiếm |
| `POST /api/send` | Gửi email |

## 🔐 Bảo mật

- HTML email được **sanitize** (chặn script, iframe, `on*`, `javascript:`…) trước khi render
- Cấu hình chỉ lấy từ biến môi trường: file `.env` đã được gitignore (chỉ dùng cho máy cá nhân); trên EdgeOne biến môi trường được bảo vệ bởi quyền truy cập platform

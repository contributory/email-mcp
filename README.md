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
- ⚙️ **Cài đặt tài khoản** trực quan trên UI + kiểm tra kết nối

## 🚀 Cài đặt

```bash
npm install
npm run build
```

## ▶️ Chạy

### 1. Web UI (kèm MCP server nội bộ)

```bash
npm start            # hoặc: npm run dev (hot reload)
# Mở http://localhost:3000 — lần đầu sẽ tự mở hộp thoại cấu hình tài khoản
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

Có 2 cách (cách sau ghi đè cách trước):

1. **File `.env`** — copy từ `.env.example` và điền thông tin
2. **Web UI → Cài đặt** — lưu vào settings store (xem bên dưới)

| Biến | Mô tả | Mặc định |
|---|---|---|
| `IMAP_HOST` / `IMAP_PORT` / `IMAP_SECURE` | Máy chủ IMAP | imap.gmail.com / 993 / true |
| `IMAP_USER` / `IMAP_PASSWORD` | Tài khoản IMAP | — |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` | Máy chủ SMTP | smtp.gmail.com / 465 / true |
| `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM` | Tài khoản SMTP & địa chỉ From | = IMAP |
| `PORT` | Cổng Web UI | 3000 |
| `SETTINGS_FILE` | Đường dẫn file cài đặt (Node) | .mail-settings.json |

> 💡 **Gmail**: bật *2 bước xác minh* rồi tạo *App password* tại myaccount.google.com/apppasswords — không dùng mật khẩu đăng nhập thường.

### Nơi lưu cài đặt (settings store) — tự chọn backend

`src/config.ts` tự động chọn nơi lưu theo môi trường chạy:

| Môi trường | Backend | Chi tiết |
|---|---|---|
| **Node.js local / MCP stdio** | File `fs` | `.mail-settings.json` trong thư mục dự án (đổi qua `SETTINGS_FILE`) |
| **EdgeOne Pages (không có KV)** | **Biến môi trường** | Cấu hình đặt trong dashboard EdgeOne (`IMAP_HOST`, `IMAP_USER`, `IMAP_PASSWORD`…) — không cần filesystem, không cần KV |
| **EdgeOne Pages (có KV)** | **KV binding `my_kv`** | Key `mail-mcp:settings` — tùy chọn, chỉ cần nếu muốn lưu cài đặt qua Web UI |

Trên EdgeOne không cần KV: Web UI hiển thị form **chỉ đọc** kèm thông báo đặt cấu hình qua
biến môi trường; mọi nỗ lực lưu qua UI đều trả về hướng dẫn rõ ràng.

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
npm run deploy        # EdgeOne Pages (đã có sẵn cấu hình deploy)
```

1. Trong bảng điều khiển EdgeOne Pages → Settings, đặt các **biến môi trường**:
   `IMAP_HOST`, `IMAP_PORT`, `IMAP_USER`, `IMAP_PASSWORD`, `SMTP_HOST`, `SMTP_PORT`,
   `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` (xem `.env.example`)
2. *(Tùy chọn)* Tạo KV namespace và bind `my_kv` nếu muốn đổi cấu hình qua Web UI
3. Deploy: thư mục `functions/` là entry EdgeOne (`functions/index.tsx` gọi `src/edgeone.ts`), `public/` là file tĩnh


## 🗂️ Cấu trúc dự án

```
src/
├── config.ts          # Cấu hình env + settings store (tự chọn fs/KV) + mask mật khẩu
├── mcp-http.ts        # Endpoint /mcp: MCP Streamable HTTP (JSON-RPC, không SSE)
├── storage.ts         # Tầng lưu trữ: backend KV (EdgeOne) + backend file (Node)
├── email-service.ts   # Lõi IMAP (imapflow) + SMTP (nodemailer)
├── mcp-server.ts      # MCP server: 7 tools, stdio + in-memory client
├── api-app.ts         # Hono REST API (không phụ thuộc Node — chạy được trên EdgeOne)
├── web-server.ts      # Node web server: SPA + serve static (chỉ dùng local)
├── edgeone.ts         # Entry EdgeOne Functions: KV binding + phục vụ file tĩnh
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
| `GET/POST /api/settings` | Xem / lưu cài đặt (mật khẩu được mask) |

## 🔐 Bảo mật

- Mật khẩu được **mask** khi trả về API (`********`)
- HTML email được **sanitize** (chặn script, iframe, `on*`, `javascript:`…) trước khi render
- File `.mail-settings.json` và `.env` đã được gitignore — mật khẩu lưu dạng văn bản thuần, chỉ dùng cho máy cá nhân; trên EdgeOne cài đặt nằm trong KV `my_kv` (được bảo vệ bởi quyền truy cập platform)

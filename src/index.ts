#!/usr/bin/env node
import { runStdio } from './mcp-server.js';
import { startWeb } from './web-server.js';

async function main() {
  const mode = process.argv[2] || 'stdio';

  if (mode === 'web' || mode === 'serve') {
    await startWeb();
  } else if (mode === 'stdio' || mode === 'mcp') {
    await runStdio();
  } else {
    console.error(
      `Cách dùng:\n  mcp-email          → chạy MCP server (stdio)\n  mcp-email web      → chạy Web UI + API (mặc định port ${process.env.PORT || 3000})\n  mcp-email serve    → tương tự "web"`
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[email-mcp] Lỗi khởi động:', err);
  process.exit(1);
});

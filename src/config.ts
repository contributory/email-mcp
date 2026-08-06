import dotenv from 'dotenv';

dotenv.config();

export interface MailConfig {
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  imapUser: string;
  imapPass: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass: string;
  from: string;
}

function num(v: string | undefined, fallback: number): number {
  const n = parseInt(v || '', 10);
  return Number.isFinite(n) ? n : fallback;
}

function bool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined || v === '') return fallback;
  return v === '1' || v.toLowerCase() === 'true' || v.toLowerCase() === 'yes';
}

/* ═══════════════════════════════════════════════════════════
   Overlay biến môi trường cho edge runtime (EdgeOne / Workers).
   Trên edge, biến môi trường nằm ở `context.env` chứ KHÔNG phải
   `process.env` (process.env có thể không tồn tại hoặc read-only).
   Entry EdgeOne gọi `setEnvOverlay(context.env)` ở mỗi request để
   `envConfig()` đọc được. Local Node vẫn dùng process.env như cũ.
   ═══════════════════════════════════════════════════════════ */
let envOverlay: Record<string, string> = {};

/** Nạp biến môi trường từ context.env (EdgeOne) — chỉ giữ giá trị chuỗi */
export function setEnvOverlay(env: Record<string, any> | null | undefined): void {
  if (!env) {
    envOverlay = {};
    return;
  }
  const next: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === 'string') next[k] = v;
  }
  envOverlay = next;
}

/** Đọc biến môi trường: overlay (edge) ưu tiên, fallback về process.env (Node) */
function readEnv(key: string): string | undefined {
  if (key in envOverlay) return envOverlay[key];
  return typeof process !== 'undefined' ? process.env?.[key] : undefined;
}

/* ═══════════════════════════════════════════════════════════
   Cấu hình email LUÔN LUÔN lấy từ biến môi trường.
   - Local / MCP stdio: đọc từ process.env (và file .env qua dotenv)
   - EdgeOne Pages: đọc từ context.env (nạp qua setEnvOverlay)
   Không có nơi lưu cài đặt qua UI — mọi thứ đến từ env vars.
   ═══════════════════════════════════════════════════════════ */

/** Cấu hình hiệu lực từ biến môi trường (mặc định hướng tới Gmail) */
export function getMailConfig(): MailConfig {
  return {
    imapHost: readEnv('IMAP_HOST') || 'imap.gmail.com',
    imapPort: num(readEnv('IMAP_PORT'), 993),
    imapSecure: bool(readEnv('IMAP_SECURE'), true),
    imapUser: readEnv('IMAP_USER') || '',
    imapPass: readEnv('IMAP_PASSWORD') || '',
    smtpHost: readEnv('SMTP_HOST') || 'smtp.gmail.com',
    smtpPort: num(readEnv('SMTP_PORT'), 465),
    smtpSecure: bool(readEnv('SMTP_SECURE'), true),
    smtpUser: readEnv('SMTP_USER') || readEnv('IMAP_USER') || '',
    smtpPass: readEnv('SMTP_PASSWORD') || readEnv('IMAP_PASSWORD') || '',
    from: readEnv('SMTP_FROM') || readEnv('IMAP_USER') || '',
  };
}

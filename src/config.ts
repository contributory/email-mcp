import dotenv from 'dotenv';
import {
  createEnvOnlyStore,
  createFsStore,
  createKvStore,
  type KVLike,
  type SettingsStore,
} from './storage.js';

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

const MASK = '********';

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

/** Cấu hình từ biến môi trường (mặc định hướng tới Gmail) */
export function envConfig(): MailConfig {
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

/* ═══════════════════════════════════════════════════════════
   Lựa chọn nơi lưu cài đặt:
   1. KV binding được truyền từ entry EdgeOne (setKvBinding)
   2. Global `my_kv` của EdgeOne Functions (khai báo trong functions/)
   3. File .mail-settings.json (Node.js local / MCP stdio)
   ═══════════════════════════════════════════════════════════ */

let kvBinding: KVLike | null = null;
let storePromise: Promise<SettingsStore> | null = null;
let edgeOneMode = false;

/** Gọi từ entry EdgeOne để cấp KV binding (context.env.my_kv) — có thể không có */
export function setKvBinding(kv: KVLike | null | undefined): void {
  kvBinding = kv || null;
  // Binding có thể thay đổi giữa các request — không cache store cũ
  storePromise = null;
}

/** Gọi từ entry EdgeOne để báo đang chạy trên edge runtime (không có filesystem) */
export function setEdgeOneMode(on: boolean): void {
  edgeOneMode = on;
  storePromise = null;
}

/** Trên EdgeOne và không có KV binding → cấu hình chỉ từ biến môi trường */
export function isEnvOnlyMode(): boolean {
  return edgeOneMode && !(kvBinding || getGlobalKv());
}

function getGlobalKv(): KVLike | null {
  const g = (globalThis as any).my_kv;
  return g ? (g as KVLike) : null;
}

async function getStore(): Promise<SettingsStore> {
  if (!storePromise) {
    const kv = kvBinding || getGlobalKv();
    if (kv) {
      storePromise = Promise.resolve(createKvStore(kv));
    } else if (edgeOneMode) {
      // EdgeOne không có KV → chỉ dùng biến môi trường (không đụng filesystem)
      storePromise = Promise.resolve(createEnvOnlyStore());
    } else {
      storePromise = createFsStore();
    }
  }
  return storePromise!;
}

/** Cấu hình hiệu lực: env là mặc định, settings (file/KV) ghi đè lên */
export async function getMailConfig(): Promise<MailConfig> {
  const base = envConfig();
  const stored = await (await getStore()).read();
  return stored ? { ...base, ...stored } : base;
}

/** Lưu cấu hình (password trống hoặc '********' => giữ nguyên) */
export async function saveSettings(
  patch: Partial<MailConfig>,
): Promise<MailConfig> {
  const current = await getMailConfig();
  const next: MailConfig = {
    ...current,
    ...patch,
    imapPass:
      patch.imapPass && patch.imapPass !== MASK
        ? patch.imapPass
        : current.imapPass,
    smtpPass:
      patch.smtpPass && patch.smtpPass !== MASK
        ? patch.smtpPass
        : current.smtpPass,
  };
  await (await getStore()).write(next);
  return next;
}

/** Cấu hình an toàn để trả về cho UI (che mật khẩu) */
export function maskedConfig(cfg: MailConfig) {
  return {
    ...cfg,
    imapPass: cfg.imapPass ? MASK : '',
    smtpPass: cfg.smtpPass ? MASK : '',
  };
}

export { MASK };

import type { MailConfig } from './config.js';

/* ═══════════════════════════════════════════════════════════
   Tầng lưu trữ cài đặt — hỗ trợ 2 backend:
   - KV (EdgeOne Pages / Cloudflare Workers): không có filesystem
   - fs (Node.js local / MCP stdio): file .mail-settings.json
   ═══════════════════════════════════════════════════════════ */

export interface KVLike {
  get(key: string): Promise<string | object | ArrayBuffer | ReadableStream | null>;
  put(key: string, value: string): Promise<void>;
  delete?(key: string): Promise<void>;
}

export interface SettingsStore {
  read(): Promise<Partial<MailConfig> | null>;
  write(cfg: MailConfig): Promise<void>;
}

export const SETTINGS_KV_KEY = 'mail-mcp:settings';

/** Backend KV — dùng trên EdgeOne Pages (binding `my_kv`), không cần filesystem */
export function createKvStore(kv: KVLike): SettingsStore {
  return {
    async read() {
      try {
        const raw = await kv.get(SETTINGS_KV_KEY);
        if (typeof raw !== 'string' || !raw) return null;
        return JSON.parse(raw) as Partial<MailConfig>;
      } catch {
        return null;
      }
    },
    async write(cfg) {
      await kv.put(SETTINGS_KV_KEY, JSON.stringify(cfg));
    },
  };
}

/** Backend file — dùng khi chạy local (Node.js), file .mail-settings.json */
export async function createFsStore(): Promise<SettingsStore> {
  // Import động để không làm hỏng edge runtime (nơi không có node:fs)
  const [{ default: fs }, { default: path }] = await Promise.all([
    import('node:fs'),
    import('node:path'),
  ]);
  const file =
    process.env.SETTINGS_FILE || path.join(process.cwd(), '.mail-settings.json');
  return {
    async read() {
      try {
        const raw = await fs.promises.readFile(file, 'utf-8');
        return JSON.parse(raw) as Partial<MailConfig>;
      } catch {
        return null;
      }
    },
    async write(cfg) {
      await fs.promises.writeFile(file, JSON.stringify(cfg, null, 2), 'utf-8');
    },
  };
}

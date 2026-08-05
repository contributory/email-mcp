/* Mô phỏng EdgeOne runtime: không KV, env vars nằm trong context.env */
import { setEdgeOneMode, setKvBinding, getMailConfig, saveSettings, envConfig } from '../src/config.js';
import { emailOnRequest } from '../src/edgeone.js';

async function main() {
  console.log('--- 1) Mô phỏng EdgeOne: setEdgeOneMode(true), KHÔNG KV binding ---');
  setEdgeOneMode(true);
  setKvBinding(undefined);

  // Mô phỏng context.env với biến môi trường (EdgeOne đưa vào đây, không vào process.env)
  const env = { IMAP_HOST: 'imap.example.com', IMAP_USER: 'user@example.com', IMAP_PASSWORD: 'secret' };
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === 'string') (process.env as any)[k] = v;
  }

  console.log('envConfig() →', JSON.stringify(envConfig()));
  const cfg = await getMailConfig();
  console.log('getMailConfig() →', JSON.stringify(cfg));
  console.log('imapUser =', JSON.stringify(cfg.imapUser));

  console.log('\n--- 2) saveSettings khi env-only (không KV) ---');
  try {
    await saveSettings({ imapHost: 'x.com', imapUser: 'a@b.c', imapPass: 'p' });
    console.log('saveSettings: OK (bất ngờ!)');
  } catch (e: any) {
    console.log('saveSettings throws:', e.message);
  }

  console.log('\n--- 3) Chạy emailOnRequest mô phỏng request GET /api/settings ---');
  const res = await emailOnRequest({
    request: new Request('http://localhost/api/settings'),
    params: {},
    env: { IMAP_HOST: 'imap.example.com', IMAP_USER: 'user@example.com', IMAP_PASSWORD: 'secret' },
  });
  console.log('status:', res.status);
  console.log('body:', await res.text());
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });

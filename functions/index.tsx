import type { KVNamespace } from './env';
import { emailOnRequest } from '../src/edgeone';

declare global {
  let my_kv: KVNamespace;
}

// Entry EdgeOne Pages — chuyển toàn bộ request tới ứng dụng Mail MCP.
// Cài đặt tài khoản được lưu vào KV binding `my_kv` (không dùng filesystem).
export function onRequest(context: {
  request: Request;
  params: Record<string, string>;
  env: Record<string, any>;
}): Response | Promise<Response> {
  return emailOnRequest(context);
}

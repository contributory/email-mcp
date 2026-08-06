import { emailOnRequest } from '../src/edgeone';

// Entry EdgeOne Pages — chuyển toàn bộ request tới ứng dụng Mail MCP.
// Cấu hình tài khoản LUÔN lấy từ biến môi trường (đặt trong dashboard EdgeOne).
export function onRequest(context: {
  request: Request;
  params: Record<string, string>;
  env: Record<string, any>;
}): Response | Promise<Response> {
  return emailOnRequest(context);
}

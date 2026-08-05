import {
  ImapFlow,
  type FetchMessageObject,
  type ListResponse,
  type MessageStructureObject,
} from 'imapflow';
import nodemailer from 'nodemailer';
import type { MailConfig } from './config.js';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface EmailAddress {
  name?: string;
  address?: string;
}

export interface EmailListItem {
  uid: number;
  folder: string;
  subject: string;
  from: EmailAddress | null;
  to: EmailAddress[];
  date: string | null;
  seen: boolean;
  flagged: boolean;
  hasAttachments: boolean;
  snippet: string;
  size?: number;
}

export interface AttachmentMeta {
  partId: string;
  filename: string;
  contentType: string;
  size?: number;
  inline: boolean;
}

export interface EmailDetail extends EmailListItem {
  cc: EmailAddress[];
  bcc: EmailAddress[];
  replyTo: EmailAddress[];
  messageId?: string;
  inReplyTo?: string;
  textBody: string;
  htmlBody: string;
  attachments: AttachmentMeta[];
}

export interface FolderInfo {
  path: string;
  specialUse?: string;
  messages?: number;
  unseen?: number;
}

export interface SendOptions {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  text?: string;
  html?: string;
  attachments?: Array<{
    filename: string;
    contentType?: string;
    contentBase64: string;
  }>;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function imapOptions(cfg: MailConfig) {
  return {
    host: cfg.imapHost,
    port: cfg.imapPort,
    secure: cfg.imapSecure,
    auth: { user: cfg.imapUser, pass: cfg.imapPass },
    logger: false as const,
    tls: { rejectUnauthorized: false },
    connectionTimeout: 30000,
    authTimeout: 30000,
    emitLogs: false,
  };
}

/** Chuyển lỗi IMAP/SMTP thành thông báo dễ đọc cho người dùng */
function friendlyError(err: any, host: string, port: number): Error {
  const msg = err?.message || String(err);
  const code = err?.code || '';
  if (code === 'ECONNREFUSED' || /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN/.test(msg)) {
    return new Error(`Không thể kết nối ${host}:${port} — kiểm tra máy chủ và mạng`);
  }
  if (/AUTHENTICATE|AUTHENTICATIONFAILED|LOGINDENIED|Invalid credentials|password/i.test(msg)) {
    return new Error(`Xác thực thất bại với ${host} — kiểm tra tên người dùng / mật khẩu`);
  }
  if (msg === 'Command failed') {
    return new Error(`Lệnh IMAP thất bại với ${host}:${port} — thường do sai mật khẩu hoặc thiếu quyền truy cập IMAP`);
  }
  if (/Missing credentials|no password/i.test(msg)) {
    return new Error('Chưa cấu hình tài khoản email — mở Web UI → Cài đặt hoặc điền biến môi trường IMAP_USER/IMAP_PASSWORD');
  }
  if (/greeting|timeout|Unexpected/i.test(msg)) {
    return new Error(`Máy chủ ${host}:${port} không phản hồi đúng (giao thức IMAP?)`);
  }
  return new Error(`${msg} (${host}:${port})`);
}

/** Mở kết nối IMAP kèm xử lý lỗi thân thiện */
async function imapConnect(client: ImapFlow, host: string, port: number): Promise<void> {
  try {
    await client.connect();
  } catch (err: any) {
    throw friendlyError(err, host, port);
  }
}

function decodeBuffer(buf: Buffer | undefined, charset?: string): string {
  if (!buf) return '';
  const cs = (charset || 'utf-8').toLowerCase().replace(/["']/g, '');
  const label = cs === 'utf8' ? 'utf-8' : cs;
  try {
    // TextDecoder hỗ trợ hầu hết charset phổ biến (utf-8, latin1, windows-1252…)
    return new TextDecoder(label).decode(buf);
  } catch {
    return buf.toString('utf-8');
  }
}

function partCharset(part: MessageStructureObject | undefined): string | undefined {
  return part?.parameters?.charset;
}

/** Tìm đường dẫn BODYPART của các phần thân theo loại nội dung */
function findPartPaths(
  node: MessageStructureObject,
  predicate: (p: MessageStructureObject) => boolean,
  prefix = ''
): string[] {
  if (node.childNodes && node.childNodes.length > 0) {
    const out: string[] = [];
    node.childNodes.forEach((child, i) => {
      const path = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
      out.push(...findPartPaths(child, predicate, path));
    });
    return out;
  }
  if (predicate(node)) return [prefix || node.part || '1'];
  return [];
}

function collectAttachments(node: MessageStructureObject, prefix = ''): AttachmentMeta[] {
  if (node.childNodes && node.childNodes.length > 0) {
    const out: AttachmentMeta[] = [];
    node.childNodes.forEach((child, i) => {
      const path = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
      out.push(...collectAttachments(child, path));
    });
    return out;
  }
  const filename =
    node.dispositionParameters?.filename ||
    node.parameters?.name ||
    node.parameters?.filename;
  if (!filename) return [];
  return [
    {
      partId: prefix || node.part || '1',
      filename,
      contentType: node.type || 'application/octet-stream',
      size: node.size,
      inline: (node.disposition || '') === 'inline',
    },
  ];
}

function hasAttachments(node: MessageStructureObject): boolean {
  if (node.childNodes && node.childNodes.length > 0) {
    return node.childNodes.some((c) => hasAttachments(c));
  }
  return Boolean(
    node.dispositionParameters?.filename ||
      node.parameters?.name ||
      node.parameters?.filename
  );
}

function fromList(list?: Array<{ name?: string; address?: string }>): EmailAddress[] {
  return (list || []).map((a) => ({ name: a.name || '', address: a.address || '' }));
}

function toListItem(
  msg: FetchMessageObject,
  folder: string,
  snippet: string
): EmailListItem {
  const flags = msg.flags || new Set<string>();
  const dateRaw = msg.internalDate || msg.envelope?.date;
  return {
    uid: msg.uid,
    folder,
    subject: msg.envelope?.subject || '(Không có tiêu đề)',
    from: msg.envelope?.from?.[0] || null,
    to: fromList(msg.envelope?.to),
    date: dateRaw ? new Date(dateRaw).toISOString() : null,
    seen: flags.has('\\Seen'),
    flagged: flags.has('\\Flagged'),
    hasAttachments: msg.bodyStructure ? hasAttachments(msg.bodyStructure) : false,
    snippet: snippet.slice(0, 200),
    size: msg.size,
  };
}

const SNIPPET_RE = /<[^>]*>/g;

function plainFromHtml(html: string): string {
  return html
    .replace(SNIPPET_RE, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function snippetFrom(msg: FetchMessageObject, folder: string): string {
  if (!msg.bodyParts || msg.bodyParts.size === 0) return '';
  const first = msg.bodyParts.values().next().value as Buffer | undefined;
  if (!first) return '';
  const text = decodeBuffer(first, partCharset(firstPart(msg)));
  return text.replace(SNIPPET_RE, ' ').replace(/\s+/g, ' ').trim();
}

function firstPart(msg: FetchMessageObject): MessageStructureObject {
  // Lấy part đã fetch để lấy charset — tạm xử lý qua bodyStructure
  const walk = (n: MessageStructureObject): MessageStructureObject | null => {
    if (n.childNodes && n.childNodes.length) {
      for (const c of n.childNodes) {
        const r = walk(c);
        if (r) return r;
      }
      return null;
    }
    return n;
  };
  return walk(msg.bodyStructure!) || ({} as MessageStructureObject);
}

/* ------------------------------------------------------------------ */
/* IMAP operations                                                     */
/* ------------------------------------------------------------------ */

export async function listMailboxes(cfg: MailConfig): Promise<FolderInfo[]> {
  const client = new ImapFlow(imapOptions(cfg));
  try {
    await imapConnect(client, cfg.imapHost, cfg.imapPort);
    const list = (await client.list()) as ListResponse[];
    const folders: FolderInfo[] = list.map((m) => ({
      path: m.path,
      specialUse: m.specialUse,
    }));
    // Đếm tin nhắn / chưa đọc (giới hạn để không chậm)
    const limited = folders.slice(0, 40);
    const withStatus = await Promise.all(
      limited.map(async (f) => {
        try {
          const status = await client.status(f.path, { messages: true, unseen: true });
          return { ...f, messages: status.messages, unseen: status.unseen };
        } catch {
          return f;
        }
      })
    );
    const priority = (f: FolderInfo) => {
      if (f.path.toUpperCase() === 'INBOX') return 0;
      switch ((f.specialUse || '').toLowerCase()) {
        case 'sent':
          return 1;
        case 'drafts':
          return 2;
        case 'junk':
          return 3;
        case 'trash':
          return 4;
        case 'archive':
          return 5;
        default:
          return 10;
      }
    };
    return withStatus.sort((a, b) => priority(a) - priority(b) || a.path.localeCompare(b.path));
  } finally {
    await client.logout().catch(() => {});
  }
}

interface FetchOpts {
  folder?: string;
  limit?: number;
  since?: string;
}

/** Lấy danh sách email (mới nhất trước) */
export async function listEmails(
  cfg: MailConfig,
  opts: FetchOpts = {}
): Promise<{ folder: string; total: number; emails: EmailListItem[] }> {
  const folder = opts.folder || 'INBOX';
  const limit = Math.min(opts.limit || 50, 200);
  const client = new ImapFlow(imapOptions(cfg));
  try {
    await imapConnect(client, cfg.imapHost, cfg.imapPort);
    await client.mailboxOpen(folder);
    const search = opts.since ? { since: new Date(opts.since) } : {};
    const uids = (await client.search(search, { uid: true })) || [];
    const total = uids.length;
    const recent = uids.slice(-limit);

    // Pass 1: lấy bodyStructure để xác định đường dẫn part text
    const pathsByUid = new Map<number, string[]>();
    for await (const msg of client.fetch(recent, { uid: true, bodyStructure: true }, { uid: true })) {
      if (!msg.bodyStructure) continue;
      pathsByUid.set(
        msg.uid,
        findPartPaths(
          msg.bodyStructure,
          (p) => p.type === 'text/plain' || p.type === 'text/html'
        ).slice(0, 1)
      );
    }

    // Pass 2: fetch theo nhóm path giống nhau để lấy snippet
    const emails: EmailListItem[] = [];
    const groups = new Map<string, number[]>();
    for (const [uid, paths] of pathsByUid) {
      const key = paths[0] || '';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(uid);
    }
    for (const [path, uidsForPath] of groups) {
      const query = {
        uid: true,
        envelope: true,
        flags: true,
        internalDate: true,
        size: true,
        bodyStructure: true,
        ...(path ? { bodyParts: [path] } : {}),
      };
      for await (const msg of client.fetch(uidsForPath, query, { uid: true })) {
        emails.push(toListItem(msg, folder, snippetFrom(msg, folder)));
      }
    }
    emails.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return { folder, total, emails };
  } finally {
    await client.logout().catch(() => {});
  }
}

/** Tìm kiếm email theo chuỗi (from/to/subject/body) */
export async function searchEmails(
  cfg: MailConfig,
  query: string,
  opts: FetchOpts = {}
): Promise<{ folder: string; total: number; emails: EmailListItem[] }> {
  const folder = opts.folder || 'INBOX';
  const limit = Math.min(opts.limit || 50, 200);
  const client = new ImapFlow(imapOptions(cfg));
  try {
    await imapConnect(client, cfg.imapHost, cfg.imapPort);
    await client.mailboxOpen(folder);
    const criteria: any = {
      or: [{ subject: query }, { from: query }, { to: query }, { body: query }],
    };
    const uids = (await client.search(criteria, { uid: true })) || [];
    const recent = uids.slice(-limit);

    const emails: EmailListItem[] = [];
    const query2 = {
      uid: true,
      envelope: true,
      flags: true,
      internalDate: true,
      size: true,
      bodyStructure: true,
      bodyParts: ['1'],
    };
    for await (const msg of client.fetch(recent, query2, { uid: true })) {
      emails.push(toListItem(msg, folder, snippetFrom(msg, folder)));
    }
    emails.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return { folder, total: uids.length, emails };
  } finally {
    await client.logout().catch(() => {});
  }
}

/** Đọc chi tiết một email */
export async function getEmail(
  cfg: MailConfig,
  uid: number,
  folder = 'INBOX'
): Promise<EmailDetail> {
  const client = new ImapFlow(imapOptions(cfg));
  try {
    await imapConnect(client, cfg.imapHost, cfg.imapPort);
    await client.mailboxOpen(folder);
    const msg = await client.fetchOne(
      uid,
      {
        uid: true,
        envelope: true,
        flags: true,
        internalDate: true,
        size: true,
        bodyStructure: true,
        bodyParts: ['1', '2'],
      },
      { uid: true }
    );
    if (!msg) throw new Error(`Không tìm thấy email UID ${uid} trong ${folder}`);

    // Xác định path của text/plain và text/html
    const bst = msg.bodyStructure;
    let plainPath = '';
    let htmlPath = '';
    if (bst) {
      plainPath =
        findPartPaths(bst, (p) => p.type === 'text/plain')[0] || '';
      htmlPath =
        findPartPaths(bst, (p) => p.type === 'text/html')[0] || '';
    }
    if (!plainPath && !htmlPath) plainPath = '1';

    // Fetch đúng 2 phần thân
    const paths = Array.from(new Set([plainPath, htmlPath].filter(Boolean)));
    let plain = '';
    let html = '';
    if (paths.length) {
      const full = await client.fetchOne(
        uid,
        { uid: true, bodyStructure: true, bodyParts: paths },
        { uid: true }
      );
      if (full && full.bodyParts) {
        if (plainPath && full.bodyParts.has(plainPath)) {
          plain = decodeBuffer(
            full.bodyParts.get(plainPath),
            partCharset(findPart(bst, plainPath))
          );
        }
        if (htmlPath && full.bodyParts.has(htmlPath)) {
          html = decodeBuffer(
            full.bodyParts.get(htmlPath),
            partCharset(findPart(bst, htmlPath))
          );
        }
      }
    }

    return {
      ...toListItem(msg, folder, plain || plainFromHtml(html)),
      cc: fromList(msg.envelope?.cc),
      bcc: fromList(msg.envelope?.bcc),
      replyTo: fromList(msg.envelope?.replyTo),
      messageId: msg.envelope?.messageId,
      inReplyTo: msg.envelope?.inReplyTo,
      textBody: plain,
      htmlBody: html,
      attachments: bst ? collectAttachments(bst) : [],
    };
  } finally {
    await client.logout().catch(() => {});
  }
}

/** Lấy nội dung một attachment theo BODYPART */
export async function getAttachment(
  cfg: MailConfig,
  uid: number,
  partId: string,
  folder = 'INBOX'
): Promise<{ filename: string; contentType: string; size: number; contentBase64: string }> {
  const client = new ImapFlow(imapOptions(cfg));
  try {
    await imapConnect(client, cfg.imapHost, cfg.imapPort);
    await client.mailboxOpen(folder);
    const msg = await client.fetchOne(
      uid,
      { uid: true, bodyStructure: true, bodyParts: [partId] },
      { uid: true }
    );
    if (!msg || !msg.bodyParts || !msg.bodyParts.has(partId)) {
      throw new Error(`Không tìm thấy phần ${partId} của email UID ${uid}`);
    }
    const part = findPart(msg.bodyStructure, partId);
    const buf = msg.bodyParts.get(partId)!;
    return {
      filename:
        part?.dispositionParameters?.filename ||
        part?.parameters?.name ||
        `attachment-${partId}`,
      contentType: part?.type || 'application/octet-stream',
      size: buf.length,
      contentBase64: buf.toString('base64'),
    };
  } finally {
    await client.logout().catch(() => {});
  }
}

function findPart(
  node: MessageStructureObject | undefined,
  path: string
): MessageStructureObject | undefined {
  if (!node) return undefined;
  if (node.part === path) return node;
  if (node.childNodes) {
    for (const c of node.childNodes) {
      const r = findPart(c, path);
      if (r) return r;
    }
  }
  return undefined;
}

/** Đánh dấu email đã đọc (hoặc bỏ đánh dấu) */
export async function setEmailSeen(
  cfg: MailConfig,
  uid: number,
  seen: boolean,
  folder = 'INBOX'
): Promise<{ uid: number; seen: boolean }> {
  const client = new ImapFlow(imapOptions(cfg));
  try {
    await imapConnect(client, cfg.imapHost, cfg.imapPort);
    await client.mailboxOpen(folder);
    if (seen) {
      await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
    } else {
      await client.messageFlagsRemove(uid, ['\\Seen'], { uid: true });
    }
    return { uid, seen };
  } finally {
    await client.logout().catch(() => {});
  }
}

/* ------------------------------------------------------------------ */
/* SMTP                                                                */
/* ------------------------------------------------------------------ */

export async function sendEmail(
  cfg: MailConfig,
  opts: SendOptions
): Promise<{ messageId: string; accepted: string[]; rejected: string[] }> {
  const transporter = nodemailer.createTransport({
    host: cfg.smtpHost,
    port: cfg.smtpPort,
    secure: cfg.smtpSecure,
    auth: { user: cfg.smtpUser, pass: cfg.smtpPass },
    tls: { rejectUnauthorized: false },
    connectionTimeout: 30000,
    greetingTimeout: 30000,
  });
  let info;
  try {
    info = await transporter.sendMail({
      from: cfg.from || cfg.smtpUser,
      to: opts.to,
      cc: opts.cc || undefined,
      bcc: opts.bcc || undefined,
      subject: opts.subject,
      text: opts.text || undefined,
      html: opts.html || undefined,
      attachments: (opts.attachments || []).map((a) => ({
        filename: a.filename,
        contentType: a.contentType,
        content: Buffer.from(a.contentBase64, 'base64'),
      })),
    });
  } catch (err: any) {
    throw friendlyError(err, cfg.smtpHost, cfg.smtpPort);
  }
  return {
    messageId: info.messageId || '',
    accepted: (info.accepted || []).map((a) => String(a)),
    rejected: (info.rejected || []).map((a) => String(a)),
  };
}

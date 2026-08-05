/* ═══════════════════════════════════════════════════════════
   Mail MCP — Web UI logic
   Giao tiếp với backend qua REST API, backend gọi MCP server
   ═══════════════════════════════════════════════════════════ */

'use strict';

/* ------------------------- State ------------------------- */

const state = {
  account: null,
  folders: [],
  emails: [],
  folder: 'INBOX',
  search: '',
  selectedUid: null,
  detail: null,
  composeAttachments: [],
  sending: false,
};

/* ------------------------- Helpers ------------------------- */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

let toastTimer = null;
function toast(msg, type = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3200);
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function initials(name, address) {
  const src = (name || address || '?').trim();
  const parts = src.split(/[\s@.]+/).filter(Boolean);
  let out = '';
  for (const p of parts) {
    out += p[0];
    if (out.length >= 2) break;
  }
  return (out || '?').toUpperCase().slice(0, 2);
}

const AVATAR_COLORS = [
  ['#6366f1', '#8b5cf6'],
  ['#0ea5e9', '#6366f1'],
  ['#10b981', '#0ea5e9'],
  ['#f59e0b', '#ef4444'],
  ['#ec4899', '#8b5cf6'],
  ['#14b8a6', '#22c55e'],
];

function avatarColor(key) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

const MONTHS_VI = [
  'thg 1', 'thg 2', 'thg 3', 'thg 4', 'thg 5', 'thg 6',
  'thg 7', 'thg 8', 'thg 9', 'thg 10', 'thg 11', 'thg 12',
];

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  if (d.getFullYear() === now.getFullYear()) {
    return `${d.getDate()} ${MONTHS_VI[d.getMonth()]}`;
  }
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

function fmtSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function displayName(addr) {
  if (!addr) return 'Không rõ';
  return addr.name || addr.address || 'Không rõ';
}

function senderLabel(addr) {
  if (!addr) return 'Không rõ';
  if (addr.name && addr.name !== addr.address) return addr.name;
  return addr.address || 'Không rõ';
}

function folderLabel(path) {
  const map = {
    INBOX: ['📥', 'Hộp thư đến'],
    Sent: ['📤', 'Đã gửi'],
    Drafts: ['📝', 'Nháp'],
    Trash: ['🗑️', 'Thùng rác'],
    Junk: ['⚠️', 'Spam'],
    Archive: ['🗄️', 'Lưu trữ'],
  };
  if (map[path]) return map[path];
  const lower = path.toLowerCase();
  if (lower.includes('sent')) return ['📤', path];
  if (lower.includes('draft')) return ['📝', path];
  if (lower.includes('trash') || lower.includes('deleted')) return ['🗑️', path];
  if (lower.includes('junk') || lower.includes('spam')) return ['⚠️', path];
  if (lower.includes('archive')) return ['🗄️', path];
  return ['📁', path];
}

/* ------------------------- Sanitize HTML ------------------------- */

const ALLOWED_TAGS = new Set([
  'a', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'p', 'br', 'div', 'span',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre',
  'code', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img', 'hr', 'font',
  'small', 'sub', 'sup', 'center', 'abbr', 'cite', 'q', 'mark',
]);

function sanitizeHtml(input) {
  if (!input) return '';
  const doc = new DOMParser().parseFromString(input, 'text/html');
  const walk = (node) => {
    for (const el of Array.from(node.children || [])) {
      if (!ALLOWED_TAGS.has(el.tagName.toLowerCase())) {
        // Thay thế thẻ không cho phép bằng nội dung bên trong
        el.replaceWith(...Array.from(el.childNodes));
        continue;
      }
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        if (name.startsWith('on')) {
          el.removeAttribute(attr.name);
        } else if (name === 'href' || name === 'src') {
          const v = (attr.value || '').trim().toLowerCase();
          const ok =
            name === 'href'
              ? /^(https?:|mailto:)/.test(v)
              : /^(https?:|data:image\/)/.test(v);
          if (!ok) el.removeAttribute(attr.name);
        } else if (name === 'style') {
          const v = (attr.value || '')
            .replace(/url\s*\(/gi, 'none(')
            .replace(/expression\s*\(/gi, 'none(')
            .replace(/javascript:/gi, 'none:');
          el.setAttribute(name, v);
        } else if (!['alt', 'width', 'height', 'target', 'rel', 'class', 'border', 'colspan', 'rowspan', 'cellpadding', 'cellspacing', 'align', 'bgcolor', 'color', 'face', 'size'].includes(name)) {
          el.removeAttribute(attr.name);
        }
      }
      if (el.tagName.toLowerCase() === 'a') {
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noopener noreferrer');
      }
      walk(el);
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

/* ------------------------- Account & Folders ------------------------- */

async function loadAccount() {
  try {
    const data = await api('/api/account');
    state.account = data;
    state.folders = data.folders || [];
    renderAccount();
    renderFolders();
    $('#setupBanner').classList.add('hidden');
    $('#mcpBadge').classList.remove('error');
  } catch (err) {
    state.account = null;
    state.folders = [];
    renderAccount();
    renderFolders();
    $('#setupBanner').classList.remove('hidden');
    $('#mcpBadge').classList.add('error');
    $('#mcpBadge').title = `Lỗi kết nối: ${err.message}`;
    // Nếu đang mở settings modal thì hiển thị lỗi
    if (!$('#settingsModal').classList.contains('hidden')) {
      toast(`Kiểm tra kết nối thất bại: ${err.message}`, 'error');
    }
  }
}

function renderAccount() {
  const acc = state.account;
  const nameEl = $('#accountName');
  const hostEl = $('#accountHost');
  const avatarEl = $('#accountAvatar');
  if (!acc) {
    nameEl.textContent = 'Chưa cấu hình';
    hostEl.textContent = 'Mở Cài đặt để bắt đầu';
    avatarEl.textContent = '—';
    avatarEl.style.background = '';
    return;
  }
  nameEl.textContent = acc.account || acc.from || '—';
  hostEl.textContent = `${acc.imapHost}:${acc.imapPort}`;
  avatarEl.textContent = initials(acc.account, acc.account);
  avatarEl.style.background = 'linear-gradient(135deg, #5b5bd6, #8b5cf6)';
}

function renderFolders() {
  const list = $('#folderList');
  list.innerHTML = '';
  if (!state.folders.length) {
    const empty = document.createElement('div');
    empty.className = 'folder-item muted small';
    empty.textContent = '—';
    list.appendChild(empty);
    return;
  }
  for (const f of state.folders) {
    const [icon, label] = folderLabel(f.path);
    const btn = document.createElement('button');
    btn.className = 'folder-item' + (f.path === state.folder ? ' active' : '');
    btn.dataset.folder = f.path;
    btn.innerHTML = `
      <span class="folder-icon">${icon}</span>
      <span class="folder-name">${escapeHtml(label)}</span>
      ${f.unseen ? `<span class="folder-badge">${f.unseen}</span>` : ''}
    `;
    btn.addEventListener('click', () => {
      state.folder = f.path;
      state.search = '';
      $('#searchInput').value = '';
      loadEmails();
      if (window.innerWidth <= 720) document.body.classList.remove('reader-open');
    });
    list.appendChild(btn);
  }
}

/* ------------------------- Email list ------------------------- */

async function loadEmails() {
  const listEl = $('#emailList');
  const emptyEl = $('#listEmpty');
  const loadingEl = $('#listLoading');
  listEl.innerHTML = '';
  emptyEl.classList.add('hidden');
  loadingEl.classList.remove('hidden');

  try {
    let data;
    if (state.search.trim()) {
      data = await api(
        `/api/search?q=${encodeURIComponent(state.search.trim())}&folder=${encodeURIComponent(state.folder)}&limit=100`
      );
    } else {
      data = await api(`/api/emails?folder=${encodeURIComponent(state.folder)}&limit=100`);
    }
    state.emails = data.emails || [];
    const [icon, label] = folderLabel(state.folder);
    $('#folderTitle').textContent = state.search.trim() ? 'Kết quả tìm kiếm' : label;
    $('#emailCount').textContent =
      data.total > state.emails.length
        ? `${state.emails.length}/${data.total}`
        : state.search.trim()
          ? `${state.emails.length} kết quả`
          : `${state.emails.length} email`;
    renderEmails();
  } catch (err) {
    state.emails = [];
    $('#emailCount').textContent = '';
    renderEmails();
    toast(err.message, 'error');
  } finally {
    loadingEl.classList.add('hidden');
  }
}

function renderEmails() {
  const listEl = $('#emailList');
  const emptyEl = $('#listEmpty');
  listEl.innerHTML = '';
  if (!state.emails.length) {
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');

  for (const email of state.emails) {
    const row = document.createElement('div');
    const isActive = email.uid === state.selectedUid;
    const [c1, c2] = avatarColor((email.from?.address || email.from?.name || '?'));
    row.className = `email-row ${email.seen ? '' : 'unread'} ${isActive ? 'active' : ''}`;
    row.dataset.uid = email.uid;
    row.innerHTML = `
      ${email.seen ? '' : '<span class="unread-dot"></span>'}
      <div class="email-avatar" style="background:linear-gradient(135deg, ${c1}, ${c2})">
        ${escapeHtml(initials(email.from?.name, email.from?.address))}
      </div>
      <div class="email-main">
        <div class="email-top">
          <span class="email-sender">${escapeHtml(senderLabel(email.from))}</span>
          <span class="email-date">${fmtDate(email.date)}</span>
        </div>
        <div class="email-subject">
          ${email.hasAttachments ? '<span class="attach-flag">📎</span> ' : ''}
          ${escapeHtml(email.subject)}
        </div>
        <div class="email-snippet">${escapeHtml(email.snippet || '')}</div>
      </div>
    `;
    row.addEventListener('click', () => openEmail(email.uid));
    listEl.appendChild(row);
  }
}

/* ------------------------- Reader ------------------------- */

async function openEmail(uid) {
  state.selectedUid = uid;
  $$('.email-row').forEach((r) =>
    r.classList.toggle('active', Number(r.dataset.uid) === uid)
  );
  $('#readerEmpty').classList.add('hidden');
  $('#readerContent').classList.remove('hidden');
  $('#readerContent').innerHTML = '<div class="empty loading">Đang tải email…</div>';

  if (window.innerWidth <= 720) document.body.classList.add('reader-open');

  try {
    const detail = await api(`/api/emails/${uid}?folder=${encodeURIComponent(state.folder)}`);
    state.detail = detail;
    renderReader(detail);
    // Đánh dấu đã đọc nếu chưa đọc
    if (!detail.seen) {
      const item = state.emails.find((e) => e.uid === uid);
      if (item) item.seen = true;
      renderEmails();
      api(`/api/emails/${uid}/read`, { method: 'POST', body: JSON.stringify({ seen: true, folder: state.folder }) }).catch(() => {});
    }
  } catch (err) {
    $('#readerContent').innerHTML = `<div class="empty">Không thể tải email: ${escapeHtml(err.message)}</div>`;
  }
}

function renderReader(email) {
  const el = $('#readerContent');
  const [c1, c2] = avatarColor(email.from?.address || email.from?.name || '?');
  const toList = (email.to || []).map((a) => `${a.name ? a.name + ' <' : ''}${a.address}${a.name ? '>' : ''}`).join(', ') || '—';
  const ccList = (email.cc || []).map((a) => a.address).join(', ');

  const attachments = (email.attachments || [])
    .filter((a) => !a.inline)
    .map(
      (a) => `
      <a class="attach-chip" href="/api/emails/${email.uid}/attachment/${encodeURIComponent(a.partId)}?folder=${encodeURIComponent(state.folder)}" title="Tải xuống ${escapeHtml(a.filename)}">
        <span>📎</span>
        <span class="attach-name">${escapeHtml(a.filename)}</span>
        <span class="muted small">${fmtSize(a.size)}</span>
      </a>`
    )
    .join('');

  const hasHtml = email.htmlBody && email.htmlBody.trim().length > 0;
  const bodyClass = hasHtml ? '' : 'text-mode';
  const bodyHtml = hasHtml
    ? sanitizeHtml(email.htmlBody)
    : escapeHtml(email.textBody || '(Không có nội dung)');

  el.innerHTML = `
    <div class="reader-header">
      <h2 class="reader-subject">${escapeHtml(email.subject)}</h2>
      <div class="reader-meta">
        <div class="email-avatar" style="background:linear-gradient(135deg, ${c1}, ${c2})">
          ${escapeHtml(initials(email.from?.name, email.from?.address))}
        </div>
        <div class="reader-sender">
          <strong>${escapeHtml(displayName(email.from))}</strong>
          <span>tới: ${escapeHtml(toList)}${ccList ? ` — Cc: ${escapeHtml(ccList)}` : ''}</span>
        </div>
        <div class="reader-date">
          ${fmtDate(email.date)}<br />
          ${escapeHtml(email.messageId ? '✓' : '')}
        </div>
      </div>
    </div>
    <div class="reader-actions">
      <button class="btn btn-ghost" data-action="reply">↩ Trả lời</button>
      <button class="btn btn-ghost" data-action="replyAll">↪ Trả lời tất cả</button>
      <button class="btn btn-ghost" data-action="forward">➡ Chuyển tiếp</button>
    </div>
    ${attachments ? `<div class="attach-list">${attachments}</div>` : ''}
    <div class="email-body ${bodyClass}">${bodyHtml}</div>
  `;

  el.querySelector('[data-action="reply"]').addEventListener('click', () => openCompose('reply', email));
  el.querySelector('[data-action="replyAll"]').addEventListener('click', () => openCompose('replyAll', email));
  el.querySelector('[data-action="forward"]').addEventListener('click', () => openCompose('forward', email));
}

/* ------------------------- Compose ------------------------- */

function openCompose(mode = 'new', email = null) {
  const modal = $('#composeModal');
  $('#toInput').value = '';
  $('#ccInput').value = '';
  $('#bccInput').value = '';
  $('#subjectInput').value = '';
  $('#composeBody').innerHTML = '';
  state.composeAttachments = [];
  renderAttachments();

  if (mode === 'reply' && email) {
    $('#composeTitle').textContent = 'Trả lời';
    $('#toInput').value = email.from?.address || '';
    $('#subjectInput').value = /^Re:\s/i.test(email.subject || '')
      ? email.subject
      : `Re: ${email.subject || ''}`;
    const quote = buildQuote(email, 'reply');
    $('#composeBody').innerHTML = `<br><br>${quote}`;
    setCaretEnd($('#composeBody'));
    $('#toInput').focus();
  } else if (mode === 'replyAll' && email) {
    $('#composeTitle').textContent = 'Trả lời tất cả';
    const to = new Set([email.from?.address, ...(email.to || []).map((a) => a.address)].filter(Boolean));
    $('#toInput').value = Array.from(to).join(', ');
    const cc = (email.cc || []).map((a) => a.address).filter(Boolean).join(', ');
    if (cc) $('#ccInput').value = cc;
    $('#subjectInput').value = /^Re:\s/i.test(email.subject || '')
      ? email.subject
      : `Re: ${email.subject || ''}`;
    $('#composeBody').innerHTML = `<br><br>${buildQuote(email, 'reply')}`;
    setCaretEnd($('#composeBody'));
    $('#toInput').focus();
  } else if (mode === 'forward' && email) {
    $('#composeTitle').textContent = 'Chuyển tiếp';
    $('#subjectInput').value = /^Fwd:\s/i.test(email.subject || '')
      ? email.subject
      : `Fwd: ${email.subject || ''}`;
    $('#composeBody').innerHTML = buildQuote(email, 'forward');
    $('#toInput').focus();
  } else {
    $('#composeTitle').textContent = 'Soạn email';
    $('#composeBody').focus();
  }

  modal.classList.remove('hidden');
}

function setCaretEnd(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  el.focus();
}

function buildQuote(email, mode) {
  const fromLine = email.from
    ? `${email.from.name ? email.from.name + ' <' : ''}${email.from.address}${email.from.name ? '>' : ''}`
    : '?';
  const dateStr = email.date ? new Date(email.date).toLocaleString('vi-VN') : '';
  const quoteText = email.textBody || stripHtml(email.htmlBody || '');
  const quoted = quoteText
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n');

  if (mode === 'forward') {
    return `<div>---------- Chuyển tiếp ----------<br>${escapeHtml(`Từ: ${fromLine}`)}<br>${escapeHtml(`Ngày: ${dateStr}`)}<br>${escapeHtml(`Chủ đề: ${email.subject || ''}`)}<br>----------<br></div><br><div>${escapeHtml(quoted)}</div>`;
  }
  return `<div>${escapeHtml(`Vào ${dateStr}, ${fromLine} đã viết:`)}<br></div><blockquote>${escapeHtml(quoted)}</blockquote>`;
}

function stripHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return (doc.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}

function renderAttachments() {
  const list = $('#attachList');
  list.classList.toggle('hidden', state.composeAttachments.length === 0);
  list.innerHTML = state.composeAttachments
    .map(
      (a, i) => `
      <span class="attach-chip">
        <span>📎</span>
        <span class="attach-name">${escapeHtml(a.filename)}</span>
        <span class="muted small">${fmtSize(a.size)}</span>
        <button class="remove-attach" data-index="${i}" title="Bỏ đính kèm">✕</button>
      </span>`
    )
    .join('');
  list.querySelectorAll('.remove-attach').forEach((btn) =>
    btn.addEventListener('click', () => {
      state.composeAttachments.splice(Number(btn.dataset.index), 1);
      renderAttachments();
    })
  );
}

function handleFileSelect(files) {
  const MAX_TOTAL = 20 * 1024 * 1024;
  const current = state.composeAttachments.reduce((s, a) => s + a.size, 0);
  for (const file of files) {
    if (current + state.composeAttachments.reduce((s, a) => s + a.size, 0) + file.size > MAX_TOTAL) {
      toast('Tổng dung lượng đính kèm tối đa 20 MB', 'error');
      break;
    }
    const reader = new FileReader();
    reader.onload = () => {
      state.composeAttachments.push({
        filename: file.name,
        contentType: file.type || 'application/octet-stream',
        size: file.size,
        contentBase64: String(reader.result).split(',')[1] || '',
      });
      renderAttachments();
    };
    reader.readAsDataURL(file);
  }
}

async function sendCompose() {
  const to = $('#toInput').value.trim();
  const subject = $('#subjectInput').value.trim();
  const editor = $('#composeBody');
  const html = editor.innerHTML.trim();
  const text = (editor.innerText || '').trim();

  if (!to) {
    toast('Vui lòng nhập địa chỉ người nhận', 'error');
    $('#toInput').focus();
    return;
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+([,;\s]+[^@\s]+@[^@\s]+\.[^@\s]+)*$/.test(to)) {
    toast('Địa chỉ email không hợp lệ', 'error');
    $('#toInput').focus();
    return;
  }
  if (!subject && !text) {
    toast('Vui lòng nhập tiêu đề hoặc nội dung', 'error');
    $('#subjectInput').focus();
    return;
  }

  if (state.sending) return;
  state.sending = true;
  $('#sendBtn').disabled = true;
  $('#sendBtnLabel').textContent = 'Đang gửi…';

  try {
    const result = await api('/api/send', {
      method: 'POST',
      body: JSON.stringify({
        to,
        cc: $('#ccInput').value.trim() || undefined,
        bcc: $('#bccInput').value.trim() || undefined,
        subject,
        text: text || undefined,
        html: html && html !== '<br>' ? html : undefined,
        attachments: state.composeAttachments.length ? state.composeAttachments : undefined,
      }),
    });
    toast(`Đã gửi email thành công ${result.messageId ? '✓' : ''}`, 'success');
    $('#composeModal').classList.add('hidden');
    // Reload danh sách để thấy email mới trong thư mục Sent/INBOX
    loadEmails();
  } catch (err) {
    toast(`Gửi thất bại: ${err.message}`, 'error');
  } finally {
    state.sending = false;
    $('#sendBtn').disabled = false;
    $('#sendBtnLabel').textContent = 'Gửi';
  }
}

/* ------------------------- Settings ------------------------- */

async function loadSettingsForm() {
  try {
    const { config } = await api('/api/settings');
    $('#sImapHost').value = config.imapHost || '';
    $('#sImapPort').value = config.imapPort || 993;
    $('#sImapSecure').checked = config.imapSecure !== false;
    $('#sImapUser').value = config.imapUser || '';
    $('#sImapPass').value = config.imapPass || '';
    $('#sSmtpHost').value = config.smtpHost || '';
    $('#sSmtpPort').value = config.smtpPort || 465;
    $('#sSmtpSecure').checked = config.smtpSecure !== false;
    $('#sSmtpUser').value = config.smtpUser || '';
    $('#sSmtpPass').value = config.smtpPass || '';
    $('#sFrom').value = config.from || '';
  } catch (err) {
    toast(`Không tải được cài đặt: ${err.message}`, 'error');
  }
}

function collectSettings() {
  return {
    imapHost: $('#sImapHost').value.trim(),
    imapPort: Number($('#sImapPort').value) || 993,
    imapSecure: $('#sImapSecure').checked,
    imapUser: $('#sImapUser').value.trim(),
    imapPass: $('#sImapPass').value,
    smtpHost: $('#sSmtpHost').value.trim(),
    smtpPort: Number($('#sSmtpPort').value) || 465,
    smtpSecure: $('#sSmtpSecure').checked,
    smtpUser: $('#sSmtpUser').value.trim(),
    smtpPass: $('#sSmtpPass').value,
    from: $('#sFrom').value.trim(),
  };
}

async function saveSettings(closeAfter = true) {
  const btn = $('#saveSettingsBtn');
  btn.disabled = true;
  btn.textContent = 'Đang lưu…';
  try {
    await api('/api/settings', { method: 'POST', body: JSON.stringify(collectSettings()) });
    toast('Đã lưu cài đặt ✓', 'success');
    if (closeAfter) $('#settingsModal').classList.add('hidden');
    await loadAccount();
    await loadEmails();
  } catch (err) {
    toast(`Lưu thất bại: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Lưu cài đặt';
  }
}

async function testConnection() {
  const btn = $('#testBtn');
  btn.disabled = true;
  btn.textContent = 'Đang kiểm tra…';
  try {
    await api('/api/settings', { method: 'POST', body: JSON.stringify(collectSettings()) });
    await api('/api/account');
    toast('Kết nối IMAP/SMTP thành công ✓', 'success');
    await loadAccount();
  } catch (err) {
    toast(`Kiểm tra thất bại: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Kiểm tra kết nối';
  }
}

/* ------------------------- Events ------------------------- */

function bindEvents() {
  $('#composeBtn').addEventListener('click', () => openCompose('new'));
  $('#setupBtn').addEventListener('click', () => {
    $('#settingsModal').classList.remove('hidden');
    loadSettingsForm();
  });
  $('#settingsBtn').addEventListener('click', () => {
    $('#settingsModal').classList.remove('hidden');
    loadSettingsForm();
  });
  $('#refreshBtn').addEventListener('click', async () => {
    $('#refreshBtn').disabled = true;
    await Promise.all([loadAccount(), loadEmails()]);
    $('#refreshBtn').disabled = false;
    toast('Đã làm mới');
  });
  $('#backBtn').addEventListener('click', () => document.body.classList.remove('reader-open'));

  // Search với debounce
  let searchTimer = null;
  $('#searchInput').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.search = e.target.value;
      loadEmails();
    }, 350);
  });

  // Đóng modal khi bấm backdrop
  $$('[data-close-modal]').forEach((el) =>
    el.addEventListener('click', () => {
      $('#composeModal').classList.add('hidden');
      $('#settingsModal').classList.add('hidden');
    })
  );
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      $('#composeModal').classList.add('hidden');
      $('#settingsModal').classList.add('hidden');
    }
  });

  // Editor toolbar
  $('#editorToolbar').addEventListener('mousedown', (e) => e.preventDefault());
  $('#editorToolbar').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-cmd]');
    if (!btn) return;
    const cmd = btn.dataset.cmd;
    if (cmd === 'link') {
      const url = prompt('Nhập URL liên kết:');
      if (url) document.execCommand('createLink', false, url);
    } else {
      document.execCommand(cmd, false, btn.dataset.value || null);
    }
  });

  $('#sendBtn').addEventListener('click', sendCompose);
  $('#attachBtn').addEventListener('click', () => $('#attachInput').click());
  $('#attachInput').addEventListener('change', (e) => {
    handleFileSelect(e.target.files);
    e.target.value = '';
  });

  $('#saveSettingsBtn').addEventListener('click', () => saveSettings(true));
  $('#testBtn').addEventListener('click', testConnection);

  // Mở settings modal tự động nếu chưa cấu hình
  if (!state.account && !localStorage.getItem('mailmcp-hide-setup')) {
    setTimeout(() => {
      if (!state.account) $('#settingsModal').classList.remove('hidden');
    }, 800);
  }
}

/* ------------------------- Init ------------------------- */

async function init() {
  bindEvents();
  // Kiểm tra MCP health
  try {
    const h = await api('/api/health');
    if (!h.ok || h.mcp !== 'connected') throw new Error('MCP không kết nối');
  } catch (err) {
    $('#mcpBadge').classList.add('error');
    $('#mcpBadge').title = `MCP lỗi: ${err.message}`;
    $('#mcpBadge').innerHTML = '<span class="dot"></span> MCP lỗi kết nối';
  }
  await loadAccount();
  await loadEmails();
}

document.addEventListener('DOMContentLoaded', init);

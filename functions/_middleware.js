export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  if (!path.startsWith('/api/')) {
    return next();
  }

  if (env.DB) {
    try {
      return await handleApiRequestWithDb(request, env, path);
    } catch (error) {
      console.error('API Error:', error);
      return jsonResponse(500, '服务器错误: ' + error.message);
    }
  }

  try {
    return await handleApiRequest(request, env, path);
  } catch (error) {
    console.error('API Error:', error);
    return jsonResponse(500, '服务器错误: ' + error.message);
  }
}

function jsonResponse(code, msg, data = null) {
  return new Response(JSON.stringify({ code, msg, data }), {
    status: code === 0 ? 200 : code,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

function getToken(request) {
  const auth = request.headers.get('Authorization');
  if (auth && auth.startsWith('Bearer ')) {
    return auth.substring(7);
  }
  return null;
}

async function generateJwt(payload, env) {
  const secret = env.JWT_SECRET || 'dev_secret_change_me_in_production';
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 7 * 24 * 60 * 60;

  const jwtPayload = {
    sub: String(payload.id),
    iat: now,
    exp: exp,
    jti: payload.jti,
    iss: 'rent-admin',
    role: payload.role || 0,
    account_no: payload.account_no,
    id: payload.id,
  };

  function base64urlEncode(str) {
    return btoa(str).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  }

  const encoder = new TextEncoder();
  const headerEncoded = base64urlEncode(JSON.stringify(header));
  const payloadEncoded = base64urlEncode(JSON.stringify(jwtPayload));

  const data = encoder.encode(`${headerEncoded}.${payloadEncoded}`);
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, data);
  const signatureEncoded = base64urlEncode(String.fromCharCode(...new Uint8Array(signature)));

  return `${headerEncoded}.${payloadEncoded}.${signatureEncoded}`;
}

async function verifyJwt(token, env) {
  try {
    const secret = env.JWT_SECRET || 'dev_secret_change_me_in_production';
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [headerEncoded, payloadEncoded, signatureEncoded] = parts;

    const encoder = new TextEncoder();
    const data = encoder.encode(`${headerEncoded}.${payloadEncoded}`);
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    function base64urlDecode(str) {
      str = str.replace(/-/g, '+').replace(/_/g, '/');
      while (str.length % 4) str += '=';
      return atob(str);
    }

    const signature = new Uint8Array(
      base64urlDecode(signatureEncoded).split('').map(c => c.charCodeAt(0))
    );

    const isValid = await crypto.subtle.verify('HMAC', key, signature, data);
    if (!isValid) return null;

    const payload = JSON.parse(base64urlDecode(payloadEncoded));
    const now = Math.floor(Date.now() / 1000);
    
    if (!payload.exp || payload.exp < now) return null;
    if (!payload.sub || !payload.jti) return null;

    return {
      ...payload,
      id: parseInt(payload.sub) || payload.id,
    };
  } catch (error) {
    console.error('JWT verify error:', error);
    return null;
  }
}

async function handleApiRequestWithDb(request, env, path) {
  const method = request.method;
  const db = env.DB;

  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  if (path === '/api/system/health' && method === 'GET') {
    try {
      const result = await db.prepare('SELECT 1 as ok').all();
      return jsonResponse(0, 'ok', { status: 'running', hasDb: true, dbResult: result.results?.[0]?.ok === 1 });
    } catch (e) {
      return jsonResponse(0, 'ok', { status: 'running', hasDb: false, dbError: e.message });
    }
  }

  if (path === '/api/auth/captcha' && method === 'GET') {
    return await handleCaptcha(db);
  }

  if (path === '/api/auth/login' && method === 'POST') {
    return await handleLoginWithDb(request, env, db);
  }

  if (path === '/api/auth/register' && method === 'POST') {
    return await handleRegisterWithDb(request, env, db);
  }

  const token = getToken(request);
  if (!token) {
    return jsonResponse(401, '未登录');
  }

  const decoded = await verifyJwt(token, env);
  if (!decoded) {
    return jsonResponse(401, '登录已过期');
  }

  const userInfo = await getUserInfo(db, decoded);

  if (path === '/api/auth/me' && method === 'GET') {
    return jsonResponse(0, 'ok', userInfo);
  }

  if (path === '/api/auth/logout' && method === 'POST') {
    await revokeToken(db, decoded.jti);
    return jsonResponse(0, '退出成功');
  }

  if (path === '/api/auth/change-password' && method === 'POST') {
    return await handleChangePassword(request, db, decoded);
  }

  if (path === '/api/auth/delete-account' && method === 'POST') {
    return await handleDeleteAccount(db, decoded);
  }

  if (path === '/api/dashboard/summary' && method === 'GET') {
    return await handleDashboardSummary(db, decoded.id);
  }

  if (path === '/api/dashboard/recent' && method === 'GET') {
    return await handleRecentTransactions(db, decoded.id);
  }

  if (path === '/api/transactions/categories' && method === 'GET') {
    return await handleCategories(db, decoded.id);
  }

  if (path === '/api/transactions' && method === 'GET') {
    return await handleListTransactions(request, db, decoded.id);
  }

  if (path === '/api/transactions' && method === 'POST') {
    return await handleCreateTransaction(request, db, decoded.id);
  }

  if (path.startsWith('/api/transactions/') && method === 'GET') {
    const txId = path.split('/').pop();
    return await handleGetTransaction(db, decoded.id, txId);
  }

  if (path.startsWith('/api/transactions/') && method === 'PUT') {
    const txId = path.split('/').pop();
    return await handleUpdateTransaction(request, db, decoded.id, txId);
  }

  if (path.startsWith('/api/transactions/') && method === 'DELETE') {
    const txId = path.split('/').pop();
    return await handleDeleteTransaction(db, decoded.id, txId);
  }

  if (path === '/api/transactions/batch-delete' && method === 'POST') {
    return await handleBatchDeleteTransactions(request, db, decoded.id);
  }

  if (path === '/api/reminders' && method === 'GET') {
    return await handleListReminders(request, db, decoded.id);
  }

  if (path === '/api/reminders' && method === 'POST') {
    return await handleCreateReminder(request, db, decoded.id);
  }

  if (path.startsWith('/api/reminders/') && method === 'GET') {
    const remId = path.split('/').pop();
    return await handleGetReminder(db, decoded.id, remId);
  }

  if (path.startsWith('/api/reminders/') && method === 'PUT') {
    const remId = path.split('/').pop();
    return await handleUpdateReminder(request, db, decoded.id, remId);
  }

  if (path.startsWith('/api/reminders/') && method === 'DELETE') {
    const remId = path.split('/').pop();
    return await handleDeleteReminder(db, decoded.id, remId);
  }

  if (path === '/api/reminders/batch-delete' && method === 'POST') {
    return await handleBatchDeleteReminders(request, db, decoded.id);
  }

  if (path.startsWith('/api/reminders/') && path.endsWith('/renew') && method === 'POST') {
    const remId = path.split('/').slice(-2, -1)[0];
    return await handleRenewReminder(request, db, decoded.id, remId);
  }

  if (path === '/api/stats/summary' && method === 'GET') {
    return await handleStatsSummary(db, decoded.id);
  }

  if (path === '/api/stats/trend' && method === 'GET') {
    return await handleStatsTrend(db, decoded.id);
  }

  if (path === '/api/stats/pie' && method === 'GET') {
    return await handleStatsPie(request, db, decoded.id);
  }

  if (path === '/api/stats/compare' && method === 'GET') {
    return await handleStatsCompare(request, db, decoded.id);
  }

  if (decoded.role === 1) {
    if (path === '/api/admin/overview' && method === 'GET') {
      return await handleAdminOverview(db);
    }
    if (path === '/api/admin/me' && method === 'GET') {
      return jsonResponse(0, 'ok', userInfo);
    }
    if (path === '/api/admin/users' && method === 'GET') {
      return await handleAdminUsers(request, db);
    }
    if (path.startsWith('/api/admin/users/') && method === 'GET') {
      const userId = path.split('/').pop();
      return await handleAdminUserDetail(db, userId);
    }
    if (path.startsWith('/api/admin/users/') && path.endsWith('/unlock') && method === 'POST') {
      const userId = path.split('/').slice(-2, -1)[0];
      return await handleAdminUnlockUser(db, userId);
    }
    if (path.startsWith('/api/admin/users/') && path.endsWith('/reset-password') && method === 'POST') {
      const userId = path.split('/').slice(-2, -1)[0];
      return await handleAdminResetPassword(db, userId);
    }
    if (path.startsWith('/api/admin/users/') && path.endsWith('/role') && method === 'POST') {
      const userId = path.split('/').slice(-2, -1)[0];
      return await handleAdminSetRole(request, db, userId);
    }
    if (path.startsWith('/api/admin/users/') && method === 'DELETE') {
      const userId = path.split('/').pop();
      return await handleAdminDeleteUser(db, userId);
    }
    if (path.startsWith('/api/admin/users/') && path.endsWith('/toggle-active') && method === 'POST') {
      const userId = path.split('/').slice(-2, -1)[0];
      return await handleAdminToggleActive(request, db, userId);
    }
    if (path === '/api/admin/verify-self-pwd' && method === 'POST') {
      return await handleAdminVerifySelfPwd(request, db, decoded);
    }
    if (path === '/api/admin/logs' && method === 'GET') {
      return await handleAdminLogs(request, db);
    }
    if (path === '/api/admin/announcements' && method === 'GET') {
      return await handleAdminAnnouncements(db);
    }
    if (path === '/api/admin/announcements' && method === 'POST') {
      return await handleCreateAnnouncement(request, db, decoded.id);
    }
    if (path.startsWith('/api/admin/announcements/') && method === 'PUT') {
      const annId = path.split('/').pop();
      return await handleUpdateAnnouncement(request, db, decoded.id, annId);
    }
    if (path.startsWith('/api/admin/announcements/') && method === 'DELETE') {
      const annId = path.split('/').pop();
      return await handleDeleteAnnouncement(db, annId);
    }
    if (path.startsWith('/api/admin/announcements/') && path.endsWith('/pin') && method === 'POST') {
      const annId = path.split('/').slice(-2, -1)[0];
      return await handlePinAnnouncement(request, db, annId);
    }
  }

  if (path === '/api/system/announcements' && method === 'GET') {
    return await handlePublicAnnouncements(db);
  }

  return jsonResponse(404, '接口不存在');
}

async function initDbSchema(db) {
  const schema = `
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_no CHAR(6) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        nickname VARCHAR(32) NOT NULL DEFAULT '',
        phone VARCHAR(20) NOT NULL DEFAULT '',
        is_active BOOLEAN NOT NULL DEFAULT 1,
        role INTEGER NOT NULL DEFAULT 0,
        failed_attempts INTEGER NOT NULL DEFAULT 0,
        last_failed_at TIMESTAMP,
        locked_until TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login_at TIMESTAMP,
        is_deleted BOOLEAN NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        type CHAR(4) NOT NULL,
        name VARCHAR(20) NOT NULL,
        is_system BOOLEAN NOT NULL DEFAULT 0,
        sort INTEGER NOT NULL DEFAULT 0,
        disabled BOOLEAN NOT NULL DEFAULT 0,
        UNIQUE(user_id, type, name)
    );

    CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        type CHAR(4) NOT NULL,
        category VARCHAR(20) NOT NULL,
        amount DECIMAL(12,2) NOT NULL,
        description VARCHAR(200) NOT NULL DEFAULT '',
        room_no VARCHAR(20) NOT NULL DEFAULT '',
        trans_date DATE NOT NULL,
        tag VARCHAR(50) NOT NULL DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        deleted BOOLEAN NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS reminders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        room_no VARCHAR(20) NOT NULL,
        rent_amount DECIMAL(12,2) NOT NULL,
        due_date DATE NOT NULL,
        lease_end_date DATE,
        status VARCHAR(10) NOT NULL DEFAULT '未完成',
        remark VARCHAR(200) NOT NULL DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        deleted BOOLEAN NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS session_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        login_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        ip VARCHAR(64) NOT NULL DEFAULT '',
        user_agent VARCHAR(512) NOT NULL DEFAULT '',
        jti CHAR(36) NOT NULL UNIQUE,
        revoked BOOLEAN NOT NULL DEFAULT 0,
        is_success BOOLEAN NOT NULL DEFAULT 1,
        fail_reason VARCHAR(40) NOT NULL DEFAULT '',
        attempt_account CHAR(6) NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS captcha_store (
        id CHAR(32) PRIMARY KEY,
        code_hash CHAR(64) NOT NULL,
        salt CHAR(16) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        used BOOLEAN NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS announcements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title VARCHAR(80) NOT NULL,
        content TEXT NOT NULL,
        banner_level VARCHAR(10) NOT NULL DEFAULT 'info',
        priority INTEGER NOT NULL DEFAULT 0,
        is_pinned BOOLEAN NOT NULL DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT 1,
        effective_at TIMESTAMP,
        expire_at TIMESTAMP,
        created_by INTEGER,
        updated_by INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_deleted BOOLEAN NOT NULL DEFAULT 0
    );
  `;

  for (const stmt of schema.split(';')) {
    const trimmed = stmt.trim();
    if (trimmed && !trimmed.startsWith('--')) {
      try {
        await db.prepare(trimmed).run();
      } catch (e) {
        console.warn('Schema init warning:', e.message);
      }
    }
  }
}

async function ensureAdminSeeded(db, env) {
  const adminAcc = env.ADMIN_DEFAULT_ACCOUNT || '100000';
  const adminPwd = env.ADMIN_DEFAULT_PASSWORD || '123456';

  const existing = await db.prepare('SELECT id FROM users WHERE account_no = ? AND is_deleted = 0 LIMIT 1').bind(adminAcc).first();
  if (existing) {
    await db.prepare('UPDATE users SET role = 1, is_active = 1 WHERE id = ?').bind(existing.id).run();
    return existing.id;
  }

  const hash = await generatePasswordHash(adminPwd);
  const result = await db.prepare(
    'INSERT INTO users(account_no, password_hash, role, nickname, is_active) VALUES(?, ?, 1, ?, 1)'
  ).bind(adminAcc, hash, '超级管理员').run();

  const userId = result.meta.last_row_id;

  const categories = [
    { type: '收入', names: ['房租', '网费', '取暖费', '房租押金', '门禁卡押金', '违约金', '其他'] },
    { type: '支出', names: ['网费', '招租费', '配件', '工人费', '保洁费', '水电', '维修', '其他'] },
  ];

  for (const cat of categories) {
    for (let i = 0; i < cat.names.length; i++) {
      await db.prepare(
        'INSERT OR IGNORE INTO categories(user_id, type, name, is_system, sort) VALUES(?, ?, ?, 1, ?)'
      ).bind(userId, cat.type, cat.names[i], i).run();
    }
  }

  return userId;
}

async function generatePasswordHash(password) {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = 260000;

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  const derivedKey = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    []
  );

  const hash = await crypto.subtle.exportKey('raw', derivedKey);
  const hashHex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');

  return `pbkdf2:sha256:${iterations}$${saltHex}$${hashHex}`;
}

async function verifyPassword(password, storedHash) {
  const parts = storedHash.split('$');
  if (parts.length !== 3) return false;

  const [algo, saltHex, hashHex] = parts;
  const iterations = parseInt(algo.split(':')[2]);
  if (isNaN(iterations) || iterations <= 0) return false;

  const salt = new Uint8Array(saltHex.match(/.{2}/g).map(h => parseInt(h, 16)));

  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  const derivedKey = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    []
  );

  const hash = await crypto.subtle.exportKey('raw', derivedKey);
  const computedHashHex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');

  return computedHashHex === hashHex;
}

async function generateCaptcha() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  const salt = Array.from(crypto.getRandomValues(new Uint8Array(8))).map(b => b.toString(16).padStart(2, '0')).join('');
  const captchaId = Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, '0')).join('');

  const encoder = new TextEncoder();
  const hashData = encoder.encode(salt + code.toUpperCase());
  const hash = await crypto.subtle.digest('SHA-256', hashData);
  const codeHash = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');

  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  return { captchaId, code, codeHash, salt, expiresAt };
}

async function handleCaptcha(db) {
  const { captchaId, code, codeHash, salt, expiresAt } = await generateCaptcha();

  await db.prepare('DELETE FROM captcha_store WHERE expires_at < datetime(\'now\') LIMIT 100').run();

  await db.prepare(
    'INSERT INTO captcha_store(id, code_hash, salt, expires_at) VALUES(?, ?, ?, ?)'
  ).bind(captchaId, codeHash, salt, expiresAt.toISOString()).run();

  const svg = generateCaptchaSvg(code);

  return jsonResponse(0, 'ok', {
    captcha_id: captchaId,
    image: 'data:image/svg+xml;base64,' + btoa(svg),
    ttl: 300,
    disabled: false,
  });
}

function generateCaptchaSvg(code) {
  const width = 120;
  const height = 40;
  const chars = code.split('');

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;
  svg += `<rect width="${width}" height="${height}" fill="#2c3e50"/>`;

  for (let i = 0; i < 6; i++) {
    const x1 = Math.random() * width;
    const y1 = Math.random() * height;
    const x2 = Math.random() * width;
    const y2 = Math.random() * height;
    svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(255,255,255,0.15)" stroke-width="1"/>`;
  }

  for (let i = 0; i < 20; i++) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    const r = Math.random() * 2;
    svg += `<circle cx="${x}" cy="${y}" r="${r}" fill="rgba(255,255,255,0.2)"/>`;
  }

  const colors = ['#3498db', '#e74c3c', '#2ecc71', '#f39c12'];

  chars.forEach((char, i) => {
    const x = 15 + i * 25;
    const y = height / 2 + 8;
    const fontSize = 22 + Math.random() * 6;
    const rotation = (Math.random() - 0.5) * 30;
    const color = colors[i % colors.length];

    svg += `<text x="${x}" y="${y}" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="bold" fill="${color}" text-anchor="middle" transform="rotate(${rotation}, ${x}, ${y})">${char}</text>`;
  });

  svg += '</svg>';
  return svg;
}

async function handleLoginWithDb(request, env, db) {
  await initDbSchema(db);
  await ensureAdminSeeded(db, env);

  const body = await request.json();
  const { account_no, password, captcha_id, captcha_code } = body;

  if (!account_no || !password) {
    return jsonResponse(400, '账号或密码不能为空');
  }

  if (!/^\d{6,11}$/.test(account_no)) {
    return jsonResponse(400, '账号必须为6-11位数字');
  }

  if (!/^\d{6,12}$/.test(password)) {
    return jsonResponse(400, '密码必须为6-12位数字');
  }

  if (!captcha_id || !captcha_code) {
    return jsonResponse(400, '请输入验证码', { captcha_required: true });
  }

  const captcha = await db.prepare('SELECT code_hash, salt, used, expires_at FROM captcha_store WHERE id = ? LIMIT 1').bind(captcha_id).first();
  if (!captcha || captcha.used) {
    return jsonResponse(400, '验证码已过期或不存在', { captcha_required: true });
  }
  if (captcha.expires_at && new Date(captcha.expires_at) < new Date()) {
    await db.prepare('DELETE FROM captcha_store WHERE id = ?').bind(captcha_id).run();
    return jsonResponse(400, '验证码已过期，请点击刷新', { captcha_required: true });
  }

  const encoder = new TextEncoder();
  const hashData = encoder.encode(captcha.salt + captcha_code.toUpperCase());
  const hash = await crypto.subtle.digest('SHA-256', hashData);
  const inputHash = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');

  await db.prepare('UPDATE captcha_store SET used = 1 WHERE id = ?').bind(captcha_id).run();

  if (inputHash !== captcha.code_hash) {
    return jsonResponse(400, '验证码错误，请重新输入', { captcha_required: true });
  }

  const user = await db.prepare('SELECT * FROM users WHERE account_no = ? AND is_deleted = 0 LIMIT 1').bind(account_no).first();

  if (!user) {
    return jsonResponse(400, '账号或密码错误');
  }

  if (!user.is_active) {
    return jsonResponse(400, '账号已被禁用');
  }

  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    const remain = Math.ceil((new Date(user.locked_until) - new Date()) / 1000);
    return jsonResponse(400, `账号已锁定，请 ${Math.ceil(remain / 60)} 分钟后再试`);
  }

  const isPasswordValid = await verifyPassword(password, user.password_hash);

  if (!isPasswordValid) {
    const failedAttempts = (user.failed_attempts || 0) + 1;
    const maxAttempts = parseInt(env.LOGIN_MAX_ATTEMPTS || '5');
    const lockMinutes = parseInt(env.LOGIN_LOCK_MINUTES || '30');

    if (failedAttempts >= maxAttempts) {
      await db.prepare(
        'UPDATE users SET failed_attempts = ?, last_failed_at = datetime(\'now\'), locked_until = datetime(\'now\', ?) WHERE id = ?'
      ).bind(failedAttempts, `+${lockMinutes} minutes`, user.id).run();
      return jsonResponse(400, `密码错误次数过多，账号已锁定 ${lockMinutes} 分钟`);
    } else {
      await db.prepare(
        'UPDATE users SET failed_attempts = ?, last_failed_at = datetime(\'now\') WHERE id = ?'
      ).bind(failedAttempts, user.id).run();
      return jsonResponse(400, `账号或密码错误，还剩 ${maxAttempts - failedAttempts} 次机会`);
    }
  }

  await db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = datetime(\'now\') WHERE id = ?').bind(user.id).run();

  const jti = Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, '0')).join('');

  await db.prepare(
    'INSERT INTO session_logs(user_id, jti, ip, user_agent, is_success) VALUES(?, ?, ?, ?, 1)'
  ).bind(user.id, jti, request.headers.get('CF-Connecting-IP') || '', request.headers.get('User-Agent') || '').run();

  const token = await generateJwt({ id: user.id, account_no: user.account_no, role: user.role, jti }, env);
  const userInfo = await getUserInfo(db, { id: user.id });

  return jsonResponse(0, '登录成功', {
    token,
    user: userInfo,
    userInfo,
    account_no: user.account_no,
    user_id: user.id,
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    security: {
      default_admin_account: '100000',
      need_change_default_pwd: user.account_no === '100000' && password === (env.ADMIN_DEFAULT_PASSWORD || '123456'),
      warn_default_credentials: user.account_no === '100000' && password === (env.ADMIN_DEFAULT_PASSWORD || '123456'),
      warn_tags: [],
    },
  });
}

async function handleRegisterWithDb(request, env, db) {
  await initDbSchema(db);

  const body = await request.json();
  const { account_no, password, nickname } = body;

  if (!account_no || !password) {
    return jsonResponse(400, '账号或密码不能为空');
  }

  if (!/^\d{6,11}$/.test(account_no)) {
    return jsonResponse(400, '账号必须为6-11位数字');
  }

  if (!/^\d{6,12}$/.test(password)) {
    return jsonResponse(400, '密码必须为6-12位数字');
  }

  if (account_no === '100000') {
    return jsonResponse(400, '该账号已被注册');
  }

  const existing = await db.prepare('SELECT id FROM users WHERE account_no = ? AND is_deleted = 0 LIMIT 1').bind(account_no).first();
  if (existing) {
    return jsonResponse(400, '该账号已被注册');
  }

  const hash = await generatePasswordHash(password);
  const result = await db.prepare(
    'INSERT INTO users(account_no, password_hash, nickname, role, is_active) VALUES(?, ?, ?, 0, 1)'
  ).bind(account_no, hash, nickname || '用户').run();

  const userId = result.meta.last_row_id;

  const categories = [
    { type: '收入', names: ['房租', '网费', '取暖费', '房租押金', '门禁卡押金', '违约金', '其他'] },
    { type: '支出', names: ['网费', '招租费', '配件', '工人费', '保洁费', '水电', '维修', '其他'] },
  ];

  for (const cat of categories) {
    for (let i = 0; i < cat.names.length; i++) {
      await db.prepare(
        'INSERT OR IGNORE INTO categories(user_id, type, name, is_system, sort) VALUES(?, ?, ?, 1, ?)'
      ).bind(userId, cat.type, cat.names[i], i).run();
    }
  }

  const jti = Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, '0')).join('');

  await db.prepare(
    'INSERT INTO session_logs(user_id, jti, ip, user_agent, is_success) VALUES(?, ?, ?, ?, 1)'
  ).bind(userId, jti, request.headers.get('CF-Connecting-IP') || '', request.headers.get('User-Agent') || '').run();

  const token = await generateJwt({ id: userId, account_no, role: 0, jti }, env);
  const userInfo = await getUserInfo(db, { id: userId });

  return jsonResponse(0, '注册成功', {
    token,
    user: userInfo,
    userInfo,
    account_no,
    user_id: userId,
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    security: {
      default_admin_account: '100000',
      need_change_default_pwd: false,
      warn_default_credentials: false,
      warn_tags: [],
    },
  });
}

async function getUserInfo(db, decoded) {
  const user = await db.prepare('SELECT id, account_no, nickname, phone, role, is_active, created_at, last_login_at FROM users WHERE id = ? AND is_deleted = 0 LIMIT 1').bind(decoded.id).first();
  if (!user) {
    return null;
  }
  return {
    id: user.id,
    user_id: user.id,
    account_no: user.account_no,
    nickname: user.nickname || '用户',
    phone: user.phone || '',
    role: user.role,
    role_name: user.role === 1 ? '超级管理员' : '普通用户',
    is_active: user.is_active,
    created_at: user.created_at,
    last_login_at: user.last_login_at,
  };
}

async function revokeToken(db, jti) {
  await db.prepare('UPDATE session_logs SET revoked = 1 WHERE jti = ?').bind(jti).run();
}

async function handleChangePassword(request, db, decoded) {
  const body = await request.json();
  const { old_password, new_password } = body;

  const user = await db.prepare('SELECT password_hash FROM users WHERE id = ? AND is_deleted = 0 LIMIT 1').bind(decoded.id).first();
  if (!user) {
    return jsonResponse(400, '用户不存在');
  }

  if (!await verifyPassword(old_password, user.password_hash)) {
    return jsonResponse(400, '原密码不正确');
  }

  if (!/^\d{6,12}$/.test(new_password)) {
    return jsonResponse(400, '新密码必须为6-12位数字');
  }

  const newHash = await generatePasswordHash(new_password);
  await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(newHash, decoded.id).run();

  await db.prepare('UPDATE session_logs SET revoked = 1 WHERE user_id = ?').bind(decoded.id).run();

  return jsonResponse(0, '密码修改成功，请重新登录');
}

async function handleDeleteAccount(db, decoded) {
  await db.prepare('UPDATE users SET is_deleted = 1 WHERE id = ?').bind(decoded.id).run();
  await db.prepare('UPDATE session_logs SET revoked = 1 WHERE user_id = ?').bind(decoded.id).run();
  return jsonResponse(0, '账号已删除');
}

async function handleDashboardSummary(db, userId) {
  const income = await db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE user_id = ? AND type = ? AND deleted = 0').bind(userId, '收入').first();
  const expense = await db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE user_id = ? AND type = ? AND deleted = 0').bind(userId, '支出').first();

  const monthIncome = await db.prepare(
    "SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE user_id = ? AND type = ? AND deleted = 0 AND strftime('%Y-%m', trans_date) = strftime('%Y-%m', 'now')"
  ).bind(userId, '收入').first();

  const monthExpense = await db.prepare(
    "SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE user_id = ? AND type = ? AND deleted = 0 AND strftime('%Y-%m', trans_date) = strftime('%Y-%m', 'now')"
  ).bind(userId, '支出').first();

  const txCount = await db.prepare('SELECT COUNT(*) as cnt FROM transactions WHERE user_id = ? AND deleted = 0').bind(userId).first();
  const pendingReminders = await db.prepare('SELECT COUNT(*) as cnt FROM reminders WHERE user_id = ? AND deleted = 0 AND status = ?').bind(userId, '未完成').first();

  return jsonResponse(0, 'ok', {
    total_income: parseFloat(income.total || 0),
    total_expense: parseFloat(expense.total || 0),
    month_income: parseFloat(monthIncome.total || 0),
    month_expense: parseFloat(monthExpense.total || 0),
    transaction_count: parseInt(txCount.cnt || 0),
    pending_reminders: parseInt(pendingReminders.cnt || 0),
  });
}

async function handleRecentTransactions(db, userId) {
  const rows = await db.prepare(
    'SELECT * FROM transactions WHERE user_id = ? AND deleted = 0 ORDER BY trans_date DESC, id DESC LIMIT 10'
  ).bind(userId).all();

  return jsonResponse(0, 'ok', rows.results || []);
}

async function handleCategories(db, userId) {
  const rows = await db.prepare(
    'SELECT * FROM categories WHERE user_id = ? AND disabled = 0 ORDER BY sort ASC, id ASC'
  ).bind(userId).all();

  const result = { income: [], expense: [] };
  for (const row of rows.results || []) {
    const type = row.type;
    if (type in result) {
      result[type].push(row);
    }
  }

  return jsonResponse(0, 'ok', result);
}

async function handleListTransactions(request, db, userId) {
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get('page') || '1');
  const pageSize = parseInt(url.searchParams.get('page_size') || '20');
  const type = url.searchParams.get('type');
  const category = url.searchParams.get('category');
  const roomNo = url.searchParams.get('room_no');
  const startDate = url.searchParams.get('start_date');
  const endDate = url.searchParams.get('end_date');
  const keyword = url.searchParams.get('keyword');

  let where = ['user_id = ?', 'deleted = 0'];
  let params = [userId];

  if (type) { where.push('type = ?'); params.push(type); }
  if (category) { where.push('category = ?'); params.push(category); }
  if (roomNo) { where.push('room_no = ?'); params.push(roomNo); }
  if (startDate) { where.push('trans_date >= ?'); params.push(startDate); }
  if (endDate) { where.push('trans_date <= ?'); params.push(endDate); }
  if (keyword) {
    where.push('(description LIKE ? OR tag LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`);
  }

  const whereSql = where.join(' AND ');
  const count = await db.prepare(`SELECT COUNT(*) as cnt FROM transactions WHERE ${whereSql}`).bind(...params).first();
  const offset = (page - 1) * pageSize;

  const rows = await db.prepare(
    `SELECT * FROM transactions WHERE ${whereSql} ORDER BY trans_date DESC, id DESC LIMIT ? OFFSET ?`
  ).bind(...params, pageSize, offset).all();

  return jsonResponse(0, 'ok', {
    total: parseInt(count.cnt || 0),
    page,
    page_size: pageSize,
    list: rows.results || [],
  });
}

async function handleCreateTransaction(request, db, userId) {
  const body = await request.json();

  const result = await db.prepare(
    'INSERT INTO transactions(user_id, type, category, amount, description, room_no, trans_date, tag) VALUES(?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    userId,
    body.type || '支出',
    body.category || '',
    parseFloat(body.amount || 0),
    body.description || '',
    body.room_no || '',
    body.trans_date || new Date().toISOString().split('T')[0],
    body.tag || ''
  ).run();

  return jsonResponse(0, '添加成功', { id: result.meta.last_row_id });
}

async function handleGetTransaction(db, userId, txId) {
  const row = await db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ? AND deleted = 0 LIMIT 1').bind(txId, userId).first();
  if (!row) {
    return jsonResponse(404, '记录不存在');
  }
  return jsonResponse(0, 'ok', row);
}

async function handleUpdateTransaction(request, db, userId, txId) {
  const body = await request.json();

  const fields = [];
  const params = [];

  if ('type' in body) { fields.push('type = ?'); params.push(body.type); }
  if ('category' in body) { fields.push('category = ?'); params.push(body.category); }
  if ('amount' in body) { fields.push('amount = ?'); params.push(parseFloat(body.amount)); }
  if ('description' in body) { fields.push('description = ?'); params.push(body.description); }
  if ('room_no' in body) { fields.push('room_no = ?'); params.push(body.room_no); }
  if ('trans_date' in body) { fields.push('trans_date = ?'); params.push(body.trans_date); }
  if ('tag' in body) { fields.push('tag = ?'); params.push(body.tag); }

  if (fields.length === 0) {
    return jsonResponse(400, '没有需要更新的字段');
  }

  fields.push('updated_at = datetime(\'now\')');
  params.push(txId, userId);

  const result = await db.prepare(
    `UPDATE transactions SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`
  ).bind(...params).run();

  if (result.meta.changes > 0) {
    return jsonResponse(0, '更新成功');
  }
  return jsonResponse(404, '记录不存在');
}

async function handleDeleteTransaction(db, userId, txId) {
  const result = await db.prepare('UPDATE transactions SET deleted = 1 WHERE id = ? AND user_id = ?').bind(txId, userId).run();
  if (result.meta.changes > 0) {
    return jsonResponse(0, '删除成功');
  }
  return jsonResponse(404, '记录不存在');
}

async function handleBatchDeleteTransactions(request, db, userId) {
  const body = await request.json();
  const ids = body.ids || [];

  if (ids.length === 0) {
    return jsonResponse(0, '批量删除成功', { deleted: 0 });
  }

  const placeholders = ids.map(() => '?').join(',');
  const result = await db.prepare(
    `UPDATE transactions SET deleted = 1 WHERE id IN (${placeholders}) AND user_id = ?`
  ).bind(...ids, userId).run();

  return jsonResponse(0, '批量删除成功', { deleted: result.meta.changes });
}

async function handleListReminders(request, db, userId) {
  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const roomNo = url.searchParams.get('room_no');

  let where = ['user_id = ?', 'deleted = 0'];
  let params = [userId];

  if (status) { where.push('status = ?'); params.push(status); }
  if (roomNo) { where.push('room_no = ?'); params.push(roomNo); }

  const whereSql = where.join(' AND ');
  const rows = await db.prepare(
    `SELECT * FROM reminders WHERE ${whereSql} ORDER BY due_date ASC, id DESC`
  ).bind(...params).all();

  return jsonResponse(0, 'ok', rows.results || []);
}

async function handleCreateReminder(request, db, userId) {
  const body = await request.json();

  const result = await db.prepare(
    'INSERT INTO reminders(user_id, room_no, rent_amount, due_date, lease_end_date, status, remark) VALUES(?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    userId,
    body.room_no || '',
    parseFloat(body.rent_amount || 0),
    body.due_date || new Date().toISOString().split('T')[0],
    body.lease_end_date || null,
    body.status || '未完成',
    body.remark || ''
  ).run();

  return jsonResponse(0, '添加成功', { id: result.meta.last_row_id });
}

async function handleGetReminder(db, userId, remId) {
  const row = await db.prepare('SELECT * FROM reminders WHERE id = ? AND user_id = ? AND deleted = 0 LIMIT 1').bind(remId, userId).first();
  if (!row) {
    return jsonResponse(404, '提醒不存在');
  }
  return jsonResponse(0, 'ok', row);
}

async function handleUpdateReminder(request, db, userId, remId) {
  const body = await request.json();

  const fields = [];
  const params = [];

  if ('room_no' in body) { fields.push('room_no = ?'); params.push(body.room_no); }
  if ('rent_amount' in body) { fields.push('rent_amount = ?'); params.push(parseFloat(body.rent_amount)); }
  if ('due_date' in body) { fields.push('due_date = ?'); params.push(body.due_date); }
  if ('lease_end_date' in body) { fields.push('lease_end_date = ?'); params.push(body.lease_end_date || null); }
  if ('status' in body) { fields.push('status = ?'); params.push(body.status); }
  if ('remark' in body) { fields.push('remark = ?'); params.push(body.remark); }

  if (fields.length === 0) {
    return jsonResponse(400, '没有需要更新的字段');
  }

  fields.push('updated_at = datetime(\'now\')');
  params.push(remId, userId);

  const result = await db.prepare(
    `UPDATE reminders SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`
  ).bind(...params).run();

  if (result.meta.changes > 0) {
    return jsonResponse(0, '更新成功');
  }
  return jsonResponse(404, '提醒不存在');
}

async function handleDeleteReminder(db, userId, remId) {
  const result = await db.prepare('UPDATE reminders SET deleted = 1 WHERE id = ? AND user_id = ?').bind(remId, userId).run();
  if (result.meta.changes > 0) {
    return jsonResponse(0, '删除成功');
  }
  return jsonResponse(404, '提醒不存在');
}

async function handleBatchDeleteReminders(request, db, userId) {
  const body = await request.json();
  const ids = body.ids || [];

  if (ids.length === 0) {
    return jsonResponse(0, '批量删除成功', { deleted: 0 });
  }

  const placeholders = ids.map(() => '?').join(',');
  const result = await db.prepare(
    `UPDATE reminders SET deleted = 1 WHERE id IN (${placeholders}) AND user_id = ?`
  ).bind(...ids, userId).run();

  return jsonResponse(0, '批量删除成功', { deleted: result.meta.changes });
}

async function handleRenewReminder(request, db, userId, remId) {
  const body = await request.json();
  const months = parseInt(body.months || 1);

  const reminder = await db.prepare('SELECT * FROM reminders WHERE id = ? AND user_id = ? AND deleted = 0 LIMIT 1').bind(remId, userId).first();
  if (!reminder) {
    return jsonResponse(404, '提醒不存在');
  }

  const newDueDate = new Date(reminder.due_date);
  newDueDate.setMonth(newDueDate.getMonth() + months);

  const newLeaseEndDate = reminder.lease_end_date ? new Date(reminder.lease_end_date) : null;
  if (newLeaseEndDate) {
    newLeaseEndDate.setMonth(newLeaseEndDate.getMonth() + months);
  }

  await db.prepare(
    'UPDATE reminders SET due_date = ?, lease_end_date = ?, updated_at = datetime(\'now\') WHERE id = ?'
  ).bind(
    newDueDate.toISOString().split('T')[0],
    newLeaseEndDate ? newLeaseEndDate.toISOString().split('T')[0] : null,
    remId
  ).run();

  return jsonResponse(0, '续租成功');
}

async function handleStatsSummary(db, userId) {
  const todayIncome = await db.prepare(
    "SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE user_id = ? AND type = ? AND deleted = 0 AND trans_date = date('now')"
  ).bind(userId, '收入').first();

  const todayExpense = await db.prepare(
    "SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE user_id = ? AND type = ? AND deleted = 0 AND trans_date = date('now')"
  ).bind(userId, '支出').first();

  const monthIncome = await db.prepare(
    "SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE user_id = ? AND type = ? AND deleted = 0 AND strftime('%Y-%m', trans_date) = strftime('%Y-%m', 'now')"
  ).bind(userId, '收入').first();

  const monthExpense = await db.prepare(
    "SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE user_id = ? AND type = ? AND deleted = 0 AND strftime('%Y-%m', trans_date) = strftime('%Y-%m', 'now')"
  ).bind(userId, '支出').first();

  const totalIncome = await db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE user_id = ? AND type = ? AND deleted = 0').bind(userId, '收入').first();
  const totalExpense = await db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE user_id = ? AND type = ? AND deleted = 0').bind(userId, '支出').first();

  return jsonResponse(0, 'ok', {
    today_income: parseFloat(todayIncome.total || 0),
    today_expense: parseFloat(todayExpense.total || 0),
    month_income: parseFloat(monthIncome.total || 0),
    month_expense: parseFloat(monthExpense.total || 0),
    total_income: parseFloat(totalIncome.total || 0),
    total_expense: parseFloat(totalExpense.total || 0),
  });
}

async function handleStatsTrend(db, userId) {
  const rows = await db.prepare(
    "SELECT strftime('%Y-%m', trans_date) as month, type, COALESCE(SUM(amount), 0) as total FROM transactions WHERE user_id = ? AND deleted = 0 AND trans_date >= date('now', '-11 months', 'start of month') GROUP BY strftime('%Y-%m', trans_date), type ORDER BY month ASC"
  ).bind(userId).all();

  const result = {};
  for (let i = 11; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const month = d.toISOString().slice(0, 7);
    result[month] = { month, income: 0, expense: 0 };
  }

  for (const row of rows.results || []) {
    if (result[row.month]) {
      result[row.month][row.type === '收入' ? 'income' : 'expense'] = parseFloat(row.total);
    }
  }

  return jsonResponse(0, 'ok', Object.values(result));
}

async function handleStatsPie(request, db, userId) {
  const url = new URL(request.url);
  const months = parseInt(url.searchParams.get('months') || '3');

  let where = ['user_id = ?', 'deleted = 0'];
  let params = [userId];

  if (months > 0) {
    where.push(`trans_date >= date('now', '-${months} months')`);
  }

  const whereSql = where.join(' AND ');

  const incomeRows = await db.prepare(
    `SELECT category, COALESCE(SUM(amount), 0) as total, COUNT(*) as count FROM transactions WHERE ${whereSql} AND type = '收入' GROUP BY category ORDER BY total DESC`
  ).bind(...params).all();

  const expenseRows = await db.prepare(
    `SELECT category, COALESCE(SUM(amount), 0) as total, COUNT(*) as count FROM transactions WHERE ${whereSql} AND type = '支出' GROUP BY category ORDER BY total DESC`
  ).bind(...params).all();

  return jsonResponse(0, 'ok', {
    income: incomeRows.results || [],
    expense: expenseRows.results || [],
  });
}

async function handleStatsCompare(request, db, userId) {
  const url = new URL(request.url);
  const months = parseInt(url.searchParams.get('months') || '3');

  const pie = await handleStatsPie(request, db, userId);
  const pieData = JSON.parse(pie.body).data;

  const totalIncome = pieData.income.reduce((sum, r) => sum + parseFloat(r.total), 0);
  const totalExpense = pieData.expense.reduce((sum, r) => sum + parseFloat(r.total), 0);

  return jsonResponse(0, 'ok', {
    total_income: totalIncome,
    total_expense: totalExpense,
    net: totalIncome - totalExpense,
    income_categories: pieData.income,
    expense_categories: pieData.expense,
  });
}

async function handleAdminOverview(db) {
  const totalUsers = await db.prepare('SELECT COUNT(*) as cnt FROM users WHERE is_deleted = 0').first();
  const activeUsers = await db.prepare('SELECT COUNT(*) as cnt FROM users WHERE is_deleted = 0 AND is_active = 1').first();
  const lockedUsers = await db.prepare("SELECT COUNT(*) as cnt FROM users WHERE is_deleted = 0 AND locked_until > datetime('now')").first();
  const todayLogins = await db.prepare("SELECT COUNT(*) as cnt FROM session_logs WHERE is_success = 1 AND login_at >= date('now')").first();
  const totalLogins = await db.prepare('SELECT COUNT(*) as cnt FROM session_logs WHERE is_success = 1').first();

  return jsonResponse(0, 'ok', {
    total_users: parseInt(totalUsers.cnt || 0),
    active_users: parseInt(activeUsers.cnt || 0),
    locked_users: parseInt(lockedUsers.cnt || 0),
    today_logins: parseInt(todayLogins.cnt || 0),
    total_logins: parseInt(totalLogins.cnt || 0),
  });
}

async function handleAdminUsers(request, db) {
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get('page') || '1');
  const pageSize = parseInt(url.searchParams.get('page_size') || '20');
  const keyword = url.searchParams.get('keyword');
  const role = url.searchParams.get('role');

  let where = ['is_deleted = 0'];
  let params = [];

  if (keyword) {
    where.push('(account_no LIKE ? OR nickname LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`);
  }

  if (role !== undefined && role !== '') {
    where.push('role = ?');
    params.push(parseInt(role));
  }

  const whereSql = where.join(' AND ');
  const count = await db.prepare(`SELECT COUNT(*) as cnt FROM users WHERE ${whereSql}`).bind(...params).first();
  const offset = (page - 1) * pageSize;

  const rows = await db.prepare(
    `SELECT id, account_no, nickname, role, is_active, created_at, last_login_at FROM users WHERE ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`
  ).bind(...params, pageSize, offset).all();

  return jsonResponse(0, 'ok', {
    total: parseInt(count.cnt || 0),
    page,
    page_size: pageSize,
    list: rows.results || [],
  });
}

async function handleAdminUserDetail(db, userId) {
  const user = await db.prepare('SELECT id, account_no, nickname, role, is_active, created_at, last_login_at FROM users WHERE id = ? AND is_deleted = 0 LIMIT 1').bind(userId).first();
  if (!user) {
    return jsonResponse(404, '用户不存在');
  }
  return jsonResponse(0, 'ok', user);
}

async function handleAdminUnlockUser(db, userId) {
  await db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').bind(userId).run();
  return jsonResponse(0, '解锁成功');
}

async function handleAdminResetPassword(db, userId) {
  const defaultPwd = '123456';
  const hash = await generatePasswordHash(defaultPwd);
  await db.prepare('UPDATE users SET password_hash = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?').bind(hash, userId).run();
  return jsonResponse(0, '密码已重置为默认密码');
}

async function handleAdminSetRole(request, db, userId) {
  const body = await request.json();
  const role = parseInt(body.role || 0);

  await db.prepare('UPDATE users SET role = ? WHERE id = ?').bind(role, userId).run();
  await db.prepare('UPDATE session_logs SET revoked = 1 WHERE user_id = ?').bind(userId).run();

  return jsonResponse(0, '角色设置成功，请用户重新登录');
}

async function handleAdminDeleteUser(db, userId) {
  await db.prepare('DELETE FROM transactions WHERE user_id = ?').bind(userId).run();
  await db.prepare('DELETE FROM reminders WHERE user_id = ?').bind(userId).run();
  await db.prepare('DELETE FROM categories WHERE user_id = ?').bind(userId).run();
  await db.prepare('DELETE FROM session_logs WHERE user_id = ?').bind(userId).run();
  await db.prepare('DELETE FROM users WHERE id = ?').bind(userId).run();

  return jsonResponse(0, '删除成功');
}

async function handleAdminToggleActive(request, db, userId) {
  const body = await request.json();
  const active = body.active ? 1 : 0;

  await db.prepare('UPDATE users SET is_active = ? WHERE id = ?').bind(active, userId).run();
  if (!active) {
    await db.prepare('UPDATE session_logs SET revoked = 1 WHERE user_id = ?').bind(userId).run();
  }

  return jsonResponse(0, active ? '已启用' : '已禁用');
}

async function handleAdminVerifySelfPwd(request, db, decoded) {
  const body = await request.json();
  const password = body.password;

  const user = await db.prepare('SELECT password_hash FROM users WHERE id = ? AND is_deleted = 0 LIMIT 1').bind(decoded.id).first();
  if (!user) {
    return jsonResponse(400, '用户不存在');
  }

  if (await verifyPassword(password, user.password_hash)) {
    return jsonResponse(0, '验证成功');
  }
  return jsonResponse(400, '密码不正确');
}

async function handleAdminLogs(request, db) {
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get('page') || '1');
  const pageSize = parseInt(url.searchParams.get('page_size') || '20');

  const count = await db.prepare('SELECT COUNT(*) as cnt FROM session_logs').first();
  const offset = (page - 1) * pageSize;

  const rows = await db.prepare(
    'SELECT * FROM session_logs ORDER BY login_at DESC LIMIT ? OFFSET ?'
  ).bind(pageSize, offset).all();

  return jsonResponse(0, 'ok', {
    total: parseInt(count.cnt || 0),
    page,
    page_size: pageSize,
    list: rows.results || [],
  });
}

async function handleAdminAnnouncements(db) {
  const rows = await db.prepare('SELECT * FROM announcements WHERE is_deleted = 0 ORDER BY priority DESC, id DESC').all();
  return jsonResponse(0, 'ok', rows.results || []);
}

async function handleCreateAnnouncement(request, db, userId) {
  const body = await request.json();

  const result = await db.prepare(
    'INSERT INTO announcements(title, content, banner_level, priority, is_pinned, is_active, effective_at, expire_at, created_by, updated_by) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    body.title || '',
    body.content || '',
    body.banner_level || 'info',
    parseInt(body.priority || 0),
    body.is_pinned ? 1 : 0,
    body.is_active !== undefined ? (body.is_active ? 1 : 0) : 1,
    body.effective_at || null,
    body.expire_at || null,
    userId,
    userId
  ).run();

  return jsonResponse(0, '添加成功', { id: result.meta.last_row_id });
}

async function handleUpdateAnnouncement(request, db, userId, annId) {
  const body = await request.json();

  const fields = [];
  const params = [];

  if ('title' in body) { fields.push('title = ?'); params.push(body.title); }
  if ('content' in body) { fields.push('content = ?'); params.push(body.content); }
  if ('banner_level' in body) { fields.push('banner_level = ?'); params.push(body.banner_level); }
  if ('priority' in body) { fields.push('priority = ?'); params.push(parseInt(body.priority)); }
  if ('is_pinned' in body) { fields.push('is_pinned = ?'); params.push(body.is_pinned ? 1 : 0); }
  if ('is_active' in body) { fields.push('is_active = ?'); params.push(body.is_active ? 1 : 0); }
  if ('effective_at' in body) { fields.push('effective_at = ?'); params.push(body.effective_at || null); }
  if ('expire_at' in body) { fields.push('expire_at = ?'); params.push(body.expire_at || null); }

  if (fields.length === 0) {
    return jsonResponse(400, '没有需要更新的字段');
  }

  fields.push('updated_by = ?');
  params.push(userId);
  fields.push('updated_at = datetime(\'now\')');
  params.push(annId);

  const result = await db.prepare(
    `UPDATE announcements SET ${fields.join(', ')} WHERE id = ?`
  ).bind(...params).run();

  if (result.meta.changes > 0) {
    return jsonResponse(0, '更新成功');
  }
  return jsonResponse(404, '公告不存在');
}

async function handleDeleteAnnouncement(db, annId) {
  const result = await db.prepare('UPDATE announcements SET is_deleted = 1 WHERE id = ?').bind(annId).run();
  if (result.meta.changes > 0) {
    return jsonResponse(0, '删除成功');
  }
  return jsonResponse(404, '公告不存在');
}

async function handlePinAnnouncement(request, db, annId) {
  const body = await request.json();
  const pinned = body.is_pinned ? 1 : 0;

  await db.prepare('UPDATE announcements SET is_pinned = ?, updated_at = datetime(\'now\') WHERE id = ?').bind(pinned, annId).run();
  return jsonResponse(0, pinned ? '已置顶' : '已取消置顶');
}


async function handlePublicAnnouncements(db) {
  const rows = await db.prepare('SELECT * FROM announcements WHERE is_deleted = 0 AND is_active = 1 ORDER BY priority DESC, id DESC').all();
  return jsonResponse(0, 'ok', rows.results || []);
}

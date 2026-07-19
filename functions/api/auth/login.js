const CAPTCHA_STORE = new Map();

export async function onRequestPost(context) {
  const { request, env } = context;
  
  try {
    const body = await request.json();
    const { account_no, password, captcha_id, captcha_code } = body;
    
    if (!account_no || !password) {
      return jsonResponse(400, '账号或密码不能为空');
    }
    
    const captcha = CAPTCHA_STORE.get(captcha_id);
    if (!captcha || captcha.expiresAt < Date.now()) {
      CAPTCHA_STORE.delete(captcha_id);
      return jsonResponse(400, '验证码已过期，请刷新重试');
    }
    
    if (captcha.code.toLowerCase() !== captcha_code.toLowerCase()) {
      CAPTCHA_STORE.delete(captcha_id);
      return jsonResponse(400, '验证码错误');
    }
    
    CAPTCHA_STORE.delete(captcha_id);
    
    if (!env.DB) {
      return jsonResponse(500, '数据库未配置');
    }
    
    await initDb(env);
    
    const user = await env.DB.prepare('SELECT * FROM users WHERE account_no = ? AND is_deleted = 0 LIMIT 1')
      .bind(account_no).first();
    
    if (!user) {
      return jsonResponse(401, '账号或密码错误');
    }
    
    const isValid = await verifyPassword(password, user.password_hash);
    
    if (!isValid) {
      return jsonResponse(401, '账号或密码错误');
    }
    
    if (user.is_active === 0) {
      return jsonResponse(403, '账号已被禁用');
    }
    
    await env.DB.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(user.id).run();
    
    const token = await generateJwt({ id: user.id, account_no: user.account_no, role: user.role }, env);
    
    return jsonResponse(0, '登录成功', {
      token,
      user: {
        id: user.id,
        account_no: user.account_no,
        nickname: user.nickname,
        role: user.role,
        is_active: user.is_active
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    return jsonResponse(500, '登录失败: ' + error.message);
  }
}

async function initDb(env) {
  const db = env.DB;
  
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_no CHAR(6) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_login_at TIMESTAMP,
      is_deleted BOOLEAN NOT NULL DEFAULT 0,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      last_failed_at TIMESTAMP,
      locked_until TIMESTAMP,
      nickname VARCHAR(32) NOT NULL DEFAULT '',
      phone VARCHAR(20) NOT NULL DEFAULT '',
      is_active BOOLEAN NOT NULL DEFAULT 1,
      role INTEGER NOT NULL DEFAULT 0
    )
  `).run();
  
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type CHAR(4) NOT NULL,
      name VARCHAR(20) NOT NULL,
      is_system BOOLEAN NOT NULL DEFAULT 0,
      sort INTEGER NOT NULL DEFAULT 0,
      disabled BOOLEAN NOT NULL DEFAULT 0
    )
  `).run();
  
  await db.prepare(`
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
    )
  `).run();
  
  await db.prepare(`
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
    )
  `).run();
  
  await db.prepare(`
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
    )
  `).run();
  
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS session_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      login_ip VARCHAR(50),
      login_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      status VARCHAR(20) NOT NULL DEFAULT 'success'
    )
  `).run();
  
  await ensureAdminUser(env);
}

async function ensureAdminUser(env) {
  const db = env.DB;
  const result = await db.prepare('SELECT id FROM users WHERE account_no = ? AND is_deleted = 0 LIMIT 1').bind('100000').first();
  
  if (result) return;
  
  const pwdHash = await generatePasswordHash('123456');
  await db.prepare(`
    INSERT INTO users(account_no, password_hash, role, nickname, is_active) 
    VALUES(?, ?, 1, '超级管理员', 1)
  `).bind('100000', pwdHash).run();
  
  const admin = await db.prepare('SELECT id FROM users WHERE account_no = ? LIMIT 1').bind('100000').first();
  const adminId = admin.id;
  
  const SYSTEM_CATEGORIES = {
    '收入': ['房租', '网费', '取暖费', '房租押金', '门禁卡押金', '违约金', '其他'],
    '支出': ['网费', '招租费', '配件', '工人费', '保洁费', '水电', '维修', '其他']
  };
  
  for (const [type, names] of Object.entries(SYSTEM_CATEGORIES)) {
    for (let i = 0; i < names.length; i++) {
      await db.prepare(`
        INSERT OR IGNORE INTO categories(user_id, type, name, is_system, sort)
        VALUES(?, ?, ?, 1, ?)
      `).bind(adminId, type, names[i], i).run();
    }
  }
}

function jsonResponse(code, msg, data = null) {
  return new Response(JSON.stringify({ code, msg, data }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

async function generateJwt(payload, env) {
  const secret = env.JWT_SECRET || 'jizhang-system-secret-key-2024';
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payloadStr = btoa(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60 }));
  const signature = await HMACSHA256(`${header}.${payloadStr}`, secret);
  return `${header}.${payloadStr}.${btoa(signature)}`;
}

async function verifyJwt(token, env) {
  try {
    const secret = env.JWT_SECRET || 'jizhang-system-secret-key-2024';
    const [header, payloadStr, signature] = token.split('.');
    
    const expectedSignature = await HMACSHA256(`${header}.${payloadStr}`, secret);
    if (signature !== btoa(expectedSignature)) {
      return null;
    }
    
    const payload = JSON.parse(atob(payloadStr));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    
    return payload;
  } catch {
    return null;
  }
}

async function HMACSHA256(message, secret) {
  const encoder = new TextEncoder();
  const key = encoder.encode(secret);
  const data = encoder.encode(message);
  
  const signature = await crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), data);
  const bytes = new Uint8Array(signature);
  let result = '';
  for (let i = 0; i < bytes.length; i++) {
    result += String.fromCharCode(bytes[i]);
  }
  return result;
}

async function generatePasswordHash(password) {
  const saltRounds = 10;
  const salt = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(Math.random().toString()));
  const saltStr = Array.from(new Uint8Array(salt)).map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 22);
  
  const data = new TextEncoder().encode(password + saltStr);
  let hash = await crypto.subtle.digest('SHA-256', data);
  for (let i = 0; i < saltRounds; i++) {
    hash = await crypto.subtle.digest('SHA-256', new Uint8Array([...new Uint8Array(hash), ...data]));
  }
  
  const hashStr = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `$2b$${saltRounds}$${saltStr}${hashStr}`;
}

async function verifyPassword(password, hash) {
  const parts = hash.split('$');
  if (parts.length !== 4) return false;
  
  const saltRounds = parseInt(parts[2]);
  const saltStr = parts[3].substring(0, 22);
  
  const data = new TextEncoder().encode(password + saltStr);
  let computedHash = await crypto.subtle.digest('SHA-256', data);
  for (let i = 0; i < saltRounds; i++) {
    computedHash = await crypto.subtle.digest('SHA-256', new Uint8Array([...new Uint8Array(computedHash), ...data]));
  }
  
  const computedHashStr = Array.from(new Uint8Array(computedHash)).map(b => b.toString(16).padStart(2, '0')).join('');
  return hash === `$2b$${saltRounds}$${saltStr}${computedHashStr}`;
}
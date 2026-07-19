export async function onRequestPost(context) {
  const { request, env } = context;
  
  try {
    const body = await request.json();
    const { account_no, password, nickname } = body;
    
    if (!account_no || !password) {
      return jsonResponse(400, '账号或密码不能为空');
    }
    
    if (!env.DB) {
      return jsonResponse(500, '数据库未配置');
    }
    
    await initDb(env);
    
    const existing = await env.DB.prepare('SELECT id FROM users WHERE account_no = ? AND is_deleted = 0 LIMIT 1')
      .bind(account_no).first();
    
    if (existing) {
      return jsonResponse(409, '该账号已被占用');
    }
    
    const hash = await generatePasswordHash(password);
    
    await env.DB.prepare('INSERT INTO users(account_no, password_hash, nickname, role, is_active) VALUES(?, ?, ?, 0, 1)')
      .bind(account_no, hash, nickname || '').run();
    
    const newUser = await env.DB.prepare('SELECT id FROM users WHERE account_no = ? LIMIT 1').bind(account_no).first();
    const userId = newUser.id;
    
    const SYSTEM_CATEGORIES = {
      '收入': ['房租', '网费', '取暖费', '房租押金', '门禁卡押金', '违约金', '其他'],
      '支出': ['网费', '招租费', '配件', '工人费', '保洁费', '水电', '维修', '其他']
    };
    
    for (const [type, names] of Object.entries(SYSTEM_CATEGORIES)) {
      for (let i = 0; i < names.length; i++) {
        await env.DB.prepare('INSERT OR IGNORE INTO categories(user_id, type, name, is_system, sort) VALUES(?, ?, ?, 1, ?)')
          .bind(userId, type, names[i], i).run();
      }
    }
    
    return jsonResponse(0, '注册成功', { account_no });
  } catch (error) {
    console.error('Register error:', error);
    return jsonResponse(500, '注册失败: ' + error.message);
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
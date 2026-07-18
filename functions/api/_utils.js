export const JWT_SECRET = 'jizhang-system-secret-key-2024';

export async function query(db, sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length > 0) {
    stmt.bind(...params);
  }
  const result = await stmt.all();
  return result.results || [];
}

export async function queryOne(db, sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length > 0) {
    stmt.bind(...params);
  }
  const result = await stmt.first();
  return result || null;
}

export async function execute(db, sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length > 0) {
    stmt.bind(...params);
  }
  return await stmt.run();
}

export function generateToken(payload) {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payloadStr = btoa(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60 }));
  const signature = btoa(HMACSHA256(`${header}.${payloadStr}`, JWT_SECRET));
  return `${header}.${payloadStr}.${signature}`;
}

export function verifyToken(token) {
  try {
    const [header, payloadStr, signature] = token.split('.');
    const expectedSignature = btoa(HMACSHA256(`${header}.${payloadStr}`, JWT_SECRET));
    
    if (signature !== expectedSignature) {
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

function HMACSHA256(message, secret) {
  const encoder = new TextEncoder();
  const key = encoder.encode(secret);
  const data = encoder.encode(message);
  
  return crypto.subtle.sign('HMAC', crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), data)
    .then(signature => {
      const bytes = new Uint8Array(signature);
      let result = '';
      for (let i = 0; i < bytes.length; i++) {
        result += String.fromCharCode(bytes[i]);
      }
      return result;
    });
}

export async function getUserFromRequest(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  
  const token = authHeader.substring(7);
  const payload = await verifyToken(token);
  
  if (!payload || !payload.id) {
    return null;
  }
  
  return await queryOne(env.DB, 'SELECT id, account_no, nickname, role, is_active FROM users WHERE id = ?', [payload.id]);
}

export function jsonResponse(code, msg, data = null) {
  return new Response(JSON.stringify({ code, msg, data }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

export async function initSchema(db) {
  const schema = `
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_no TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      nickname TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      role INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_login_at TEXT DEFAULT NULL
    );
    
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      category TEXT NOT NULL,
      amount REAL NOT NULL,
      description TEXT DEFAULT '',
      room TEXT DEFAULT '',
      tx_date TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      is_deleted INTEGER DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    
    CREATE TABLE IF NOT EXISTS reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      tenant_name TEXT NOT NULL,
      room TEXT DEFAULT '',
      amount REAL NOT NULL,
      due_day INTEGER DEFAULT 1,
      last_paid_date TEXT DEFAULT NULL,
      status TEXT DEFAULT 'pending',
      remark TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    
    CREATE TABLE IF NOT EXISTS announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT DEFAULT '',
      is_pinned INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `;
  
  const statements = schema.split(';').filter(s => s.trim());
  for (const stmt of statements) {
    try {
      await execute(db, stmt);
    } catch (e) {
      console.log('Schema init error:', e.message);
    }
  }
}

export async function seedDefaultAdmin(db) {
  const existing = await queryOne(db, 'SELECT id FROM users WHERE account_no = ?', ['100000']);
  if (existing) return;
  
  const bcrypt = await import('https://cdn.jsdelivr.net/npm/bcryptjs@2.4.3/dist/bcrypt.min.js');
  const hash = await bcrypt.hash('123456', 10);
  
  await execute(db, `
    INSERT INTO users (account_no, password_hash, nickname, role, is_active)
    VALUES ('100000', ?, '超级管理员', 1, 1)
  `, [hash]);
  
  const admin = await queryOne(db, 'SELECT id FROM users WHERE account_no = ?', ['100000']);
  if (admin) {
    const categories = [
      ['收入', ['房租', '工资', '奖金', '投资收益', '其他收入']],
      ['支出', ['招租费', '水电费', '物业费', '维修费', '其他支出']]
    ];
    
    for (const [type, names] of categories) {
      for (let i = 0; i < names.length; i++) {
        await execute(db, `
          INSERT INTO categories (user_id, type, name, sort_order)
          VALUES (?, ?, ?, ?)
        `, [admin.id, type, names[i], i]);
      }
    }
  }
}
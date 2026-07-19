export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;
  
  if (!path.startsWith('/api/')) {
    return null;
  }
  
  try {
    return await handleApiRequest(request, env, path);
  } catch (error) {
    console.error('API error:', error);
    return new Response(JSON.stringify({ code: 500, msg: '服务器错误' }), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }
}

const CAPTCHA_STORE = new Map();

async function handleApiRequest(request, env, path) {
  const method = request.method;
  
  if (path === '/api/auth/captcha' && method === 'GET') {
    const { captcha_id, code, svg } = generateCaptcha();
    CAPTCHA_STORE.set(captcha_id, { code, expiresAt: Date.now() + 5 * 60 * 1000 });
    return new Response(JSON.stringify({ code: 0, msg: 'ok', data: { captcha_id, image: svg, ttl: 300, length: 4 } }), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }
  
  if (path === '/api/system/health' && method === 'GET') {
    return jsonResponse(0, 'ok', { status: 'running', hasDb: !!env.DB });
  }
  
  if (path === '/api/auth/login' && method === 'POST') {
    return await handleLogin(request, env);
  }
  
  if (path === '/api/auth/register' && method === 'POST') {
    return await handleRegister(request, env);
  }
  
  const token = getToken(request);
  if (!token) {
    return jsonResponse(401, '未登录');
  }
  
  const decoded = await verifyJwt(token, env);
  if (!decoded) {
    return jsonResponse(401, '登录已过期');
  }
  
  if (path === '/api/dashboard/summary' && method === 'GET') {
    return await handleDashboardSummary(request, env, decoded);
  }
  
  if (path === '/api/dashboard/recent' && method === 'GET') {
    return await handleDashboardRecent(request, env, decoded);
  }
  
  if (path === '/api/transactions' && method === 'GET') {
    return await handleTransactionsList(request, env, decoded);
  }
  
  if (path === '/api/transactions' && method === 'POST') {
    return await handleTransactionsCreate(request, env, decoded);
  }
  
  if (path.startsWith('/api/transactions/') && method === 'PUT') {
    return await handleTransactionsUpdate(request, env, decoded, path);
  }
  
  if (path.startsWith('/api/transactions/') && method === 'DELETE') {
    return await handleTransactionsDelete(request, env, decoded, path);
  }
  
  if (path === '/api/categories' && method === 'GET') {
    return await handleCategoriesList(request, env, decoded);
  }
  
  if (path === '/api/categories' && method === 'POST') {
    return await handleCategoriesCreate(request, env, decoded);
  }
  
  if (path.startsWith('/api/categories/') && method === 'PUT') {
    return await handleCategoriesUpdate(request, env, decoded, path);
  }
  
  if (path.startsWith('/api/categories/') && method === 'DELETE') {
    return await handleCategoriesDelete(request, env, decoded, path);
  }
  
  if (path === '/api/reminders' && method === 'GET') {
    return await handleRemindersList(request, env, decoded);
  }
  
  if (path === '/api/reminders' && method === 'POST') {
    return await handleRemindersCreate(request, env, decoded);
  }
  
  if (path.startsWith('/api/reminders/') && method === 'PUT') {
    return await handleRemindersUpdate(request, env, decoded, path);
  }
  
  if (path.startsWith('/api/reminders/') && method === 'DELETE') {
    return await handleRemindersDelete(request, env, decoded, path);
  }
  
  if (path === '/api/stats/income-expense' && method === 'GET') {
    return await handleStatsIncomeExpense(request, env, decoded);
  }
  
  if (path === '/api/stats/category-summary' && method === 'GET') {
    return await handleStatsCategorySummary(request, env, decoded);
  }
  
  if (path === '/api/stats/monthly-trend' && method === 'GET') {
    return await handleStatsMonthlyTrend(request, env, decoded);
  }
  
  if (path === '/api/announcements' && method === 'GET') {
    return await handleAnnouncementsList(request, env);
  }
  
  if (path === '/api/announcements' && method === 'POST') {
    return await handleAnnouncementsCreate(request, env, decoded);
  }
  
  if (path.startsWith('/api/announcements/') && method === 'PUT') {
    return await handleAnnouncementsUpdate(request, env, decoded, path);
  }
  
  if (path.startsWith('/api/announcements/') && method === 'DELETE') {
    return await handleAnnouncementsDelete(request, env, decoded, path);
  }
  
  if (path === '/api/admin/users' && method === 'GET') {
    return await handleAdminUsersList(request, env, decoded);
  }
  
  if (path.startsWith('/api/admin/users/') && method === 'PUT') {
    return await handleAdminUsersUpdate(request, env, decoded, path);
  }
  
  if (path.startsWith('/api/admin/users/') && method === 'DELETE') {
    return await handleAdminUsersDelete(request, env, decoded, path);
  }
  
  if (path === '/api/admin/session-logs' && method === 'GET') {
    return await handleAdminSessionLogs(request, env, decoded);
  }
  
  return jsonResponse(404, '接口不存在');
}

async function handleLogin(request, env) {
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
}

async function handleRegister(request, env) {
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
}

async function handleDashboardSummary(request, env, decoded) {
  const today = new Date().toISOString().split('T')[0];
  
  const incomeResult = await env.DB.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE user_id = ? AND type = ? AND trans_date >= ? AND deleted = 0')
    .bind(decoded.id, '收入', today).first();
  const expenseResult = await env.DB.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE user_id = ? AND type = ? AND trans_date >= ? AND deleted = 0')
    .bind(decoded.id, '支出', today).first();
  const txCount = await env.DB.prepare('SELECT COUNT(*) as cnt FROM transactions WHERE user_id = ? AND deleted = 0')
    .bind(decoded.id).first();
  const remCount = await env.DB.prepare('SELECT COUNT(*) as cnt FROM reminders WHERE user_id = ? AND status = ? AND deleted = 0')
    .bind(decoded.id, '未完成').first();
  
  return jsonResponse(0, 'ok', {
    today_income: parseFloat(incomeResult.total || 0),
    today_expense: parseFloat(expenseResult.total || 0),
    tx_count: parseInt(txCount.cnt || 0),
    pending_reminders: parseInt(remCount.cnt || 0)
  });
}

async function handleDashboardRecent(request, env, decoded) {
  const limit = parseInt(new URL(request.url).searchParams.get('limit') || '5');
  const recent = await env.DB.prepare(`
    SELECT id, type, category, amount, description, room_no, trans_date, created_at 
    FROM transactions WHERE user_id = ? AND deleted = 0 ORDER BY created_at DESC LIMIT ?
  `).bind(decoded.id, limit).all();
  
  return jsonResponse(0, 'ok', recent.results || []);
}

async function handleTransactionsList(request, env, decoded) {
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get('page') || '1');
  const page_size = parseInt(url.searchParams.get('page_size') || '20');
  const offset = (page - 1) * page_size;
  
  let query = `
    SELECT id, type, category, amount, description, room_no, trans_date, tag, created_at, updated_at 
    FROM transactions WHERE user_id = ? AND deleted = 0 ORDER BY trans_date DESC, id DESC LIMIT ? OFFSET ?
  `;
  let params = [decoded.id, page_size, offset];
  
  const type = url.searchParams.get('type');
  if (type) {
    query = `
      SELECT id, type, category, amount, description, room_no, trans_date, tag, created_at, updated_at 
      FROM transactions WHERE user_id = ? AND type = ? AND deleted = 0 ORDER BY trans_date DESC, id DESC LIMIT ? OFFSET ?
    `;
    params = [decoded.id, type, page_size, offset];
  }
  
  const results = await env.DB.prepare(query).bind(...params).all();
  
  const countQuery = type 
    ? 'SELECT COUNT(*) as cnt FROM transactions WHERE user_id = ? AND type = ? AND deleted = 0'
    : 'SELECT COUNT(*) as cnt FROM transactions WHERE user_id = ? AND deleted = 0';
  const countParams = type ? [decoded.id, type] : [decoded.id];
  const countResult = await env.DB.prepare(countQuery).bind(...countParams).first();
  
  return jsonResponse(0, 'ok', {
    list: results.results || [],
    total: parseInt(countResult.cnt || 0),
    page,
    page_size
  });
}

async function handleTransactionsCreate(request, env, decoded) {
  const body = await request.json();
  const { type, category, amount, description, room_no, trans_date, tag } = body;
  
  if (!type || !category || !amount || !trans_date) {
    return jsonResponse(400, '必填字段不能为空');
  }
  
  await env.DB.prepare(`
    INSERT INTO transactions(user_id, type, category, amount, description, room_no, trans_date, tag)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(decoded.id, type, category, amount, description || '', room_no || '', trans_date, tag || '').run();
  
  return jsonResponse(0, '添加成功');
}

async function handleTransactionsUpdate(request, env, decoded, path) {
  const id = parseInt(path.split('/').pop());
  const body = await request.json();
  const { type, category, amount, description, room_no, trans_date, tag } = body;
  
  if (!type || !category || !amount || !trans_date) {
    return jsonResponse(400, '必填字段不能为空');
  }
  
  await env.DB.prepare(`
    UPDATE transactions SET type = ?, category = ?, amount = ?, description = ?, 
      room_no = ?, trans_date = ?, tag = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ? AND deleted = 0
  `).bind(type, category, amount, description || '', room_no || '', trans_date, tag || '', id, decoded.id).run();
  
  return jsonResponse(0, '更新成功');
}

async function handleTransactionsDelete(request, env, decoded, path) {
  const id = parseInt(path.split('/').pop());
  
  await env.DB.prepare('UPDATE transactions SET deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?')
    .bind(id, decoded.id).run();
  
  return jsonResponse(0, '删除成功');
}

async function handleCategoriesList(request, env, decoded) {
  const url = new URL(request.url);
  const type = url.searchParams.get('type');
  
  let query = 'SELECT id, type, name, is_system, disabled FROM categories WHERE user_id = ? AND disabled = 0 ORDER BY sort';
  let params = [decoded.id];
  
  if (type) {
    query += ' AND type = ?';
    params.push(type);
  }
  
  const results = await env.DB.prepare(query).bind(...params).all();
  
  return jsonResponse(0, 'ok', results.results || []);
}

async function handleCategoriesCreate(request, env, decoded) {
  const body = await request.json();
  const { type, name } = body;
  
  if (!type || !name) {
    return jsonResponse(400, '类型和名称不能为空');
  }
  
  await env.DB.prepare('INSERT INTO categories(user_id, type, name, is_system, sort) VALUES(?, ?, ?, 0, 0)')
    .bind(decoded.id, type, name).run();
  
  return jsonResponse(0, '添加成功');
}

async function handleCategoriesUpdate(request, env, decoded, path) {
  const id = parseInt(path.split('/').pop());
  const body = await request.json();
  
  await env.DB.prepare('UPDATE categories SET name = ?, sort = ? WHERE id = ? AND user_id = ?')
    .bind(body.name, body.sort || 0, id, decoded.id).run();
  
  return jsonResponse(0, '更新成功');
}

async function handleCategoriesDelete(request, env, decoded, path) {
  const id = parseInt(path.split('/').pop());
  
  await env.DB.prepare('UPDATE categories SET disabled = 1 WHERE id = ? AND user_id = ?')
    .bind(id, decoded.id).run();
  
  return jsonResponse(0, '删除成功');
}

async function handleRemindersList(request, env, decoded) {
  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  
  let query = 'SELECT * FROM reminders WHERE user_id = ? AND deleted = 0 ORDER BY due_date DESC';
  let params = [decoded.id];
  
  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }
  
  const results = await env.DB.prepare(query).bind(...params).all();
  
  return jsonResponse(0, 'ok', results.results || []);
}

async function handleRemindersCreate(request, env, decoded) {
  const body = await request.json();
  const { room_no, rent_amount, due_date, lease_end_date, remark } = body;
  
  if (!room_no || !rent_amount || !due_date) {
    return jsonResponse(400, '必填字段不能为空');
  }
  
  await env.DB.prepare(`
    INSERT INTO reminders(user_id, room_no, rent_amount, due_date, lease_end_date, remark)
    VALUES(?, ?, ?, ?, ?, ?)
  `).bind(decoded.id, room_no, rent_amount, due_date, lease_end_date || null, remark || '').run();
  
  return jsonResponse(0, '添加成功');
}

async function handleRemindersUpdate(request, env, decoded, path) {
  const id = parseInt(path.split('/').pop());
  const body = await request.json();
  
  await env.DB.prepare(`
    UPDATE reminders SET room_no = ?, rent_amount = ?, due_date = ?, lease_end_date = ?, 
      status = ?, remark = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ?
  `).bind(body.room_no, body.rent_amount, body.due_date, body.lease_end_date || null, body.status || '未完成', body.remark || '', id, decoded.id).run();
  
  return jsonResponse(0, '更新成功');
}

async function handleRemindersDelete(request, env, decoded, path) {
  const id = parseInt(path.split('/').pop());
  
  await env.DB.prepare('UPDATE reminders SET deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?')
    .bind(id, decoded.id).run();
  
  return jsonResponse(0, '删除成功');
}

async function handleStatsIncomeExpense(request, env, decoded) {
  const url = new URL(request.url);
  const month = url.searchParams.get('month') || new Date().toISOString().slice(0, 7);
  
  const results = await env.DB.prepare(`
    SELECT type, SUM(amount) as total 
    FROM transactions WHERE user_id = ? AND trans_date LIKE ? AND deleted = 0
    GROUP BY type
  `).bind(decoded.id, month + '%').all();
  
  const data = { income: 0, expense: 0 };
  for (const row of results.results || []) {
    data[row.type === '收入' ? 'income' : 'expense'] = parseFloat(row.total || 0);
  }
  
  return jsonResponse(0, 'ok', data);
}

async function handleStatsCategorySummary(request, env, decoded) {
  const url = new URL(request.url);
  const month = url.searchParams.get('month') || new Date().toISOString().slice(0, 7);
  const type = url.searchParams.get('type') || '支出';
  
  const results = await env.DB.prepare(`
    SELECT category, SUM(amount) as total 
    FROM transactions WHERE user_id = ? AND type = ? AND trans_date LIKE ? AND deleted = 0
    GROUP BY category ORDER BY total DESC
  `).bind(decoded.id, type, month + '%').all();
  
  return jsonResponse(0, 'ok', results.results || []);
}

async function handleStatsMonthlyTrend(request, env, decoded) {
  const url = new URL(request.url);
  const months = parseInt(url.searchParams.get('months') || '12');
  
  const results = await env.DB.prepare(`
    SELECT STRFTIME('%Y-%m', trans_date) as month, type, SUM(amount) as total 
    FROM transactions WHERE user_id = ? AND deleted = 0
    GROUP BY month, type ORDER BY month
  `).bind(decoded.id).all();
  
  const trend = [];
  const today = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const monthStr = d.toISOString().slice(0, 7);
    trend.push({ month: monthStr, income: 0, expense: 0 });
  }
  
  for (const row of results.results || []) {
    const idx = trend.findIndex(t => t.month === row.month);
    if (idx >= 0) {
      trend[idx][row.type === '收入' ? 'income' : 'expense'] = parseFloat(row.total || 0);
    }
  }
  
  return jsonResponse(0, 'ok', trend);
}

async function handleAnnouncementsList(request, env) {
  const results = await env.DB.prepare(`
    SELECT id, title, content, banner_level, priority, is_pinned, is_active, 
      effective_at, expire_at, created_at, updated_at
    FROM announcements WHERE is_active = 1 AND is_deleted = 0 
    ORDER BY is_pinned DESC, priority DESC, created_at DESC
  `).all();
  
  return jsonResponse(0, 'ok', results.results || []);
}

async function handleAnnouncementsCreate(request, env, decoded) {
  if (decoded.role !== 1) {
    return jsonResponse(403, '无权限');
  }
  
  const body = await request.json();
  const { title, content, banner_level, priority, is_pinned, effective_at, expire_at } = body;
  
  if (!title || !content) {
    return jsonResponse(400, '标题和内容不能为空');
  }
  
  await env.DB.prepare(`
    INSERT INTO announcements(title, content, banner_level, priority, is_pinned, 
      effective_at, expire_at, created_by, updated_by)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(title, content, banner_level || 'info', priority || 0, is_pinned || 0, 
    effective_at || null, expire_at || null, decoded.id, decoded.id).run();
  
  return jsonResponse(0, '添加成功');
}

async function handleAnnouncementsUpdate(request, env, decoded, path) {
  if (decoded.role !== 1) {
    return jsonResponse(403, '无权限');
  }
  
  const id = parseInt(path.split('/').pop());
  const body = await request.json();
  
  await env.DB.prepare(`
    UPDATE announcements SET title = ?, content = ?, banner_level = ?, priority = ?, 
      is_pinned = ?, is_active = ?, effective_at = ?, expire_at = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(body.title, body.content, body.banner_level || 'info', body.priority || 0, 
    body.is_pinned || 0, body.is_active || 1, body.effective_at || null, 
    body.expire_at || null, decoded.id, id).run();
  
  return jsonResponse(0, '更新成功');
}

async function handleAnnouncementsDelete(request, env, decoded, path) {
  if (decoded.role !== 1) {
    return jsonResponse(403, '无权限');
  }
  
  const id = parseInt(path.split('/').pop());
  
  await env.DB.prepare('UPDATE announcements SET is_deleted = 1, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(decoded.id, id).run();
  
  return jsonResponse(0, '删除成功');
}

async function handleAdminUsersList(request, env, decoded) {
  if (decoded.role !== 1) {
    return jsonResponse(403, '无权限');
  }
  
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get('page') || '1');
  const page_size = parseInt(url.searchParams.get('page_size') || '20');
  const offset = (page - 1) * page_size;
  
  const results = await env.DB.prepare(`
    SELECT id, account_no, nickname, phone, role, is_active, created_at, last_login_at 
    FROM users WHERE is_deleted = 0 ORDER BY id DESC LIMIT ? OFFSET ?
  `).bind(page_size, offset).all();
  
  const countResult = await env.DB.prepare('SELECT COUNT(*) as cnt FROM users WHERE is_deleted = 0').first();
  
  return jsonResponse(0, 'ok', {
    list: results.results || [],
    total: parseInt(countResult.cnt || 0),
    page,
    page_size
  });
}

async function handleAdminUsersUpdate(request, env, decoded, path) {
  if (decoded.role !== 1) {
    return jsonResponse(403, '无权限');
  }
  
  const id = parseInt(path.split('/').pop());
  const body = await request.json();
  
  await env.DB.prepare('UPDATE users SET nickname = ?, role = ?, is_active = ? WHERE id = ?')
    .bind(body.nickname, body.role, body.is_active, id).run();
  
  return jsonResponse(0, '更新成功');
}

async function handleAdminUsersDelete(request, env, decoded, path) {
  if (decoded.role !== 1) {
    return jsonResponse(403, '无权限');
  }
  
  const id = parseInt(path.split('/').pop());
  
  await env.DB.prepare('DELETE FROM transactions WHERE user_id = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM reminders WHERE user_id = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM categories WHERE user_id = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
  
  return jsonResponse(0, '删除成功');
}

async function handleAdminSessionLogs(request, env, decoded) {
  if (decoded.role !== 1) {
    return jsonResponse(403, '无权限');
  }
  
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get('page') || '1');
  const page_size = parseInt(url.searchParams.get('page_size') || '20');
  const offset = (page - 1) * page_size;
  
  const results = await env.DB.prepare(`
    SELECT l.id, u.account_no, u.nickname, l.login_ip, l.login_time, l.status 
    FROM session_logs l LEFT JOIN users u ON l.user_id = u.id 
    ORDER BY l.login_time DESC LIMIT ? OFFSET ?
  `).bind(page_size, offset).all();
  
  const countResult = await env.DB.prepare('SELECT COUNT(*) as cnt FROM session_logs').first();
  
  return jsonResponse(0, 'ok', {
    list: results.results || [],
    total: parseInt(countResult.cnt || 0),
    page,
    page_size
  });
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

function getToken(request) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7);
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

function generateCaptcha() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  const captcha_id = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  const width = 120;
  const height = 40;
  
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;
  svg += `<rect width="${width}" height="${height}" fill="#f5f5f5"/>`;
  
  for (let i = 0; i < 4; i++) {
    const x = 10 + i * 25;
    const y = 28;
    const char = code.charAt(i);
    const fontSize = 24 + Math.random() * 4;
    const rotate = (Math.random() - 0.5) * 30;
    const color = `rgb(${100 + Math.random() * 100}, ${100 + Math.random() * 100}, ${100 + Math.random() * 100})`;
    
    svg += `<text x="${x}" y="${y}" font-size="${fontSize}" font-family="Arial, sans-serif" fill="${color}" transform="rotate(${rotate}, ${x}, ${y})" style="font-weight:bold">${char}</text>`;
  }
  
  for (let i = 0; i < 4; i++) {
    const x1 = Math.random() * width;
    const y1 = Math.random() * height;
    const x2 = Math.random() * width;
    const y2 = Math.random() * height;
    svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#d0d0d0" stroke-width="1"/>`;
  }
  
  for (let i = 0; i < 20; i++) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    const r = Math.random() * 1.5;
    svg += `<circle cx="${x}" cy="${y}" r="${r}" fill="#d0d0d0"/>`;
  }
  
  svg += '</svg>';
  
  return { captcha_id, code, svg };
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
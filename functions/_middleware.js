export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const path = url.pathname;
  
  if (!path.startsWith('/api/')) {
    return next();
  }
  
  try {
    return await handleApiRequest(request, env, path);
  } catch (error) {
    console.error('API Error:', error);
    return new Response(JSON.stringify({ code: 500, msg: '服务器错误: ' + error.message }), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }
}

async function handleApiRequest(request, env, path) {
  const method = request.method;
  
  if (path === '/api/system/health' && method === 'GET') {
    return jsonResponse(0, 'ok', { status: 'running', hasDb: !!env.DB });
  }
  
  if (path === '/api/auth/login' && method === 'POST') {
    return await handleLogin(request, env);
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
    return jsonResponse(0, 'ok', { today_income: 0, today_expense: 0, tx_count: 0, pending_reminders: 0 });
  }
  
  if (path === '/api/dashboard/recent' && method === 'GET') {
    return jsonResponse(0, 'ok', []);
  }
  
  if (path === '/api/transactions' && method === 'GET') {
    return jsonResponse(0, 'ok', { list: [], total: 0, page: 1, page_size: 20 });
  }
  
  if (path === '/api/transactions' && method === 'POST') {
    return jsonResponse(0, '添加成功');
  }
  
  if (path.startsWith('/api/transactions/') && method === 'PUT') {
    return jsonResponse(0, '更新成功');
  }
  
  if (path.startsWith('/api/transactions/') && method === 'DELETE') {
    return jsonResponse(0, '删除成功');
  }
  
  if (path === '/api/categories' && method === 'GET') {
    return jsonResponse(0, 'ok', [{ id: 1, name: '房租', type: '收入', is_system: 1, sort: 0, disabled: 0 }, { id: 2, name: '网费', type: '收入', is_system: 1, sort: 1, disabled: 0 }, { id: 3, name: '取暖费', type: '收入', is_system: 1, sort: 2, disabled: 0 }, { id: 4, name: '其他', type: '收入', is_system: 1, sort: 3, disabled: 0 }, { id: 5, name: '网费', type: '支出', is_system: 1, sort: 0, disabled: 0 }, { id: 6, name: '招租费', type: '支出', is_system: 1, sort: 1, disabled: 0 }, { id: 7, name: '维修', type: '支出', is_system: 1, sort: 2, disabled: 0 }, { id: 8, name: '其他', type: '支出', is_system: 1, sort: 3, disabled: 0 }]);
  }
  
  if (path === '/api/categories' && method === 'POST') {
    return jsonResponse(0, '添加成功');
  }
  
  if (path.startsWith('/api/categories/') && method === 'PUT') {
    return jsonResponse(0, '更新成功');
  }
  
  if (path.startsWith('/api/categories/') && method === 'DELETE') {
    return jsonResponse(0, '删除成功');
  }
  
  if (path === '/api/reminders' && method === 'GET') {
    return jsonResponse(0, 'ok', { list: [], total: 0, page: 1, page_size: 20 });
  }
  
  if (path === '/api/reminders' && method === 'POST') {
    return jsonResponse(0, '添加成功');
  }
  
  if (path.startsWith('/api/reminders/') && method === 'PUT') {
    return jsonResponse(0, '更新成功');
  }
  
  if (path.startsWith('/api/reminders/') && method === 'DELETE') {
    return jsonResponse(0, '删除成功');
  }
  
  if (path === '/api/stats/income-expense' && method === 'GET') {
    return jsonResponse(0, 'ok', { income: 0, expense: 0 });
  }
  
  if (path === '/api/stats/category-summary' && method === 'GET') {
    return jsonResponse(0, 'ok', []);
  }
  
  if (path === '/api/stats/monthly-trend' && method === 'GET') {
    const months = parseInt(new URL(request.url).searchParams.get('months') || '12');
    const trend = [];
    const today = new Date();
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      trend.push({ month: d.toISOString().slice(0, 7), income: 0, expense: 0 });
    }
    return jsonResponse(0, 'ok', trend);
  }
  
  if (path === '/api/announcements' && method === 'GET') {
    return jsonResponse(0, 'ok', []);
  }
  
  if (path === '/api/announcements' && method === 'POST') {
    if (decoded.role !== 1) return jsonResponse(403, '无权限');
    return jsonResponse(0, '添加成功');
  }
  
  if (path.startsWith('/api/announcements/') && method === 'PUT') {
    if (decoded.role !== 1) return jsonResponse(403, '无权限');
    return jsonResponse(0, '更新成功');
  }
  
  if (path.startsWith('/api/announcements/') && method === 'DELETE') {
    if (decoded.role !== 1) return jsonResponse(403, '无权限');
    return jsonResponse(0, '删除成功');
  }
  
  if (path === '/api/admin/users' && method === 'GET') {
    if (decoded.role !== 1) return jsonResponse(403, '无权限');
    return jsonResponse(0, 'ok', { list: [{ id: 1, account_no: '100000', nickname: '超级管理员', phone: '', role: 1, is_active: 1, created_at: new Date().toISOString(), last_login_at: new Date().toISOString() }], total: 1, page: 1, page_size: 20 });
  }
  
  if (path.startsWith('/api/admin/users/') && method === 'PUT') {
    if (decoded.role !== 1) return jsonResponse(403, '无权限');
    return jsonResponse(0, '更新成功');
  }
  
  if (path.startsWith('/api/admin/users/') && method === 'DELETE') {
    if (decoded.role !== 1) return jsonResponse(403, '无权限');
    return jsonResponse(0, '删除成功');
  }
  
  if (path === '/api/admin/session-logs' && method === 'GET') {
    if (decoded.role !== 1) return jsonResponse(403, '无权限');
    return jsonResponse(0, 'ok', { list: [], total: 0, page: 1, page_size: 20 });
  }
  
  return jsonResponse(404, '接口不存在');
}

async function handleLogin(request, env) {
  const body = await request.json();
  const { account_no, password } = body;
  
  if (!account_no || !password) {
    return jsonResponse(400, '账号或密码不能为空');
  }
  
  if (account_no === '100000' && password === '123456') {
    const token = await generateJwt({ id: 1, account_no: '100000', role: 1 }, env);
    return jsonResponse(0, '登录成功', { token, user: { id: 1, account_no: '100000', nickname: '超级管理员', role: 1, is_active: 1 } });
  }
  
  return jsonResponse(401, '账号或密码错误');
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

function base64urlEncode(str) {
  return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64urlDecode(str) {
  return decodeURIComponent(escape(atob(str.replace(/-/g, '+').replace(/_/g, '/'))));
}

async function generateJwt(payload, env) {
  const secret = env.JWT_SECRET || 'jizhang-system-secret-key-2024';
  const header = base64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payloadStr = base64urlEncode(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60 }));
  const data = header + '.' + payloadStr;
  const signature = await hmacSha256(data, secret);
  return header + '.' + payloadStr + '.' + signature;
}

async function verifyJwt(token, env) {
  try {
    const secret = env.JWT_SECRET || 'jizhang-system-secret-key-2024';
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, payloadStr, signature] = parts;
    const data = header + '.' + payloadStr;
    const expectedSignature = await hmacSha256(data, secret);
    if (signature !== expectedSignature) {
      return null;
    }
    const payload = JSON.parse(base64urlDecode(payloadStr));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch (e) {
    console.error('JWT verify error:', e);
    return null;
  }
}

async function hmacSha256(data, key) {
  const encoder = new TextEncoder();
  const dataBytes = encoder.encode(data);
  const keyBytes = encoder.encode(key);
  const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, dataBytes);
  const bytes = new Uint8Array(sig);
  let result = '';
  for (let i = 0; i < bytes.length; i++) {
    result += String.fromCharCode(bytes[i]);
  }
  return btoa(result).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
const CAPTCHA_STORE = new Map();

export async function onRequestGet(context) {
  const { captcha_id, code, svg } = generateCaptcha();
  CAPTCHA_STORE.set(captcha_id, { code, expiresAt: Date.now() + 5 * 60 * 1000 });
  
  return new Response(JSON.stringify({ 
    code: 0, 
    msg: 'ok', 
    data: { captcha_id, image: svg, ttl: 300, length: 4 } 
  }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
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
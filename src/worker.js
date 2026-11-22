import { SEED } from './seed.js';

const enc = new TextEncoder();
const J = (d, s = 200, h = {}) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json;charset=utf-8', 'cache-control': 'no-store', ...h } });
const rid = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
const str = (v, n) => String(v ?? '').trim().slice(0, n);
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
const eq = (a, b) => { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return !r; };
const sha = async s => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
const IMG = /^[a-z0-9]{6,40}\.(png|jpg|webp)$/, MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
const SETTING_KEYS = ['phone_intl', 'phone_display', 'wa_msg', 'wa_product_msg', 'price_note', 'hero_title', 'hero_sub', 'hero_image', 'footer_text', 'socials'];

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS settings(k TEXT PRIMARY KEY,v TEXT)`,
  `CREATE TABLE IF NOT EXISTS sections(id TEXT PRIMARY KEY,name TEXT NOT NULL,icon TEXT,descr TEXT,sort INTEGER DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY AUTOINCREMENT,section_id TEXT NOT NULL,art TEXT,name TEXT NOT NULL,descr TEXT,tags TEXT DEFAULT '[]',image TEXT,mode TEXT,sort INTEGER DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS images(k TEXT PRIMARY KEY,type TEXT,data BLOB,created INTEGER)`,
  `CREATE TABLE IF NOT EXISTS throttle(ip TEXT PRIMARY KEY,n INTEGER,t INTEGER)`,
];

let ready;
async function init(env, u) {
  await env.DB.batch(SCHEMA.map(q => env.DB.prepare(q)));
  const claim = await env.DB.prepare(`INSERT OR IGNORE INTO settings(k,v) VALUES('seeded','1')`).run();
  if (!claim.meta.changes) return;
  try {
    const put = async f => {
      try {
        const r = await env.ASSETS.fetch(new URL('/seed/' + f, u));
        if (!r.ok || !(r.headers.get('content-type') || '').startsWith('image/')) return '';
        const k = rid(14) + '.jpg';
        await env.DB.prepare('INSERT INTO images(k,type,data,created) VALUES(?,?,?,?)').bind(k, 'image/jpeg', await r.arrayBuffer(), Date.now()).run();
        return k;
      } catch (_) { return ''; }
    };
    const st = {
      phone_intl: '201557307301', phone_display: '01557307301',
      wa_msg: 'السلام عليكم، حابب أستفسر عن منتجاتكم', wa_product_msg: 'السلام عليكم، حابب أستفسر عن ',
      price_note: 'الأسعار والكميات حسب الطلب. اضغط الزر وسنرد عليك بأسرع وقت.',
      hero_title: 'هدايا ودعايا بطباعة راقية تحمل اسم علامتك',
      hero_sub: 'اختر القسم، تصفّح المنتجات، ثم أرسل استفسارك على واتساب بضغطة واحدة وسنرد عليك بالتفاصيل والأسعار.',
      hero_image: await put('hero.jpg'), footer_text: 'هدايا ودعايا مطبوعة بإتقان، تحمل اسم علامتك.',
      socials: JSON.stringify([{ p: 'facebook', url: 'https://www.facebook.com/' }, { p: 'instagram', url: 'https://www.instagram.com/' }, { p: 'tiktok', url: 'https://www.tiktok.com/' }]),
    };
    const box = await put('box.jpg');
    const q = [...Object.entries(st).map(([k, v]) => env.DB.prepare('INSERT OR REPLACE INTO settings(k,v) VALUES(?,?)').bind(k, v))];
    SEED.COLS.forEach((c, i) => q.push(env.DB.prepare('INSERT OR IGNORE INTO sections(id,name,icon,descr,sort) VALUES(?,?,?,?,?)').bind(c.id, c.n, c.i, c.d, i)));
    SEED.P.forEach((p, i) => q.push(env.DB.prepare('INSERT INTO products(section_id,art,name,descr,tags,image,mode,sort) VALUES(?,?,?,?,?,?,?,?)')
      .bind(p[0], p[1], p[2], p[3], JSON.stringify(p[4]), p[5] ? box : '', p[6] || '', i)));
    await env.DB.batch(q);
  } catch (e) {
    await env.DB.prepare(`DELETE FROM settings WHERE k='seeded'`).run();
    throw e;
  }
}

async function readAll(env) {
  const [s, c, p] = await Promise.all([
    env.DB.prepare('SELECT k,v FROM settings').all(),
    env.DB.prepare('SELECT id,name,icon,descr FROM sections ORDER BY sort,rowid').all(),
    env.DB.prepare('SELECT id,section_id,art,name,descr,tags,image,mode FROM products ORDER BY sort,id').all(),
  ]);
  const st = Object.fromEntries(s.results.map(r => [r.k, r.v]));
  try { st.socials = JSON.parse(st.socials || '[]'); } catch (_) { st.socials = []; }
  delete st.seeded;
  return { st, c: c.results, p: p.results.map(r => ({ ...r, tags: JSON.parse(r.tags || '[]') })) };
}

async function pub(env) {
  const { st, c, p } = await readAll(env);
  return {
    s: { ...st, hero_image: st.hero_image ? '/img/' + st.hero_image : '' },
    c: c.map(x => ({ id: x.id, i: x.icon, n: x.name, d: x.descr })),
    p: p.map(x => [x.section_id, x.art || 'gift', x.name, x.descr, x.tags, x.image ? '/img/' + x.image : '', x.mode || '']),
  };
}

const gc = env => env.DB.prepare(
  `DELETE FROM images WHERE created<? AND k NOT IN (SELECT image FROM products WHERE image<>'' AND image IS NOT NULL UNION SELECT v FROM settings WHERE k='hero_image' AND v<>'')`
).bind(Date.now() - 120000).run();
const dropImg = (env, k) => k ? env.DB.prepare('DELETE FROM images WHERE k=?').bind(k).run() : null;

async function img(env, k) {
  if (!IMG.test(k)) return new Response('Not found', { status: 404 });
  const r = await env.DB.prepare('SELECT type,data FROM images WHERE k=?').bind(k).first();
  if (!r) return new Response('Not found', { status: 404 });
  const d = r.data instanceof ArrayBuffer ? r.data : new Uint8Array(r.data);
  return new Response(d, { headers: { 'content-type': r.type, 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' } });
}

const cookie = (v, age, u) => `ip_s=${v}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${u.protocol === 'https:' ? '; Secure' : ''}`;
const sign = async (env, msg) => {
  const k = await crypto.subtle.importKey('raw', enc.encode('ip-session:' + env.ADMIN_PASSWORD), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
};
async function authed(req, env) {
  if (!env.ADMIN_PASSWORD) return false;
  const m = (req.headers.get('cookie') || '').match(/(?:^|; )ip_s=(\d+)\.([a-f0-9]+)/);
  return !!m && +m[1] > Date.now() && eq(await sign(env, m[1]), m[2]);
}

async function login(req, env, u) {
  if (!env.ADMIN_PASSWORD) return J({ e: 'لم يتم ضبط ADMIN_PASSWORD في Cloudflare بعد.' }, 503);
  const ip = req.headers.get('cf-connecting-ip') || 'local', now = Date.now();
  const th = await env.DB.prepare('SELECT n,t FROM throttle WHERE ip=?').bind(ip).first();
  if (th && th.n >= 5 && now - th.t < 900000) return J({ e: 'محاولات كثيرة. حاول بعد 15 دقيقة.' }, 429);
  const { password } = await req.json().catch(() => ({}));
  if (typeof password === 'string' && eq(await sha(password), await sha(env.ADMIN_PASSWORD))) {
    await env.DB.prepare('DELETE FROM throttle WHERE ip=?').bind(ip).run();
    const exp = now + 7 * 864e5;
    return J({ ok: 1 }, 200, { 'set-cookie': cookie(`${exp}.${await sign(env, String(exp))}`, 604800, u) });
  }
  const n = th && now - th.t < 900000 ? th.n + 1 : 1;
  await env.DB.prepare('INSERT OR REPLACE INTO throttle(ip,n,t) VALUES(?,?,?)').bind(ip, n, now).run();
  await new Promise(r => setTimeout(r, 700));
  return J({ e: 'كلمة المرور غير صحيحة.' }, 401);
}

const prodVals = b => [str(b.section_id, 40), /^[a-z0-9]{0,12}$/.test(b.art || '') && b.art ? b.art : 'gift', str(b.name, 120), str(b.descr, 600),
  JSON.stringify((Array.isArray(b.tags) ? b.tags : []).map(t => str(t, 40)).filter(Boolean).slice(0, 12)),
  IMG.test(b.image || '') ? b.image : '', ['cut', 'full'].includes(b.mode) ? b.mode : ''];

async function admin(req, env, u) {
  const m = req.method, [r, id] = u.pathname.slice(11).split('/');
  if (r === 'data') { const { st, c, p } = await readAll(env); return J({ s: st, c, p }); }
  if (r === 'upload' && m === 'POST') {
    const t = (req.headers.get('content-type') || '').split(';')[0], ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[t];
    if (!ext) return J({ e: 'نوع الصورة غير مدعوم (PNG / JPG / WEBP).' }, 415);
    const b = await req.arrayBuffer();
    if (!b.byteLength || b.byteLength > 1.8e6) return J({ e: 'حجم الصورة كبير جدًا (الحد 1.8MB بعد الضغط).' }, 413);
    const k = rid(14) + '.' + ext;
    await env.DB.prepare('INSERT INTO images(k,type,data,created) VALUES(?,?,?,?)').bind(k, MIME[ext], b, Date.now()).run();
    return J({ key: k, url: '/img/' + k });
  }
  const b = m === 'GET' || m === 'DELETE' ? {} : await req.json().catch(() => ({}));
  const next = async t => (await env.DB.prepare(`SELECT COALESCE(MAX(sort),0)+1 n FROM ${t}`).first()).n;

  if (r === 'settings' && m === 'PUT') {
    const old = (await env.DB.prepare(`SELECT v FROM settings WHERE k='hero_image'`).first())?.v;
    const q = [];
    for (const k of SETTING_KEYS) if (k in b) {
      let v = b[k];
      if (k === 'socials') v = JSON.stringify((Array.isArray(v) ? v : []).slice(0, 12).map(x => ({ p: str(x.p, 20), url: /^https?:\/\//.test(x.url || '') ? str(x.url, 300) : '' })));
      else if (k === 'phone_intl') v = String(v).replace(/\D/g, '').slice(0, 15);
      else if (k === 'hero_image') v = IMG.test(v || '') ? v : '';
      else v = str(v, k.includes('hero_sub') || k === 'price_note' ? 400 : 200);
      q.push(env.DB.prepare('INSERT INTO settings(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').bind(k, v));
    }
    if (q.length) await env.DB.batch(q);
    if ('hero_image' in b && old && old !== b.hero_image) await dropImg(env, old);
    await gc(env); return J({ ok: 1 });
  }
  if (r === 'sections') {
    if (m === 'POST' || m === 'PUT') {
      const v = [str(b.name, 80), /^fa-[a-z0-9-]{1,40}$/.test(b.icon || '') ? b.icon : 'fa-box', str(b.descr, 200)];
      if (!v[0]) return J({ e: 'اسم القسم مطلوب.' }, 400);
      if (m === 'POST') { const nid = 's' + rid(6); await env.DB.prepare('INSERT INTO sections(id,name,icon,descr,sort) VALUES(?,?,?,?,?)').bind(nid, ...v, await next('sections')).run(); return J({ id: nid }); }
      await env.DB.prepare('UPDATE sections SET name=?,icon=?,descr=? WHERE id=?').bind(...v, id).run(); return J({ ok: 1 });
    }
    if (m === 'DELETE') {
      const imgs = (await env.DB.prepare(`SELECT image FROM products WHERE section_id=? AND image<>''`).bind(id).all()).results;
      await env.DB.batch([env.DB.prepare('DELETE FROM products WHERE section_id=?').bind(id), env.DB.prepare('DELETE FROM sections WHERE id=?').bind(id)]);
      for (const x of imgs) await dropImg(env, x.image);
      await gc(env); return J({ ok: 1, removed: imgs.length });
    }
  }
  if (r === 'products') {
    if (m === 'POST' || m === 'PUT') {
      const v = prodVals(b);
      if (!v[2] || !v[0]) return J({ e: 'اسم المنتج والقسم مطلوبان.' }, 400);
      if (!(await env.DB.prepare('SELECT 1 FROM sections WHERE id=?').bind(v[0]).first())) return J({ e: 'القسم غير موجود.' }, 400);
      if (m === 'POST') { const x = await env.DB.prepare('INSERT INTO products(section_id,art,name,descr,tags,image,mode,sort) VALUES(?,?,?,?,?,?,?,?)').bind(...v, await next('products')).run(); return J({ id: x.meta.last_row_id }); }
      const old = (await env.DB.prepare('SELECT image FROM products WHERE id=?').bind(id).first())?.image;
      await env.DB.prepare('UPDATE products SET section_id=?,art=?,name=?,descr=?,tags=?,image=?,mode=? WHERE id=?').bind(...v, id).run();
      if (old && old !== v[5]) await dropImg(env, old);
      await gc(env); return J({ ok: 1 });
    }
    if (m === 'DELETE') {
      const old = (await env.DB.prepare('SELECT image FROM products WHERE id=?').bind(id).first())?.image;
      await env.DB.prepare('DELETE FROM products WHERE id=?').bind(id).run();
      await dropImg(env, old); await gc(env); return J({ ok: 1 });
    }
  }
  if (r === 'reorder' && m === 'POST') {
    const t = b.t === 'sections' ? 'sections' : 'products', col = t === 'sections' ? 'id' : 'id';
    await env.DB.batch((Array.isArray(b.ids) ? b.ids : []).slice(0, 500).map((x, i) => env.DB.prepare(`UPDATE ${t} SET sort=? WHERE ${col}=?`).bind(i, x)));
    return J({ ok: 1 });
  }
  return J({ e: 'not found' }, 404);
}

export default {
  async fetch(req, env) {
    const u = new URL(req.url), p = u.pathname, m = req.method;
    try {
      await (ready ??= init(env, u).catch(e => { ready = null; throw e; }));
      if (p.startsWith('/img/')) return img(env, p.slice(5));
      if (p === '/api/data') return J(await pub(env));
      if (p === '/api/me') return J({ ok: await authed(req, env) });
      if (m !== 'GET' && req.headers.get('origin') && req.headers.get('origin') !== u.origin) return J({ e: 'forbidden' }, 403);
      if (p === '/api/login' && m === 'POST') return login(req, env, u);
      if (p === '/api/logout') return J({ ok: 1 }, 200, { 'set-cookie': cookie('', 0, u) });
      if (p.startsWith('/api/admin/')) return (await authed(req, env)) ? admin(req, env, u) : J({ e: 'unauthorized' }, 401);
      return J({ e: 'not found' }, 404);
    } catch (e) {
      console.error(e);
      return J({ e: 'خطأ في السيرفر' }, 500);
    }
  },
};

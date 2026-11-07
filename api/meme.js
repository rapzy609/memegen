'use strict';
// GET /api/meme?url=<foto atau video>&top=...&bottom=...
// Hasil sama dengan generator di halaman utama (font Impact, outline, emoji, 1:1, resolusi, audio, trim 10 dtk).

const path = require('node:path');
const { renderImage } = require('./_lib/render');
const { renderVideo } = require('./_lib/video');
const { fetchMedia, FetchError } = require('./_lib/fetch-media');

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const MAX_TEXT = 200;
const MAX_VIDEO_SECONDS = Number(process.env.MAX_VIDEO_SECONDS) || 30;
const BUDGET_MS = 55000;          // sisa di bawah maxDuration 60 dtk di vercel.json
const RESPONSE_LIMIT = 4.3e6;     // batas respons fungsi Vercel ±4,5 MB
const JSON_LIMIT = 3.1e6;         // base64 membengkak ±33%
const IMG_FORMATS = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

let lib = null;
function getLib() {
  if (!lib) {
    lib = require('@napi-rs/canvas');
    lib.GlobalFonts.registerFromPath(path.join(__dirname, '..', 'impact.ttf'), 'MemeImpact');
    lib.GlobalFonts.registerFromPath(path.join(__dirname, '..', 'fonts', 'NotoColorEmoji.ttf'), 'MemeEmoji');
  }
  return lib;
}

const num = (v, def, min, max) => {
  if (v === undefined || v === null || v === '') return def;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
const bool = (v, def) => {
  if (v === undefined || v === null || v === '') return def;
  return ['1', 'true', 'yes', 'ya', 'on'].includes(String(v).toLowerCase());
};
const color = (v, def) => {
  const s = String(v ?? '').trim().replace(/^#/, '');
  return /^([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s) ? `#${s}` : def;
};
const text = (v) => String(v ?? '').replace(/\\n/g, '\n').slice(0, MAX_TEXT);

function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
const fail = (res, status, error) => send(res, status, { ok: false, error });

/** Foto: coba format diminta; bila melebihi batas respons, turunkan kualitas/ukuran (PNG → JPEG). */
async function encodeImageFit(canvasLib, img, o, limit) {
  let format = o.format;
  let note = '';
  for (const scale of [1, 0.75, 0.5]) {
    const steps = format === 'png' ? ['png', 90, 75, 60] : [o.quality, 75, 60, 45];
    for (const s of steps) {
      const opts = { ...o, maxSide: o.maxSide * scale };
      if (s === 'png') opts.format = 'png';
      else { opts.format = format === 'png' ? 'jpg' : format; opts.quality = Math.min(s, o.quality); }
      const r = await renderImage(canvasLib, img, opts);
      if (r.buffer.length <= limit) {
        if (opts.format !== o.format) note = `Hasil dikonversi ke ${opts.format.toUpperCase()} agar muat di batas respons`;
        else if (scale < 1 || (s !== 'png' && s !== o.quality)) note = 'Kualitas/ukuran diturunkan agar muat di batas respons';
        return { ...r, format: opts.format, note };
      }
    }
  }
  throw new FetchError('Hasil terlalu besar untuk batas respons server. Kecilkan maxSide.', 413);
}

module.exports = async function handler(req, res) {
  const started = Date.now();
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');
  res.setHeader('Access-Control-Expose-Headers', 'X-Meme-Width, X-Meme-Height, X-Meme-Type, X-Meme-Note');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'GET' && req.method !== 'POST') return fail(res, 405, 'Gunakan GET atau POST.');

  try {
    const query = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
    let p = { ...query };
    if (req.method === 'POST') {   // POST JSON hanya sebagai alternatif GET; tetap pakai "url"
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
      if (!body || typeof body !== 'object' || Buffer.isBuffer(body)) return fail(res, 400, 'Body POST harus JSON, mis. {"url":"...","top":"..."}.');
      p = { ...query, ...body };
    }

    const key = process.env.API_KEY;
    if (key && (req.headers['x-api-key'] || p.key) !== key) return fail(res, 401, 'API key salah atau tidak ada.');
    if (!p.url) return fail(res, 400, 'Parameter "url" wajib (link foto atau video). Lihat /docs');

    const fmt = String(p.format || '').toLowerCase();
    const asJson = fmt === 'json';
    const limit = asJson ? JSON_LIMIT : RESPONSE_LIMIT;

    const media = await fetchMedia(String(p.url), {
      maxImageBytes: MAX_IMAGE_BYTES, maxVideoBytes: MAX_VIDEO_BYTES,
      timeoutMs: 25000,
    });

    const base = {
      top: text(p.top), bottom: text(p.bottom),
      size: num(p.size, 11, 5, 20),
      outline: num(p.outline, 14, 0, 30),
      fill: color(p.fill, '#ffffff'),
      stroke: color(p.stroke, '#000000'),
      upper: bool(p.upper, true),
      square: bool(p.square, false),
    };
    const canvasLib = getLib();

    if (media.kind === 'video') {
      const resVal = Number(p.res);
      const r = await renderVideo(canvasLib, media.buffer, {
        ...base,
        res: [480, 720, 1080].includes(resVal) ? resVal : 720,
        audio: bool(p.audio, true),
        trim: bool(p.trim, false),
        maxSeconds: MAX_VIDEO_SECONDS,
        maxBytes: limit,
        deadline: started + BUDGET_MS,
      });
      if (asJson) {
        return send(res, 200, { ok: true, type: 'video', mime: 'video/mp4', width: r.width, height: r.height, duration: +r.duration.toFixed(2), data: r.buffer.toString('base64') });
      }
      return send(res, 200, r.buffer, 'video/mp4', {
        'Cache-Control': 'public, max-age=86400, s-maxage=86400',
        'X-Meme-Type': 'video', 'X-Meme-Width': String(r.width), 'X-Meme-Height': String(r.height),
        'Content-Disposition': 'inline; filename="meme.mp4"',
      });
    }

    const wanted = asJson || !fmt ? 'png' : fmt;
    if (!IMG_FORMATS[wanted]) return fail(res, 400, 'format foto: png, jpg, webp, atau json.');
    let img;
    try { img = await canvasLib.loadImage(media.buffer); }
    catch { return fail(res, 415, 'Foto tidak bisa dibaca (format tidak didukung atau file rusak).'); }

    const r = await encodeImageFit(canvasLib, img, {
      ...base,
      maxSide: num(p.maxSide, 2048, 128, 2048),
      quality: num(p.quality, 90, 30, 100),
      format: wanted === 'jpeg' ? 'jpg' : wanted,
    }, limit);
    const mime = IMG_FORMATS[r.format];

    if (asJson) return send(res, 200, { ok: true, type: 'image', mime, width: r.width, height: r.height, note: r.note || undefined, data: r.buffer.toString('base64') });
    return send(res, 200, r.buffer, mime, {
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
      'X-Meme-Type': 'image', 'X-Meme-Width': String(r.width), 'X-Meme-Height': String(r.height),
      ...(r.note ? { 'X-Meme-Note': r.note } : {}),
      'Content-Disposition': `inline; filename="meme.${r.format}"`,
    });
  } catch (e) {
    if (e instanceof FetchError) return fail(res, e.status, e.message);
    console.error('meme api error:', e);
    return fail(res, 500, 'Terjadi kesalahan di server.');
  }
};

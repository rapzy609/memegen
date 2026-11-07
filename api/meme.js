'use strict';
// GET/POST /api/meme  — buat meme (teks atas/bawah) dari URL gambar, base64, atau upload mentah.

const path = require('node:path');
const { renderMeme } = require('./_lib/render');
const { fetchImage, FetchError } = require('./_lib/fetch-image');

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_TEXT = 200;
const FORMATS = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

let lib = null;
function getLib() {
  if (!lib) {
    lib = require('@napi-rs/canvas');
    lib.GlobalFonts.registerFromPath(path.join(__dirname, '..', 'impact.ttf'), 'MemeImpact');
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

async function readRaw(req) {
  const chunks = []; let total = 0;
  for await (const c of req) {
    total += c.length;
    if (total > MAX_IMAGE_BYTES) throw new FetchError('Gambar terlalu besar (maks 8 MB).', 413);
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

function decodeBase64(s) {
  const clean = String(s).replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '');
  if (!/^[A-Za-z0-9+/=_-]+$/.test(clean)) throw new FetchError('Parameter "image" bukan base64 yang valid.');
  const buf = Buffer.from(clean, 'base64');
  if (buf.length > MAX_IMAGE_BYTES) throw new FetchError('Gambar terlalu besar (maks 8 MB).', 413);
  return buf;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');
  res.setHeader('Access-Control-Expose-Headers', 'X-Meme-Width, X-Meme-Height');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'GET' && req.method !== 'POST') return fail(res, 405, 'Gunakan GET atau POST.');

  try {
    const query = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
    const ctype = String(req.headers['content-type'] || '').toLowerCase();
    let p = { ...query };
    let imageBuf = null;

    if (req.method === 'POST') {
      if (ctype.startsWith('image/') || ctype.startsWith('application/octet-stream')) {
        imageBuf = Buffer.isBuffer(req.body) ? req.body : await readRaw(req);
      } else {
        let body = req.body;
        if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
        if (!body || typeof body !== 'object') {
          return fail(res, 400, 'Body harus JSON atau gambar mentah (Content-Type: image/*).');
        }
        p = { ...query, ...body };
      }
    }

    const key = process.env.API_KEY;
    if (key && (req.headers['x-api-key'] || p.key) !== key) return fail(res, 401, 'API key salah atau tidak ada.');

    if (!imageBuf) {
      if (p.image) imageBuf = decodeBase64(p.image);
      else if (p.url) imageBuf = await fetchImage(String(p.url), { maxBytes: MAX_IMAGE_BYTES });
      else return fail(res, 400, 'Sertakan "url" gambar, "image" (base64), atau kirim gambar mentah lewat POST. Lihat /docs');
    }
    if (!imageBuf.length) return fail(res, 400, 'Gambar kosong.');

    const format = String(p.format || 'png').toLowerCase();
    const asJson = format === 'json';
    const outFormat = asJson ? 'png' : format;
    if (!asJson && !FORMATS[outFormat]) return fail(res, 400, 'format harus png, jpg, webp, atau json.');

    const o = {
      top: text(p.top), bottom: text(p.bottom),
      size: num(p.size, 11, 5, 20),
      outline: num(p.outline, 14, 0, 30),
      fill: color(p.fill, '#ffffff'),
      stroke: color(p.stroke, '#000000'),
      upper: bool(p.upper, true),
      square: bool(p.square, false),
      maxSide: num(p.maxSide, 1024, 128, 2048),
      quality: num(p.quality, 90, 30, 100),
      format: outFormat === 'jpeg' ? 'jpg' : outFormat,
    };

    const canvasLib = getLib();
    let img;
    try { img = await canvasLib.loadImage(imageBuf); }
    catch { return fail(res, 415, 'Gambar tidak bisa dibaca (format tidak didukung atau file rusak).'); }

    const { buffer, width, height } = await renderMeme(canvasLib, img, o);
    const mime = FORMATS[outFormat];

    if (asJson) {
      return send(res, 200, { ok: true, mime, width, height, data: buffer.toString('base64') });
    }
    return send(res, 200, buffer, mime, {
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
      'X-Meme-Width': String(width),
      'X-Meme-Height': String(height),
      'Content-Disposition': `inline; filename="meme.${o.format}"`,
    });
  } catch (e) {
    if (e instanceof FetchError) return fail(res, e.status, e.message);
    console.error('meme api error:', e);
    return fail(res, 500, 'Terjadi kesalahan di server.');
  }
};

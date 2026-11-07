'use strict';
// Mengambil foto/video dari URL dengan perlindungan SSRF:
// hanya http/https port 80/443, menolak IP privat/loopback/link-local (termasuk setelah redirect),
// batas ukuran dan waktu.

const dns = require('node:dns').promises;
const net = require('node:net');

const blocked = new net.BlockList();
[
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
].forEach(([a, p]) => blocked.addSubnet(a, p, 'ipv4'));
[['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]]
  .forEach(([a, p]) => blocked.addSubnet(a, p, 'ipv6'));

class FetchError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

function isBlockedIp(ip) {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return blocked.check(mapped[1], 'ipv4');
  return blocked.check(ip, net.isIPv6(ip) ? 'ipv6' : 'ipv4');
}

async function assertPublicUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new FetchError('Parameter "url" bukan URL yang valid.'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new FetchError('URL harus http atau https.');
  if (u.username || u.password) throw new FetchError('URL tidak boleh berisi username/password.');
  const port = u.port || (u.protocol === 'https:' ? '443' : '80');
  if (port !== '80' && port !== '443') throw new FetchError('Hanya port 80/443 yang diizinkan.');

  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host)
    ? [{ address: host }]
    : await dns.lookup(host, { all: true }).catch(() => { throw new FetchError('Host URL tidak ditemukan.'); });
  if (!addrs.length || addrs.some((a) => isBlockedIp(a.address))) {
    throw new FetchError('URL mengarah ke alamat yang tidak diizinkan.', 403);
  }
  return u;
}

const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|3gp|avi)$/i;
const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|bmp)$/i;

/** 'image' | 'video' | null — dari Content-Type, lalu ekstensi URL bila servernya memberi tipe umum. */
function classify(contentType, pathname) {
  const t = (contentType || '').toLowerCase();
  if (t.startsWith('video/')) return 'video';
  if (t.startsWith('image/')) return 'image';
  if (!t || t.startsWith('application/octet-stream') || t.startsWith('binary/')) {
    if (VIDEO_EXT.test(pathname)) return 'video';
    if (IMAGE_EXT.test(pathname)) return 'image';
  }
  return null;
}

async function readLimited(res, maxBytes) {
  const len = Number(res.headers.get('content-length'));
  if (len && len > maxBytes) throw new FetchError(`File terlalu besar (maks ${Math.round(maxBytes / 1048576)} MB).`, 413);
  const chunks = [];
  let total = 0;
  for await (const chunk of res.body) {
    total += chunk.length;
    if (total > maxBytes) throw new FetchError(`File terlalu besar (maks ${Math.round(maxBytes / 1048576)} MB).`, 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * @returns {Promise<{buffer: Buffer, kind: 'image'|'video', contentType: string}>}
 */
async function fetchMedia(rawUrl, { maxImageBytes, maxVideoBytes, timeoutMs = 30000, maxRedirects = 3 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let url = rawUrl;
    for (let i = 0; i <= maxRedirects; i++) {
      const u = await assertPublicUrl(url);
      const res = await fetch(u, {
        redirect: 'manual',
        signal: ctrl.signal,
        headers: { 'user-agent': 'BikinMeme-API/1.1', accept: '*/*' },
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        url = new URL(res.headers.get('location'), u).toString();
        continue;
      }
      if (!res.ok) throw new FetchError(`Gagal mengunduh file (status ${res.status}).`, 502);
      const contentType = res.headers.get('content-type') || '';
      const kind = classify(contentType, u.pathname);
      if (!kind) throw new FetchError('URL bukan foto atau video (Content-Type harus image/* atau video/*).', 415);
      const buffer = await readLimited(res, kind === 'video' ? maxVideoBytes : maxImageBytes);
      return { buffer, kind, contentType };
    }
    throw new FetchError('Terlalu banyak redirect.', 502);
  } catch (e) {
    if (e.name === 'AbortError') throw new FetchError('Waktu mengunduh file habis.', 504);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { fetchMedia, assertPublicUrl, isBlockedIp, classify, FetchError };

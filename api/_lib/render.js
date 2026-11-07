'use strict';
// Logika tata letak teks sama dengan app.js (versi browser), tapi dijalankan di server.

const FAMILY = '"MemeImpact", Impact, "Arial Black", sans-serif';
const even = (n) => Math.max(2, Math.round(n / 2) * 2);

function wrapLines(ctx, text, maxW) {
  const out = [];
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { out.push(''); continue; }
    let line = '';
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width <= maxW || !line) line = test;
      else { out.push(line); line = w; }
    }
    out.push(line);
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  while (out.length && out[0] === '') out.shift();
  return out;
}

function layoutText(ctx, raw, W, { size, upper }) {
  let text = String(raw || '').trim();
  if (!text) return null;
  if (upper) text = text.toUpperCase();

  const maxW = W * 0.94;
  const minFs = W * 0.03;
  const base = W * (size / 100);
  let fs = base;
  let lines;
  for (;;) {
    ctx.font = `${fs}px ${FAMILY}`;
    lines = wrapLines(ctx, text, maxW);
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    const oneLine = lines.length === 1 && widest <= maxW;
    if (oneLine || fs <= minFs) break;
    if (fs <= base * 0.7 && lines.length <= 3 && widest <= maxW) break;
    fs *= 0.95;
  }
  return { lines, fs, lh: fs * 1.12 };
}

function drawBlock(ctx, block, W, H, atTop, { outline, fill, stroke }) {
  if (!block) return;
  const pad = W * 0.025;
  const total = block.lines.length * block.lh;
  let y = atTop ? pad : H - pad - total;

  ctx.font = `${block.fs}px ${FAMILY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.lineWidth = block.fs * (outline / 100);
  ctx.strokeStyle = stroke;
  ctx.fillStyle = fill;

  for (const line of block.lines) {
    if (ctx.lineWidth > 0) ctx.strokeText(line, W / 2, y);
    ctx.fillText(line, W / 2, y);
    y += block.lh;
  }
}

/**
 * @param {{createCanvas: Function}} lib  modul @napi-rs/canvas
 * @param {{width:number,height:number}} img  hasil loadImage()
 * @param {object} o  opsi: top, bottom, size, outline, fill, stroke, upper, square, maxSide, format, quality
 * @returns {Promise<{buffer: Buffer, width: number, height: number}>}
 */
async function renderMeme(lib, img, o) {
  let sw = img.width, sh = img.height, sx = 0, sy = 0;
  if (o.square) {
    const side = Math.min(sw, sh);
    sx = (sw - side) / 2; sy = (sh - side) / 2;
    sw = sh = side;
  }
  const scale = Math.min(1, o.maxSide / Math.max(sw, sh));
  const W = even(sw * scale), H = even(sh * scale);

  const canvas = lib.createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, W, H);

  const opts = { size: o.size, upper: o.upper };
  const top = layoutText(ctx, o.top, W, opts);
  const bottom = layoutText(ctx, o.bottom, W, opts);
  const style = { outline: o.outline, fill: o.fill, stroke: o.stroke };
  drawBlock(ctx, top, W, H, true, style);
  drawBlock(ctx, bottom, W, H, false, style);

  const buffer = o.format === 'png'
    ? await canvas.encode('png')
    : await canvas.encode(o.format === 'webp' ? 'webp' : 'jpeg', o.quality);
  return { buffer, width: W, height: H };
}

module.exports = { renderMeme, layoutText, wrapLines };

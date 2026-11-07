'use strict';
// Tata letak & gambar teks meme — sama dengan app.js (generator di halaman utama).
// Dipakai untuk foto (gambar + teks) dan video (overlay teks transparan yang ditempel ffmpeg).

const FAMILY = '"MemeImpact", "MemeEmoji", Impact, "Arial Black", sans-serif';
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

function drawTexts(ctx, W, H, o) {
  const opts = { size: o.size, upper: o.upper };
  const top = layoutText(ctx, o.top, W, opts);
  const bottom = layoutText(ctx, o.bottom, W, opts);
  const style = { outline: o.outline, fill: o.fill, stroke: o.stroke };
  drawBlock(ctx, top, W, H, true, style);
  drawBlock(ctx, bottom, W, H, false, style);
}

/** Hitung area potong (opsi 1:1) dan ukuran kanvas akhir. */
function computeLayout(srcW, srcH, { square, maxSide }) {
  let sw = srcW, sh = srcH, sx = 0, sy = 0;
  if (square) {
    const side = Math.min(sw, sh);
    sx = (sw - side) / 2; sy = (sh - side) / 2;
    sw = sh = side;
  }
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  return { sx, sy, sw, sh, W: even(sw * scale), H: even(sh * scale) };
}

/** Foto: gambar + teks. */
async function renderImage(lib, img, o) {
  const { sx, sy, sw, sh, W, H } = computeLayout(img.width, img.height, o);
  const canvas = lib.createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
  drawTexts(ctx, W, H, o);
  const buffer = o.format === 'png'
    ? await canvas.encode('png')
    : await canvas.encode(o.format === 'webp' ? 'webp' : 'jpeg', o.quality);
  return { buffer, width: W, height: H };
}

/** Video: PNG transparan berisi teks saja, ukuran W×H, untuk ditempel ffmpeg di setiap frame. */
async function renderOverlay(lib, W, H, o) {
  const canvas = lib.createCanvas(W, H);
  drawTexts(canvas.getContext('2d'), W, H, o);
  return canvas.encode('png');
}

module.exports = { renderImage, renderOverlay, computeLayout, layoutText, wrapLines };

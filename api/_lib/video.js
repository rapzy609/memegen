'use strict';
// Video: teks digambar sebagai PNG transparan (render.js, sama persis dengan foto/generator),
// lalu ffmpeg memotong (opsi 1:1), mengubah ukuran, menempelkan teks, dan meng-encode H.264/AAC (MP4).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { computeLayout, renderOverlay } = require('./render');
const { FetchError } = require('./fetch-media');

const FPS = 30;
const AUDIO_BPS = 96000;

let ffmpegBin = null;
function ffmpegPath() {
  if (ffmpegBin) return ffmpegBin;
  let p = process.env.FFMPEG_PATH;
  if (!p) { try { p = require('ffmpeg-static'); } catch { p = null; } }
  if (!p) throw new FetchError('ffmpeg tidak tersedia di server.', 500);
  // Pastikan bisa dieksekusi (file di bundle Vercel kadang kehilangan izin eksekusi).
  if (path.isAbsolute(p)) {
    try { fs.accessSync(p, fs.constants.X_OK); }
    catch {
      const copy = path.join(os.tmpdir(), 'ffmpeg-bin');
      if (!fs.existsSync(copy)) fs.copyFileSync(p, copy);
      fs.chmodSync(copy, 0o755);
      p = copy;
    }
  }
  return (ffmpegBin = p);
}

function run(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => { if (err.length < 64000) err += d; });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new FetchError('Waktu memproses video habis. Coba trim=true atau res=480.', 504)); }, timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, err }); });
  });
}

/** Baca ukuran tampilan, durasi, dan keberadaan audio dari keluaran `ffmpeg -i`. */
async function probe(file) {
  const { err } = await run(['-hide_banner', '-i', file], 15000);
  const v = /Stream #\d+:\d+[^\n]*Video:[^\n]*?, (\d{2,5})x(\d{2,5})([^\n]*)/.exec(err);
  if (!v) throw new FetchError('Video tidak bisa dibaca (format/codec tidak didukung atau file rusak).', 415);
  let w = +v[1], h = +v[2];
  const sar = /SAR (\d+):(\d+)/.exec(v[3]);
  const sarN = sar ? +sar[1] : 1, sarD = sar ? +sar[2] : 1;
  const hasSar = sar && sarN > 0 && sarD > 0 && sarN !== sarD;
  if (hasSar) w = Math.round((w * sarN) / sarD);
  const rot = /rotation of (-?[\d.]+) degrees/.exec(err);
  if (rot && Math.round(Math.abs(+rot[1]) / 90) % 2 === 1) [w, h] = [h, w];
  const d = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(err);
  const duration = d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : null;
  return { w, h, duration, hasSar, hasAudio: /Stream #\d+:\d+[^\n]*Audio:/.test(err) };
}

/**
 * @param {object} lib  @napi-rs/canvas
 * @param {Buffer} input  isi file video
 * @param {object} o  top,bottom,size,outline,fill,stroke,upper,square,res,audio,trim,maxSeconds,maxBytes,deadline
 */
async function renderVideo(lib, input, o) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meme-'));
  const inFile = path.join(dir, 'in.bin');
  const ovFile = path.join(dir, 'overlay.png');
  const outFile = path.join(dir, 'out.mp4');
  try {
    fs.writeFileSync(inFile, input);
    const info = await probe(inFile);

    const lay = computeLayout(info.w, info.h, { square: o.square, maxSide: o.res });
    const { W, H } = lay;
    fs.writeFileSync(ovFile, await renderOverlay(lib, W, H, o));

    const cap = o.trim ? 10 : o.maxSeconds;
    const duration = Math.min(cap, info.duration || cap);
    const withAudio = o.audio && info.hasAudio;

    const chain = [];
    if (info.hasSar) chain.push('scale=trunc(iw*sar/2)*2:ih', 'setsar=1');
    if (o.square) chain.push("crop='min(iw,ih)':'min(iw,ih)'");
    chain.push(`scale=${W}:${H}:flags=bicubic`, 'setsar=1', `fps=${FPS}`);
    const filter = `[0:v]${chain.join(',')}[b];[b][1:v]overlay=0:0:format=auto,format=yuv420p[v]`;

    // Bitrate: seperti generator (piksel×3, 1,5–12 Mbps) tetapi dibatasi agar file muat di batas respons Vercel.
    const budgetBits = o.maxBytes * 8 * 0.9;
    const budget = budgetBits / Math.max(duration, 1) - (withAudio ? AUDIO_BPS : 0);
    let bitrate = Math.floor(Math.max(150000, Math.min(Math.min(12e6, Math.max(1.5e6, W * H * 3)), budget)));

    for (let attempt = 0; attempt < 2; attempt++) {
      const args = [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-i', inFile, '-i', ovFile,
        '-filter_complex', filter,
        '-map', '[v]', ...(withAudio ? ['-map', '0:a:0'] : ['-an']),
        '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'main',
        '-b:v', String(bitrate), '-maxrate', String(Math.floor(bitrate * 1.3)), '-bufsize', String(bitrate * 2),
        ...(withAudio ? ['-c:a', 'aac', '-b:a', String(AUDIO_BPS), '-ac', '2'] : []),
        '-t', duration.toFixed(2), '-movflags', '+faststart', outFile,
      ];
      const left = o.deadline - Date.now();
      if (left < 3000) throw new FetchError('Waktu memproses video habis. Coba trim=true atau res=480.', 504);
      const { code, err } = await run(args, left);
      if (code !== 0 || !fs.existsSync(outFile)) {
        console.error('ffmpeg gagal:', err.slice(-800));
        throw new FetchError('Video gagal diproses (format/codec tidak didukung).', 415);
      }
      const buffer = fs.readFileSync(outFile);
      if (buffer.length <= o.maxBytes) return { buffer, width: W, height: H, duration, audio: withAudio, bitrate };
      bitrate = Math.floor(bitrate * (o.maxBytes / buffer.length) * 0.8);
      if (bitrate < 100000) break;
    }
    throw new FetchError('Hasil video terlalu besar untuk batas respons server. Coba trim=true, res=480, atau audio=false.', 413);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { renderVideo, probe };

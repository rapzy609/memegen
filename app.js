// Bikin Meme — semua proses (foto & video) berjalan di browser.
// Foto: canvas -> PNG. Video: canvas + MediaRecorder (+ audio via WebAudio).

const FONT = '"MemeImpact", Impact, "Arial Black", sans-serif';
const MAX_IMAGE_SIDE = 2048;

const $ = (id) => document.getElementById(id);
const el = {
  file: $('file'), drop: $('drop'), stageBox: $('stageBox'), stage: $('stage'),
  meta: $('meta'), metaText: $('metaText'),
  top: $('topText'), bottom: $('bottomText'),
  size: $('size'), sizeOut: $('sizeOut'), outline: $('outline'), outlineOut: $('outlineOut'),
  fill: $('fill'), stroke: $('stroke'), upper: $('upper'),
  videoOpts: $('videoOpts'), res: $('res'), audio: $('audio'),
  exportBtn: $('exportBtn'), status: $('status'),
  recBox: $('recBox'), recBar: $('recBar'), recText: $('recText'), cancelBtn: $('cancelBtn'),
  result: $('result'), resultVideo: $('resultVideo'), resultLink: $('resultLink'),
};
const ctx = el.stage.getContext('2d');

const state = {
  kind: null,        // 'image' | 'video'
  source: null,      // HTMLImageElement | HTMLVideoElement
  srcW: 0, srcH: 0,
  url: null,
  audio: null,       // { ctx, node } untuk video aktif
  recording: false,
  finish: null,
  cancelled: false,
  raf: 0,
};

/* ------------------------------------------------------------------ */
/* Status helper                                                       */
/* ------------------------------------------------------------------ */
function say(msg, isError = false) {
  el.status.textContent = msg || '';
  el.status.classList.toggle('error', !!isError);
}

/* ------------------------------------------------------------------ */
/* Teks meme                                                           */
/* ------------------------------------------------------------------ */
function wrapLines(text, maxW) {
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
  // buang baris kosong di ujung
  while (out.length && out[out.length - 1] === '') out.pop();
  while (out.length && out[0] === '') out.shift();
  return out;
}

function layoutText(raw, W) {
  let text = raw.trim();
  if (!text) return null;
  if (el.upper.checked) text = text.toUpperCase();

  const maxW = W * 0.94;
  const minFs = W * 0.03;
  const base = W * (parseFloat(el.size.value) / 100);
  let fs = base;
  let lines;
  // Tahap 1: usahakan muat satu baris (kecilkan sampai 70% ukuran pilihan).
  // Tahap 2: kalau tetap tidak muat, boleh membungkus sampai 3 baris.
  for (;;) {
    ctx.font = `${fs}px ${FONT}`;
    lines = wrapLines(text, maxW);
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    const oneLine = lines.length === 1 && widest <= maxW;
    if (oneLine || fs <= minFs) break;
    if (fs <= base * 0.7 && lines.length <= 3 && widest <= maxW) break;
    fs *= 0.95;
  }
  return { lines, fs, lh: fs * 1.12 };
}

function drawBlock(block, W, H, atTop) {
  if (!block) return;
  const pad = W * 0.025;
  const total = block.lines.length * block.lh;
  let y = atTop ? pad : H - pad - total;

  ctx.font = `${block.fs}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.lineWidth = block.fs * (parseFloat(el.outline.value) / 100);
  ctx.strokeStyle = el.stroke.value;
  ctx.fillStyle = el.fill.value;

  for (const line of block.lines) {
    if (ctx.lineWidth > 0) ctx.strokeText(line, W / 2, y);
    ctx.fillText(line, W / 2, y);
    y += block.lh;
  }
}

function render() {
  if (!state.source) return;
  const W = el.stage.width, H = el.stage.height;
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(state.source, 0, 0, W, H);

  // ukur dulu keduanya (measureText bergantung pada font aktif), lalu gambar
  const top = layoutText(el.top.value, W);
  const bottom = layoutText(el.bottom.value, W);
  drawBlock(top, W, H, true);
  drawBlock(bottom, W, H, false);
}

function loop() {
  render();
  state.raf = requestAnimationFrame(loop);
}

/* ------------------------------------------------------------------ */
/* Ukuran output                                                       */
/* ------------------------------------------------------------------ */
const even = (n) => Math.max(2, Math.round(n / 2) * 2);

function applySize() {
  if (!state.source) return;
  const maxSide = state.kind === 'video' ? parseInt(el.res.value, 10) : MAX_IMAGE_SIDE;
  const scale = Math.min(1, maxSide / Math.max(state.srcW, state.srcH));
  el.stage.width = even(state.srcW * scale);
  el.stage.height = even(state.srcH * scale);
  updateMeta();
  render();
}

function updateMeta() {
  const dim = `${el.stage.width}×${el.stage.height}`;
  if (state.kind === 'video') {
    const d = state.source.duration;
    el.metaText.textContent = `Video · ${isFinite(d) ? d.toFixed(1) + ' detik · ' : ''}${dim}`;
  } else {
    el.metaText.textContent = `Foto · ${dim}`;
  }
}

/* ------------------------------------------------------------------ */
/* Memuat file                                                         */
/* ------------------------------------------------------------------ */
function cleanup() {
  cancelAnimationFrame(state.raf);
  if (state.source && state.kind === 'video') {
    state.source.pause();
    state.source.remove();
  }
  if (state.audio) { try { state.audio.ctx.close(); } catch (_) {} state.audio = null; }
  if (state.url) URL.revokeObjectURL(state.url);
  state.source = null; state.url = null; state.kind = null;
  el.result.hidden = true;
  if (el.resultLink.href.startsWith('blob:')) URL.revokeObjectURL(el.resultLink.href);
}

function showLoaded(kind) {
  state.kind = kind;
  el.drop.hidden = true;
  el.stageBox.hidden = false;
  el.meta.hidden = false;
  el.videoOpts.hidden = kind !== 'video';
  el.exportBtn.disabled = false;
  el.exportBtn.textContent = kind === 'video' ? 'Buat & unduh video' : 'Unduh gambar (PNG)';
  say('');
}

async function loadFile(file) {
  if (!file) return;
  if (state.recording) { say('Tunggu rekaman selesai atau batalkan dulu.', true); return; }

  const isVideo = file.type.startsWith('video/');
  const isImage = file.type.startsWith('image/');
  if (!isVideo && !isImage) { say('File harus berupa foto atau video.', true); return; }
  if (isVideo && typeof MediaRecorder === 'undefined') {
    say('Browser ini tidak mendukung perekaman video. Coba Chrome, Edge, Firefox, atau Safari terbaru.', true);
    return;
  }

  cleanup();
  say('Memuat file…');
  const url = URL.createObjectURL(file);
  state.url = url;

  try {
    await document.fonts.load(`50px ${FONT}`);
  } catch (_) { /* pakai font cadangan */ }

  try {
    if (isImage) {
      const img = new Image();
      img.src = url;
      await img.decode();
      state.source = img;
      state.srcW = img.naturalWidth; state.srcH = img.naturalHeight;
      showLoaded('image');
      applySize();
    } else {
      const v = document.createElement('video');
      v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'auto';
      v.setAttribute('playsinline', '');
      v.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
      v.src = url;
      document.body.appendChild(v);
      await new Promise((res, rej) => {
        v.onloadeddata = res;
        v.onerror = () => rej(new Error('video'));
      });
      state.source = v;
      state.srcW = v.videoWidth; state.srcH = v.videoHeight;
      showLoaded('video');
      applySize();
      try { await v.play(); } catch (_) { /* preview tetap menampilkan frame pertama */ }
      loop();
    }
  } catch (_) {
    cleanup();
    el.drop.hidden = false; el.stageBox.hidden = true; el.meta.hidden = true;
    el.videoOpts.hidden = true; el.exportBtn.disabled = true; el.exportBtn.textContent = 'Pilih file dulu';
    say(isVideo
      ? 'Video tidak bisa dibuka di browser ini (format/codec tidak didukung).'
      : 'Foto tidak bisa dibuka (format tidak didukung atau file rusak).', true);
    return;
  }
  if (isImage) render();
}

/* ------------------------------------------------------------------ */
/* Ekspor foto                                                         */
/* ------------------------------------------------------------------ */
function download(blob, name) {
  const a = document.createElement('a');
  const u = URL.createObjectURL(blob);
  a.href = u; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 10000);
}

function exportImage() {
  render();
  el.stage.toBlob((blob) => {
    if (!blob) { say('Gagal membuat gambar.', true); return; }
    download(blob, `meme-${Date.now()}.png`);
    say('Gambar diunduh.');
  }, 'image/png');
}

/* ------------------------------------------------------------------ */
/* Ekspor video                                                        */
/* ------------------------------------------------------------------ */
function pickMime(withAudio) {
  const a = withAudio ? ',mp4a.40.2' : '';
  const o = withAudio ? ',opus' : '';
  const list = [
    `video/mp4;codecs=avc1.42E01E${a}`,
    `video/webm;codecs=vp9${o}`,
    `video/webm;codecs=vp8${o}`,
    'video/webm',
  ];
  return list.find((m) => MediaRecorder.isTypeSupported(m)) || '';
}

function setupAudio(video) {
  // createMediaElementSource hanya boleh sekali per elemen -> simpan & pakai ulang
  if (!state.audio) {
    const actx = new (window.AudioContext || window.webkitAudioContext)();
    state.audio = { ctx: actx, node: actx.createMediaElementSource(video) };
  }
  const dest = state.audio.ctx.createMediaStreamDestination();
  state.audio.node.connect(dest); // tidak disambung ke speaker -> rekaman senyap di perangkat
  return dest;
}

async function exportVideo() {
  const video = state.source;
  const withAudio = el.audio.checked;
  const mime = pickMime(withAudio);
  if (!mime) { say('Browser tidak mendukung format rekaman video.', true); return; }

  state.recording = true; state.cancelled = false;
  el.exportBtn.disabled = true; el.file.disabled = true;
  el.res.disabled = true; el.audio.disabled = true;
  el.result.hidden = true;
  el.recBox.hidden = false; el.recBar.style.width = '0%';
  el.recText.textContent = 'Menyiapkan…';
  say('');

  let dest = null, recorder = null;
  const restore = () => {
    if (dest) { try { state.audio.node.disconnect(dest); } catch (_) {} }
    video.muted = true; video.loop = true;
    video.play().catch(() => {});
    state.recording = false;
    el.exportBtn.disabled = false; el.file.disabled = false;
    el.res.disabled = false; el.audio.disabled = false;
    el.recBox.hidden = true;
  };

  try {
    const stream = el.stage.captureStream(30);
    if (withAudio) {
      try {
        dest = setupAudio(video);
        await state.audio.ctx.resume();
        dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
      } catch (_) { dest = null; }
    }

    const bits = Math.min(12e6, Math.max(1.5e6, el.stage.width * el.stage.height * 3));
    recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bits });
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise((res) => { recorder.onstop = res; });

    // mulai dari awal, tanpa loop
    video.loop = false;
    video.pause();
    await new Promise((res) => {
      if (video.currentTime === 0) return res();
      video.onseeked = () => { video.onseeked = null; res(); };
      video.currentTime = 0;
    });
    video.muted = !withAudio || !dest ? true : false;

    const duration = video.duration;
    const ended = new Promise((res) => { state.finish = res; video.onended = () => { video.onended = null; res(); }; });

    recorder.start(250);
    await video.play();
    el.recText.textContent = 'Merekam…';

    const tick = () => {
      if (!state.recording) return;
      const p = isFinite(duration) && duration > 0 ? Math.min(1, video.currentTime / duration) : 0;
      el.recBar.style.width = `${(p * 100).toFixed(1)}%`;
      el.recText.textContent = `Merekam… ${Math.round(p * 100)}%`;
      requestAnimationFrame(tick);
    };
    tick();

    await ended;
    await new Promise((r) => setTimeout(r, 150)); // beri waktu frame terakhir tertangkap
    if (recorder.state !== 'inactive') recorder.stop();
    await stopped;

    if (state.cancelled) { say('Perekaman dibatalkan.'); return; }

    const type = (recorder.mimeType || mime).split(';')[0];
    const ext = type.includes('mp4') ? 'mp4' : 'webm';
    const blob = new Blob(chunks, { type });
    if (!blob.size) throw new Error('kosong');

    if (el.resultLink.href.startsWith('blob:')) URL.revokeObjectURL(el.resultLink.href);
    const out = URL.createObjectURL(blob);
    el.resultVideo.src = out;
    el.resultLink.href = out;
    el.resultLink.download = `meme-${Date.now()}.${ext}`;
    el.resultLink.textContent = `Unduh video (${ext.toUpperCase()}, ${(blob.size / 1048576).toFixed(1)} MB)`;
    el.result.hidden = false;
    el.result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    say(ext === 'webm'
      ? 'Selesai. Hasil berformat WebM (browser ini belum bisa MP4); sebagian aplikasi chat/iPhone mungkin tidak memutarnya.'
      : 'Selesai! Video siap diunduh.');
  } catch (err) {
    say('Gagal merekam video: ' + (err && err.message ? err.message : 'kesalahan tak dikenal'), true);
  } finally {
    if (recorder && recorder.state !== 'inactive') { try { recorder.stop(); } catch (_) {} }
    restore();
  }
}

function cancelRecording() {
  if (!state.recording) return;
  state.cancelled = true;
  state.source.pause();
  if (state.finish) state.finish();
}

/* ------------------------------------------------------------------ */
/* Event                                                               */
/* ------------------------------------------------------------------ */
function syncOutputs() {
  el.sizeOut.textContent = `${el.size.value}%`;
  el.outlineOut.textContent = `${el.outline.value}%`;
}

['input', 'change'].forEach((ev) => {
  [el.top, el.bottom, el.size, el.outline, el.fill, el.stroke, el.upper].forEach((n) =>
    n.addEventListener(ev, () => { syncOutputs(); if (state.kind === 'image') render(); }));
});
el.res.addEventListener('change', applySize);

el.file.addEventListener('change', () => {
  loadFile(el.file.files[0]);
  el.file.value = ''; // boleh pilih file yang sama lagi
});

el.exportBtn.addEventListener('click', () => {
  if (!state.source || state.recording) return;
  state.kind === 'video' ? exportVideo() : exportImage();
});
el.cancelBtn.addEventListener('click', cancelRecording);

// drag & drop (seluruh halaman)
['dragenter', 'dragover'].forEach((ev) =>
  document.addEventListener(ev, (e) => { e.preventDefault(); el.drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) =>
  document.addEventListener(ev, (e) => { e.preventDefault(); el.drop.classList.remove('over'); }));
document.addEventListener('drop', (e) => loadFile(e.dataTransfer.files[0]));

// tempel gambar dari clipboard
document.addEventListener('paste', (e) => {
  const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/') || x.type.startsWith('video/'));
  if (f) loadFile(f);
});

// dropzone bisa dibuka dengan keyboard
el.drop.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.file.click(); }
});

// jika font baru selesai dimuat, gambar ulang
document.fonts?.addEventListener?.('loadingdone', () => { if (state.kind === 'image') render(); });

syncOutputs();

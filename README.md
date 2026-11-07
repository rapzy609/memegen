# Bikin Meme

Website generator meme (foto & video) siap deploy ke Vercel.
Generator di halaman utama berjalan di browser pengguna (canvas + MediaRecorder).
Selain itu ada **API** (`/api/meme`, hanya foto) untuk project/bot WhatsApp — dokumentasi di `/docs`.

## Deploy ke Vercel
1. Push folder ini ke GitHub, lalu *Import Project* di Vercel.
2. Framework Preset: **Other**. Build Command & Output Directory: kosongkan.
3. Deploy. (Vercel otomatis menjalankan `npm install` untuk API.) (Atau: `npx vercel --prod` dari folder ini.)

## Jalankan lokal
`npx serve .` lalu buka alamat yang tampil.

## Catatan
- Opsi 1:1 memotong dari tengah (foto & video). Opsi 10 detik hanya memakai 10 detik pertama video.
- Video direkam real-time, jadi durasi proses = durasi video. Biarkan tab tetap terbuka.
- Hasil video: MP4 (H.264) di Chrome/Edge/Safari terbaru, WebM di browser lain.
- Font `impact.ttf` adalah font komersial (Monotype); pastikan lisensinya sesuai untuk situs publik.

## API
`GET /api/meme?url=<link foto/video>&top=...&bottom=...` → mengembalikan PNG (foto) atau MP4 (video).
Hasilnya sama dengan generator di halaman utama (Impact, outline, emoji, 1:1, `res`, `audio`, `trim`).
Sumber file **hanya lewat URL** (tidak ada upload, jadi tidak kena batas body Vercel). Parameter lengkap dan contoh Baileys / whatsapp-web.js / Python ada di `/docs`.

- Kode: `api/meme.js` (endpoint), `api/_lib/render.js` (tata letak teks), `api/_lib/video.js` (ffmpeg), `api/_lib/fetch-media.js` (unduh URL aman: blok IP privat/SSRF, timeout).
- Video: teks digambar sebagai PNG transparan lalu ditempel ffmpeg (`ffmpeg-static`) → MP4 H.264/AAC. Maks 30 dtk (ubah lewat env `MAX_VIDEO_SECONDS`), `trim=true` = 10 dtk.
- Emoji: font `fonts/NotoColorEmoji.ttf` (Noto Color Emoji, lisensi OFL) ikut ter-deploy bersama fungsi.
- Batas respons Vercel ±4,5 MB: hasil dijaga ≤ ±4,3 MB (bitrate video diturunkan otomatis; PNG besar otomatis jadi JPEG).
- `maxDuration` fungsi 60 detik (batas plan Hobby). Video panjang / 1080p bisa kena timeout → pakai `trim=true` atau `res=480`.
- Opsional: env `API_KEY` di Vercel → request wajib menyertakan header `X-API-Key` (atau `?key=`).
- Video memakan CPU; pasang Vercel Firewall / rate limit atau `API_KEY` bila API ramai.
- Lokal: `npm i` lalu `npx vercel dev`.

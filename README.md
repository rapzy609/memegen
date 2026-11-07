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
`GET/POST /api/meme?url=<gambar>&top=...&bottom=...` → mengembalikan PNG.
Parameter lengkap, contoh Baileys/whatsapp-web.js/Python ada di halaman `/docs`.

- Kode: `api/meme.js` (endpoint), `api/_lib/render.js` (gambar teks), `api/_lib/fetch-image.js` (unduh URL aman: blok IP privat/SSRF, maks 8 MB, timeout 8 dtk).
- Opsional: set environment variable `API_KEY` di Vercel agar request wajib menyertakan header `X-API-Key` (atau `?key=`).
- Jalankan lokal dengan API: `npm i` lalu `npx vercel dev`.
- Batas bawaan Vercel: body request maks ~4,5 MB (untuk upload), jadi gambar besar sebaiknya dikirim lewat `url`.
- Pertimbangkan Vercel Firewall / rate limit bila API ramai dipakai.

# Bikin Meme

Website generator meme (foto & video) — statis, tanpa backend, siap deploy ke Vercel.
Semua proses jalan di browser pengguna (canvas + MediaRecorder), jadi tidak kena
batas ukuran body / timeout Vercel.

## Deploy ke Vercel
1. Push folder ini ke GitHub, lalu *Import Project* di Vercel.
2. Framework Preset: **Other**. Build Command & Output Directory: kosongkan.
3. Deploy. (Atau: `npx vercel --prod` dari folder ini.)

## Jalankan lokal
`npx serve .` lalu buka alamat yang tampil.

## Catatan
- Video direkam real-time, jadi durasi proses = durasi video. Biarkan tab tetap terbuka.
- Hasil video: MP4 (H.264) di Chrome/Edge/Safari terbaru, WebM di browser lain.
- Font `impact.ttf` adalah font komersial (Monotype); pastikan lisensinya sesuai untuk situs publik.

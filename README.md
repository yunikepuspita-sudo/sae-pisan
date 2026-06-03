# 🟦 SAE PISAN — Smart Attendance Event

**Presensi Integratif, Sistematis, Akuntabel, Nirkertas.**
_"Kehadiran terdata, integritas terjaga — sae pisan."_

PWA presensi acara berbasis **QR Code** yang berjalan sepenuhnya dari **HP**, tanpa
kertas dan tanpa biaya lisensi. Alur: undangan (PDF) → QR RSVP → konfirmasi kehadiran
→ QR peserta → scan check-in/out panitia → rekap kehadiran → laporan & dokumen
pertanggungjawaban (LPJ).

## Halaman
- `admin.html` — Dashboard panitia (statistik, grafik kehadiran, status, event terbaru,
  aktivitas), kelola Event (unggah PDF undangan → field terisi otomatis), Peserta,
  Laporan & Dokumentasi, Pengaturan.
- `index.html` — Peserta: konfirmasi kehadiran (RSVP), tiket QR, materi & notulensi.
- `checkin.html` — Scanner kamera: check-in/check-out + validasi GPS.

## Fitur
- Dashboard visual (Chart.js): grafik kehadiran 7 hari, donat status, kartu statistik.
- Auto-isi data event dari **PDF undangan** (pdf.js).
- QR RSVP & QR peserta, kirim via WhatsApp/Email.
- Check-in/out dengan validasi radius GPS (anti titip absen).
- Multi-event, rekap **CSV / Excel / PDF**.
- Dokumentasi foto, Laporan Singkat, bagikan **materi & notulensi** ke peserta.
- Unduh **Dokumen Pertanggungjawaban (LPJ)** format Word otomatis.
- Installable PWA + offline app-shell. Auto-reload saat ada versi baru.

## Dua mode data
- **Demo** (default): data di perangkat ini (localStorage + IndexedDB).
- **Online**: hubungkan ke **Google Sheets via Apps Script** (lihat `apps-script/`),
  lalu tempel URL Web App di **Admin → Pengaturan**.

## Menjalankan lokal
```bash
npx serve .        # atau: python3 -m http.server 8080
```
Buka `admin.html`. Kamera & PWA aktif di HTTPS atau localhost.

## Deploy
Di-host di **GitHub Pages** (workflow `.github/workflows/deploy.yml`) → otomatis tayang
di `https://<user>.github.io/sae-pisan/` setiap push ke `main`.

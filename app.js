/* ============================================================================
 * Smart Attendance Event — core module (app.js)
 * Shared by index.html (peserta/RSVP), admin.html (panitia), checkin.html (scan)
 *
 * Dua mode:
 *   1. ONLINE  — terhubung ke Google Apps Script Web App (Google Sheets database).
 *                Konfigurasi URL di Admin → Pengaturan (disimpan di localStorage).
 *   2. DEMO    — bila URL backend kosong, seluruh data disimpan di localStorage
 *                perangkat ini. Cocok untuk uji coba tanpa setup backend.
 *
 * Semua fungsi data bersifat async sehingga UI yang sama bekerja di dua mode.
 * ==========================================================================*/
window.SAE = (function () {
  'use strict';

  // Opsi: isi langsung URL Apps Script di sini agar tidak perlu setting manual.
  const DEFAULT_API_URL = (window.SAE_CONFIG && window.SAE_CONFIG.API_URL) || '';

  const LS = {
    API: 'sae:apiUrl',
    EVENTS: 'sae:events',
    PARTS: 'sae:participants',
    ACTIVE: 'sae:activeEvent',
    PANITIA: 'sae:panitiaName'
  };

  /* ----------------------------- konfigurasi ----------------------------- */
  function getApiUrl() {
    return (localStorage.getItem(LS.API) || DEFAULT_API_URL || '').trim();
  }
  function setApiUrl(url) {
    localStorage.setItem(LS.API, (url || '').trim());
  }
  function isOnline() {
    return getApiUrl().length > 0;
  }
  function modeLabel() {
    return isOnline() ? 'Online (Google Sheets)' : 'Demo (perangkat ini)';
  }

  /* ------------------------------ utilitas ------------------------------- */
  function uid(prefix) {
    return (prefix || '') + Date.now().toString(36).toUpperCase() +
      Math.random().toString(36).slice(2, 5).toUpperCase();
  }
  function pad(n, w) { return String(n).padStart(w || 3, '0'); }

  function read(key) {
    try { return JSON.parse(localStorage.getItem(key) || '[]'); }
    catch (e) { return []; }
  }
  function write(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

  // Jarak dua koordinat (meter) — rumus haversine.
  function distanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function fmtTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  }
  function fmtDateTime(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleString('id-ID', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  }
  function durationStr(inTs, outTs) {
    if (!inTs || !outTs) return '';
    let ms = new Date(outTs) - new Date(inTs);
    if (ms < 0) return '';
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return (h ? h + 'j ' : '') + m + 'm';
  }

  /* --------------------------- panggilan backend ------------------------- */
  // Semua panggilan via POST text/plain (request "sederhana" — tanpa CORS
  // preflight). GET ke Apps Script dari browser kerap gagal ("Failed to
  // fetch") karena redirect ke googleusercontent; POST jauh lebih andal.
  // doPost meneruskan payload sebagai params, sehingga aksi baca tetap bekerja.
  async function apiGet(action, params) {
    return apiPost(action, params);
  }
  async function apiPost(action, payload) {
    const res = await fetch(getApiUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, payload: payload || {} })
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Gagal menyimpan data');
    return json.data;
  }

  /* =============================== EVENTS ================================ */
  async function listEvents() {
    if (isOnline()) return await apiGet('listEvents');
    return read(LS.EVENTS).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  async function getEvent(id) {
    if (!id) return null;
    if (isOnline()) return await apiGet('getEvent', { id });
    return read(LS.EVENTS).find((e) => e.id === id) || null;
  }

  async function createEvent(data) {
    const event = {
      id: data.id || uid('EVT'),
      nomorSurat: data.nomorSurat || '',
      nama: data.nama || 'Kegiatan',
      jenis: data.jenis || 'Rapat',
      tanggal: data.tanggal || '',
      waktu: data.waktu || '',
      lokasi: data.lokasi || '',
      lat: data.lat === '' || data.lat == null ? null : Number(data.lat),
      lng: data.lng === '' || data.lng == null ? null : Number(data.lng),
      radius: Number(data.radius) || 100,
      gpsRequired: !!data.gpsRequired,
      pdfUrl: data.pdfUrl || '',
      pdfName: data.pdfName || '',
      laporan: data.laporan || '',
      materiUrl: data.materiUrl || '',
      notulensiUrl: data.notulensiUrl || '',
      createdAt: Date.now()
    };
    if (isOnline()) return await apiPost('createEvent', event);
    const all = read(LS.EVENTS);
    all.push(event);
    write(LS.EVENTS, all);
    return event;
  }

  async function updateEvent(id, patch) {
    if (isOnline()) return await apiPost('updateEvent', { id, patch });
    const all = read(LS.EVENTS);
    const i = all.findIndex((e) => e.id === id);
    if (i < 0) throw new Error('Event tidak ditemukan');
    all[i] = Object.assign({}, all[i], patch);
    write(LS.EVENTS, all);
    return all[i];
  }

  async function deleteEvent(id) {
    if (isOnline()) return await apiPost('deleteEvent', { id });
    write(LS.EVENTS, read(LS.EVENTS).filter((e) => e.id !== id));
    write(LS.PARTS, read(LS.PARTS).filter((p) => p.eventId !== id));
    return true;
  }

  /* ============================ PARTICIPANTS ============================= */
  async function listParticipants(eventId) {
    if (isOnline()) return await apiGet('listParticipants', { eventId });
    return read(LS.PARTS)
      .filter((p) => p.eventId === eventId)
      .sort((a, b) => (a.seq || 0) - (b.seq || 0));
  }

  async function getParticipant(id) {
    if (isOnline()) return await apiGet('getParticipant', { id });
    return read(LS.PARTS).find((p) => p.id === id) || null;
  }

  // RSVP / konfirmasi kehadiran (Modul 2 & 3).
  async function rsvp(eventId, data) {
    const payload = {
      eventId,
      nama: (data.nama || '').trim(),
      nipNik: (data.nipNik || '').trim(),
      instansi: (data.instansi || '').trim(),
      jabatan: (data.jabatan || '').trim(),
      wa: (data.wa || '').trim(),
      email: (data.email || '').trim(),
      bersedia: data.bersedia === 'Tidak' ? 'Tidak' : 'Ya'
    };
    if (isOnline()) return await apiPost('rsvp', payload);

    const all = read(LS.PARTS);
    const seq = all.filter((p) => p.eventId === eventId).length + 1;
    const part = Object.assign({
      id: eventId + '-' + pad(seq),
      seq,
      status: payload.bersedia === 'Ya' ? 'Konfirmasi Hadir' : 'Tidak Hadir',
      checkIn: null,
      checkOut: null,
      createdAt: Date.now()
    }, payload);
    all.push(part);
    write(LS.PARTS, all);
    return part;
  }

  // Check-in / check-out otomatis (Modul 4 & 5).
  // Mengembalikan { participant, action: 'checkin'|'checkout'|'done' }.
  async function scan(participantId, geo) {
    if (isOnline()) {
      return await apiPost('scan', {
        id: participantId,
        lat: geo && geo.lat, lng: geo && geo.lng
      });
    }
    const all = read(LS.PARTS);
    const i = all.findIndex((p) => p.id === participantId);
    if (i < 0) throw new Error('QR tidak dikenali / peserta tidak terdaftar');
    const p = all[i];
    let action;
    if (!p.checkIn) { p.checkIn = Date.now(); action = 'checkin'; }
    else if (!p.checkOut) { p.checkOut = Date.now(); action = 'checkout'; }
    else { action = 'done'; }
    if (p.status === 'Tidak Hadir' || p.status === 'Konfirmasi Hadir') p.status = 'Hadir';
    all[i] = p;
    write(LS.PARTS, all);
    return { participant: p, action };
  }

  /* ============================== STATISTIK ============================== */
  async function stats(eventId) {
    const parts = await listParticipants(eventId);
    const konfirmasi = parts.filter((p) => p.bersedia === 'Ya').length;
    const hadir = parts.filter((p) => p.checkIn).length;
    const selesai = parts.filter((p) => p.checkOut).length;
    const tidak = parts.filter((p) => p.bersedia === 'Tidak').length;
    return {
      total: parts.length,
      konfirmasi,
      hadir,
      selesai,
      tidakBersedia: tidak,
      belumHadir: konfirmasi - hadir
    };
  }

  /* =============================== GEOLOKASI ============================= */
  function getPosition(options) {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('Perangkat tidak mendukung GPS'));
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy }),
        (err) => reject(new Error(geoErr(err))),
        Object.assign({ enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }, options || {})
      );
    });
  }
  function geoErr(err) {
    switch (err && err.code) {
      case 1: return 'Izin lokasi ditolak. Aktifkan GPS untuk lokasi ini.';
      case 2: return 'Lokasi tidak tersedia. Coba lagi di area terbuka.';
      case 3: return 'Permintaan lokasi timeout. Coba lagi.';
      default: return 'Gagal membaca lokasi.';
    }
  }

  // Validasi radius lokasi acara. Mengembalikan { ok, distance, reason }.
  function validateGeo(event, geo) {
    if (!event || !event.gpsRequired) return { ok: true, distance: null };
    if (event.lat == null || event.lng == null) return { ok: true, distance: null };
    if (!geo) return { ok: false, reason: 'Lokasi tidak terbaca' };
    const d = distanceMeters(event.lat, event.lng, geo.lat, geo.lng);
    return { ok: d <= (event.radius || 100), distance: Math.round(d) };
  }

  /* ============================== QR PAYLOAD ============================= */
  // Isi QR peserta = JSON ringkas; scanner juga menerima id mentah.
  function qrPayload(part) {
    return JSON.stringify({ id: part.id, nama: part.nama, status: 'valid' });
  }
  function parseScan(raw) {
    if (!raw) return null;
    raw = raw.trim();
    // URL tiket → ambil parameter ticket
    try {
      if (/^https?:\/\//i.test(raw)) {
        const u = new URL(raw);
        const t = u.searchParams.get('ticket');
        if (t) return t;
      }
    } catch (e) { /* ignore */ }
    // JSON { id, ... }
    if (raw[0] === '{') {
      try { const o = JSON.parse(raw); if (o && o.id) return String(o.id); } catch (e) { /* ignore */ }
    }
    return raw; // anggap id mentah
  }

  /* ============================ BERBAGI (WA/Email) ====================== */
  function ticketUrl(part) {
    const base = location.origin + location.pathname.replace(/[^/]+$/, '');
    return base + 'index.html?ticket=' + encodeURIComponent(part.id);
  }
  function waLink(part, event) {
    const msg =
      `*Tiket Kehadiran — ${event ? event.nama : 'Acara'}*\n` +
      `Nama: ${part.nama}\nID: ${part.id}\n` +
      (event ? `Tanggal: ${event.tanggal || '-'}\nLokasi: ${event.lokasi || '-'}\n` : '') +
      `\nSimpan QR Anda di sini:\n${ticketUrl(part)}\n\nTunjukkan QR saat check-in. Terima kasih.`;
    const num = (part.wa || '').replace(/[^0-9]/g, '').replace(/^0/, '62');
    return 'https://wa.me/' + num + '?text=' + encodeURIComponent(msg);
  }
  function mailLink(part, event) {
    const subject = `Tiket Kehadiran — ${event ? event.nama : 'Acara'}`;
    const body =
      `Halo ${part.nama},\n\nBerikut tiket kehadiran Anda.\nID: ${part.id}\n` +
      `Simpan & tunjukkan QR saat check-in:\n${ticketUrl(part)}\n\nTerima kasih.`;
    return 'mailto:' + encodeURIComponent(part.email || '') +
      '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
  }

  /* =============================== EKSPOR =============================== */
  function rekapRows(event, parts) {
    return parts.map((p) => ({
      ID: p.id,
      Nama: p.nama,
      Instansi: p.instansi || '',
      Jabatan: p.jabatan || '',
      'NIP/NIK': p.nipNik || '',
      WA: p.wa || '',
      Email: p.email || '',
      RSVP: p.bersedia === 'Tidak' ? 'Tidak Hadir' : 'Bersedia',
      'Check In': fmtTime(p.checkIn),
      'Check Out': fmtTime(p.checkOut),
      Durasi: durationStr(p.checkIn, p.checkOut),
      Status: p.checkIn ? (p.checkOut ? 'Selesai' : 'Hadir') : (p.bersedia === 'Tidak' ? 'Tidak Hadir' : 'Belum Hadir')
    }));
  }

  function toCsv(rows) {
    if (!rows.length) return '';
    const head = Object.keys(rows[0]);
    const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    return [head.join(','), ...rows.map((r) => head.map((h) => esc(r[h])).join(','))].join('\r\n');
  }

  function download(filename, content, type) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: type || 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function exportCsv(event, parts) {
    download(slug(event) + '.csv', '﻿' + toCsv(rekapRows(event, parts)), 'text/csv;charset=utf-8');
  }

  async function exportXlsx(event, parts) {
    await ensureXlsx();
    const rows = rekapRows(event, parts);
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Rekap Kehadiran');
    XLSX.writeFile(wb, slug(event) + '.xlsx');
  }

  function slug(event) {
    const base = (event && event.nama ? event.nama : 'rekap-kehadiran')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return 'rekap-' + base;
  }

  function ensureXlsx() {
    if (window.XLSX) return Promise.resolve();
    return loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
  }
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = [...document.scripts].find((s) => s.src === src);
      if (existing) {
        if (existing.dataset.loaded) return resolve();
        existing.addEventListener('load', () => resolve());
        existing.addEventListener('error', () => reject(new Error('Gagal memuat ' + src)));
        return;
      }
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => { s.dataset.loaded = '1'; resolve(); };
      s.onerror = () => reject(new Error('Gagal memuat ' + src));
      document.head.appendChild(s);
    });
  }

  /* ============================ PDF UNDANGAN ============================= */
  // Ekstraksi teks PDF di sisi browser (pdf.js) lalu auto-isi field kegiatan.
  const PDFJS_VER = '3.11.174';
  async function ensurePdfJs() {
    if (window.pdfjsLib) return window.pdfjsLib;
    await loadScript('https://cdn.jsdelivr.net/npm/pdfjs-dist@' + PDFJS_VER + '/build/pdf.min.js');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdn.jsdelivr.net/npm/pdfjs-dist@' + PDFJS_VER + '/build/pdf.worker.min.js';
    return window.pdfjsLib;
  }

  // Baca seluruh teks PDF, dengan rekonstruksi baris berdasarkan posisi Y.
  async function extractPdfText(file) {
    const pdfjs = await ensurePdfJs();
    const buf = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: buf }).promise;
    let out = '';
    const maxPages = Math.min(pdf.numPages, 5); // cukup beberapa halaman pertama
    for (let p = 1; p <= maxPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      let lastY = null, line = '', lines = [];
      content.items.forEach((it) => {
        const y = it.transform[5];
        if (lastY !== null && Math.abs(y - lastY) > 3) { lines.push(line.trim()); line = ''; }
        line += it.str + ' ';
        lastY = y;
      });
      lines.push(line.trim());
      out += lines.join('\n') + '\n';
    }
    return out;
  }

  const ID_MONTHS = {
    januari: 1, februari: 2, maret: 3, april: 4, mei: 5, juni: 6,
    juli: 7, agustus: 8, september: 9, oktober: 10, november: 11, desember: 12
  };

  function parseDateID(text) {
    if (!text) return '';
    const re = /(\d{1,2})\s+(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\s+(\d{4})/i;
    const m = text.match(re);
    if (m) {
      const d = +m[1], mo = ID_MONTHS[m[2].toLowerCase()], y = +m[3];
      return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    }
    const m2 = text.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})\b/);
    if (m2) return m2[3] + '-' + String(+m2[2]).padStart(2, '0') + '-' + String(+m2[1]).padStart(2, '0');
    return '';
  }

  // Ambil nilai setelah label (mis. "Nomor : 005/...") sampai akhir baris.
  function labelValue(text, labelRe) {
    // \b di depan agar "Tempat" tidak cocok dengan substring "berTEMPAT", dll.
    const re = new RegExp('\\b(?:' + labelRe + ')\\s*[:\\-]?\\s*([^\\n\\r]+)', 'i');
    const m = text.match(re);
    if (!m) return '';
    // potong bila bertemu label lain pada baris yang sama
    let v = m[1].split(/\s{2,}|(?:\s(?:Lampiran|Sifat|Perihal|Hal)\s*:)/i)[0];
    return v.trim();
  }

  // Heuristik surat dinas Indonesia → { nomorSurat, nama, tanggal, waktu, lokasi }.
  function parseLetterFields(text) {
    const out = { nomorSurat: '', nama: '', tanggal: '', waktu: '', lokasi: '' };
    if (!text) return out;

    // Nomor surat (mengandung "/")
    let nomor = labelValue(text, 'Nomor|No\\.?');
    if (nomor && nomor.indexOf('/') === -1) {
      const mm = text.match(/\b(\d+\s*\/\s*[A-Za-z0-9.\-\/]+\/[IVXLCDM]+\/\d{4})\b/);
      if (mm) nomor = mm[1].replace(/\s+/g, '');
    }
    out.nomorSurat = (nomor || '').slice(0, 80);

    // Nama kegiatan — utamakan Perihal/Hal, lalu kata kunci acara
    let nama = labelValue(text, 'Perihal|Hal');
    if (nama) nama = nama.replace(/^undangan\s*/i, '').trim();
    if (!nama) {
      const m = text.match(/(?:dalam rangka|acara|kegiatan)\s*[:\-]?\s*([A-Z][^\n.]{4,90})/i);
      if (m) nama = m[1].trim();
    }
    out.nama = (nama || '').replace(/[,;:]\s*$/, '').slice(0, 120);

    // Tanggal — cari di sekitar kata "tanggal/hari", fallback seluruh teks
    let dateCtx = '';
    const ctx = text.match(/(?:hari\s*\/?\s*tanggal|tanggal|pada hari)[^\n]*\n?[^\n]*/i);
    if (ctx) dateCtx = ctx[0];
    out.tanggal = parseDateID(dateCtx) || parseDateID(text);

    // Waktu / Pukul → HH:MM
    const w = text.match(/(?:Waktu|Pukul|Jam)\s*[:\-]?\s*(\d{1,2})[.:](\d{2})/i);
    if (w) out.waktu = String(+w[1]).padStart(2, '0') + ':' + w[2];

    // Lokasi / Tempat
    let lok = labelValue(text, 'Tempat|Lokasi');
    if (!lok) {
      const m = text.match(/bertempat di\s+([^\n.]{3,90})/i);
      if (m) lok = m[1].trim();
    }
    out.lokasi = (lok || '').replace(/[,;:]\s*$/, '').slice(0, 120);

    return out;
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('Gagal membaca berkas'));
      r.readAsDataURL(file);
    });
  }

  /* ---- penyimpanan berkas di perangkat (IndexedDB): PDF & foto ---- */
  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('sae-pdf', 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('pdf')) db.createObjectStore('pdf');
        if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  function idbPut(store, key, val) {
    return openDb().then((db) => new Promise((res, rej) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(val, key);
      tx.oncomplete = () => res(true); tx.onerror = () => rej(tx.error);
    }));
  }
  function idbGet(store, key) {
    return openDb().then((db) => new Promise((res, rej) => {
      const tx = db.transaction(store, 'readonly');
      const rq = tx.objectStore(store).get(key);
      rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
    }));
  }
  function idbDel(store, key) {
    return openDb().then((db) => new Promise((res) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => res(); tx.onerror = () => res();
    }));
  }

  async function savePdfBlob(eventId, blob) {
    try { await idbPut('pdf', eventId, blob); return true; } catch (e) { return false; }
  }
  async function getPdfBlob(eventId) {
    try { return (await idbGet('pdf', eventId)) || null; } catch (e) { return null; }
  }
  async function deletePdfBlob(eventId) {
    try { await idbDel('pdf', eventId); } catch (e) { /* ignore */ }
  }
  // Kembalikan URL siap-buka untuk surat: link eksternal bila ada, jika tidak blob lokal.
  async function pdfViewUrl(event) {
    if (!event) return '';
    if (event.pdfUrl) return event.pdfUrl;
    const blob = await getPdfBlob(event.id);
    return blob ? URL.createObjectURL(blob) : '';
  }

  /* ---- Dokumentasi foto (array blob per kegiatan, di IndexedDB) ---- */
  async function getPhotos(eventId) {
    try { return (await idbGet('photos', eventId)) || []; } catch (e) { return []; }
  }
  // Tambah foto (otomatis dikompres agar hemat ruang); kembalikan jumlah total.
  async function addPhotos(eventId, files) {
    const existing = await getPhotos(eventId);
    for (const f of files) {
      try { existing.push(await compressImage(f)); } catch (e) { /* lewati berkas gagal */ }
    }
    await idbPut('photos', eventId, existing);
    return existing.length;
  }
  async function removePhoto(eventId, index) {
    const arr = await getPhotos(eventId);
    arr.splice(index, 1);
    await idbPut('photos', eventId, arr);
    return arr.length;
  }
  async function deletePhotos(eventId) {
    try { await idbDel('photos', eventId); } catch (e) { /* ignore */ }
  }

  // Kompres/resize foto via canvas → { name, dataUrl } JPEG (maks sisi 1280px).
  function compressImage(file, maxSide, quality) {
    maxSide = maxSide || 1280; quality = quality || 0.72;
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        let { width: w, height: h } = img;
        if (w > h && w > maxSide) { h = Math.round(h * maxSide / w); w = maxSide; }
        else if (h >= w && h > maxSide) { w = Math.round(w * maxSide / h); h = maxSide; }
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        resolve({ name: file.name || 'foto.jpg', dataUrl: cv.toDataURL('image/jpeg', quality) });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Gambar tidak valid')); };
      img.src = url;
    });
  }

  /* ---- Bagikan ke peserta (materi & notulensi) ---- */
  function shareText(event) {
    const lines = [
      `*${event.nama || 'Kegiatan'}*`,
      event.tanggal ? `Tanggal: ${event.tanggal}${event.waktu ? ' ' + event.waktu : ''}` : '',
      event.lokasi ? `Lokasi: ${event.lokasi}` : '',
      '',
      event.materiUrl ? `📎 Materi: ${event.materiUrl}` : '',
      event.notulensiUrl ? `📝 Notulensi: ${event.notulensiUrl}` : '',
      event.laporan ? `\nRingkasan:\n${event.laporan}` : '',
      '',
      'Terima kasih atas partisipasinya.'
    ].filter((l) => l !== '');
    return lines.join('\n');
  }
  function shareWaLink(event) {
    return 'https://wa.me/?text=' + encodeURIComponent(shareText(event));
  }

  /* ---- Dokumen Pertanggungjawaban (LPJ) — format Word (.doc) / cetak ---- */
  async function lpjHtml(event, parts) {
    const photos = await getPhotos(event.id);
    const panitia = getPanitia() || 'Panitia Penyelenggara';
    const hadir = parts.filter((p) => p.checkIn);
    const konfirmasi = parts.filter((p) => p.bersedia === 'Ya').length;
    const tidak = parts.filter((p) => p.bersedia === 'Tidak').length;
    const esc2 = (s) => esc(s);
    const today = new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });

    const rowsHadir = hadir.length
      ? hadir.map((p, i) => `<tr>
          <td style="text-align:center">${i + 1}</td>
          <td>${esc2(p.nama)}</td>
          <td>${esc2(p.instansi || '-')}</td>
          <td>${esc2(p.jabatan || '-')}</td>
          <td style="text-align:center">${fmtTime(p.checkIn) || '-'}</td>
          <td style="text-align:center">${fmtTime(p.checkOut) || '-'}</td>
        </tr>`).join('')
      : '<tr><td colspan="6" style="text-align:center">Belum ada data kehadiran.</td></tr>';

    const fotoHtml = photos.length
      ? photos.map((ph, i) =>
          `<div style="display:inline-block;width:48%;margin:1% 0.5%;vertical-align:top;text-align:center">
             <img src="${ph.dataUrl}" style="width:100%;border:1px solid #999" />
             <div style="font-size:10pt">Gambar ${i + 1}</div>
           </div>`).join('')
      : '<p><i>Tidak ada dokumentasi foto yang diunggah.</i></p>';

    const html =
`<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head>
<meta charset="utf-8" />
<title>LPJ ${esc2(event.nama)}</title>
<style>
  body { font-family: "Times New Roman", serif; font-size: 12pt; color:#000; }
  h1 { font-size: 14pt; text-align:center; margin:0; }
  h2 { font-size: 12pt; margin: 16px 0 6px; border-bottom:1px solid #000; }
  table { width:100%; border-collapse: collapse; font-size: 11pt; }
  th, td { border: 1px solid #555; padding: 4px 6px; }
  th { background:#eee; }
  .kv td { border: none; padding: 2px 4px; }
  .ttd { margin-top: 36px; width:100%; }
  .ttd td { border:none; text-align:center; vertical-align:top; }
</style></head><body>
<h1>LAPORAN PERTANGGUNGJAWABAN (LPJ)</h1>
<h1>${esc2(event.nama)}</h1>
<p style="text-align:center;margin-top:2px">${esc2(panitia)}</p>

<h2>A. DATA KEGIATAN</h2>
<table class="kv">
  <tr><td style="width:170px">Nomor Surat</td><td>: ${esc2(event.nomorSurat || '-')}</td></tr>
  <tr><td>Nama Kegiatan</td><td>: ${esc2(event.nama || '-')}</td></tr>
  <tr><td>Jenis</td><td>: ${esc2(event.jenis || '-')}</td></tr>
  <tr><td>Hari/Tanggal</td><td>: ${esc2(event.tanggal || '-')} ${esc2(event.waktu || '')}</td></tr>
  <tr><td>Tempat</td><td>: ${esc2(event.lokasi || '-')}</td></tr>
</table>

<h2>B. LAPORAN SINGKAT PELAKSANAAN</h2>
<p style="text-align:justify">${event.laporan ? esc2(event.laporan).replace(/\n/g, '<br/>') : '<i>(Belum diisi)</i>'}</p>

<h2>C. REKAPITULASI KEHADIRAN</h2>
<table class="kv">
  <tr><td style="width:220px">Jumlah Diundang/Konfirmasi</td><td>: ${konfirmasi} orang</td></tr>
  <tr><td>Hadir (check-in)</td><td>: ${hadir.length} orang</td></tr>
  <tr><td>Menyatakan tidak hadir</td><td>: ${tidak} orang</td></tr>
</table>
<br/>
<table>
  <thead><tr><th style="width:30px">No</th><th>Nama</th><th>Instansi</th><th>Jabatan</th><th>Check In</th><th>Check Out</th></tr></thead>
  <tbody>${rowsHadir}</tbody>
</table>

<h2>D. MATERI &amp; NOTULENSI</h2>
<table class="kv">
  <tr><td style="width:170px">Tautan Materi</td><td>: ${event.materiUrl ? esc2(event.materiUrl) : '-'}</td></tr>
  <tr><td>Tautan Notulensi</td><td>: ${event.notulensiUrl ? esc2(event.notulensiUrl) : '-'}</td></tr>
</table>

<h2>E. DOKUMENTASI KEGIATAN</h2>
${fotoHtml}

<h2>F. PENUTUP</h2>
<p style="text-align:justify">Demikian laporan pertanggungjawaban kegiatan ini dibuat dengan sebenarnya untuk dapat dipergunakan sebagaimana mestinya.</p>

<table class="ttd">
  <tr><td>&nbsp;</td><td>${esc2(event.lokasi ? event.lokasi.split(',')[0] : '..................')}, ${today}<br/>Ketua Panitia,<br/><br/><br/><br/><b>(............................)</b></td></tr>
</table>
</body></html>`;

    return html;
  }

  async function downloadLpj(event, parts) {
    const html = await lpjHtml(event, parts);
    download('LPJ-' + slug(event).replace(/^rekap-/, '') + '.doc',
      '﻿' + html, 'application/msword;charset=utf-8');
  }

  async function printLpj(event, parts) {
    const html = await lpjHtml(event, parts);
    const w = window.open('', '_blank');
    if (!w) { toast('Popup diblokir. Izinkan popup untuk mencetak.', 'error'); return; }
    w.document.write(html); w.document.close();
    w.focus(); setTimeout(() => { try { w.print(); } catch (e) {} }, 500);
  }

  /* ---- e-Sertifikat peserta (format Word .doc, A4 landscape) ---- */
  const CERT_STYLE = `@page { size: A4 landscape; margin: 0; }
body { font-family: "Georgia","Times New Roman",serif; margin: 0; color: #0f172a; }
.frame { box-sizing: border-box; width: 1100px; max-width: 100%; margin: 0 auto; padding: 26px; }
.inner { border: 3px solid #2563eb; outline: 1px solid #22d3ee; outline-offset: 6px; border-radius: 8px; padding: 40px 60px; text-align: center; position: relative; }
.brand { color: #2563eb; font-weight: bold; letter-spacing: 3px; font-size: 16pt; }
.brandsub { color: #0ea5b7; font-size: 10pt; letter-spacing: 1px; margin-top: 2px; }
.title { font-size: 34pt; font-weight: bold; letter-spacing: 6px; margin: 14px 0 2px; color: #1f2d5a; }
.subtitle { font-size: 12pt; color: #475569; letter-spacing: 2px; }
.nomor { font-size: 10.5pt; color: #64748b; margin-top: 4px; }
.given { margin-top: 22px; font-size: 12pt; color: #475569; }
.name { font-size: 30pt; font-weight: bold; color: #2563eb; margin: 6px 0; border-bottom: 2px solid #cbd5e1; display: inline-block; padding: 0 30px 6px; }
.meta { font-size: 12pt; color: #334155; }
.cbody { margin: 18px auto 0; max-width: 760px; font-size: 12.5pt; line-height: 1.6; color: #1f2937; }
.event { font-weight: bold; color: #0f172a; }
.sign { margin-top: 30px; width: 100%; }
.sign td { width: 50%; font-size: 11pt; vertical-align: top; }
.verify { position: absolute; left: 24px; bottom: 14px; font-size: 8.5pt; color: #94a3b8; }
.seal { position: absolute; right: 30px; top: 30px; width: 80px; height: 80px; border: 2px dashed #22d3ee; border-radius: 50%; color: #0ea5b7; font-size: 8pt; display: table-cell; vertical-align: middle; text-align: center; }
.pb { page-break-before: always; }`;

  function certFrame(event, part) {
    const panitia = getPanitia() || 'Panitia Penyelenggara';
    const tgl = event.tanggal
      ? new Date(event.tanggal).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })
      : '-';
    const today = new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
    const kota = event.lokasi ? esc(event.lokasi.split(',')[0]) : '..................';
    const nomor = event.nomorSurat ? esc(event.nomorSurat) : esc(part.id);
    return `<div class="frame"><div class="inner">
  <div class="brand">SAE PISAN</div>
  <div class="brandsub">SMART ATTENDANCE EVENT &mdash; ${esc(panitia)}</div>
  <div class="title">SERTIFIKAT</div>
  <div class="subtitle">KEHADIRAN / PARTISIPASI</div>
  <div class="nomor">Nomor: ${nomor}</div>
  <div class="given">Diberikan kepada:</div>
  <div class="name">${esc(part.nama)}</div>
  <div class="meta">${esc(part.jabatan ? part.jabatan + ' — ' : '')}${esc(part.instansi || '')}</div>
  <div class="cbody">
    atas partisipasinya sebagai <b>peserta</b> dalam kegiatan<br/>
    <span class="event">${esc(event.nama)}</span><br/>
    yang diselenggarakan pada <b>${tgl}${event.waktu ? ' pukul ' + esc(event.waktu) : ''}</b>
    ${event.lokasi ? 'bertempat di <b>' + esc(event.lokasi) + '</b>' : ''}.
  </div>
  <table class="sign"><tr>
    <td>&nbsp;</td>
    <td>${kota}, ${today}<br/>${esc(panitia)}<br/><br/><br/><br/><b>(............................)</b><br/>Ketua Panitia</td>
  </tr></table>
  <div class="verify">Kode verifikasi: ${esc(part.id)}${part.checkIn ? ' · Check-in: ' + fmtDateTime(part.checkIn) : ''}</div>
  <div class="seal">e-Sertifikat<br/>SAE&nbsp;PISAN</div>
</div></div>`;
  }

  function certDoc(framesHtml, title) {
    return `<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"/>
<title>${esc(title)}</title><style>${CERT_STYLE}</style></head><body>${framesHtml}</body></html>`;
  }
  function certificateHtml(event, part) { return certDoc(certFrame(event, part), 'Sertifikat ' + part.nama); }

  function certName(event, part) {
    const nm = (part.nama || 'peserta').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return 'sertifikat-' + nm + '-' + part.id;
  }
  function downloadCertificate(event, part) {
    download(certName(event, part) + '.doc', '﻿' + certificateHtml(event, part), 'application/msword;charset=utf-8');
  }
  // Satu berkas .doc berisi sertifikat semua peserta yang hadir (per halaman).
  function downloadCertificatesBatch(event, parts) {
    const hadir = parts.filter((p) => p.checkIn);
    if (!hadir.length) { toast('Belum ada peserta yang check-in.', 'error'); return; }
    const frames = hadir.map((p, i) => (i ? '<div class="pb"></div>' : '') + certFrame(event, p)).join('');
    download('sertifikat-' + slug(event).replace(/^rekap-/, '') + '.doc',
      '﻿' + certDoc(frames, 'Sertifikat ' + event.nama), 'application/msword;charset=utf-8');
  }
  function printCertificate(event, part) {
    const w = window.open('', '_blank');
    if (!w) { toast('Popup diblokir. Izinkan popup untuk mencetak.', 'error'); return; }
    w.document.write(certificateHtml(event, part)); w.document.close();
    w.focus(); setTimeout(() => { try { w.print(); } catch (e) {} }, 500);
  }

  /* --------------------------- aktif & panitia --------------------------- */
  function getActiveEventId() { return localStorage.getItem(LS.ACTIVE) || ''; }
  function setActiveEventId(id) { localStorage.setItem(LS.ACTIVE, id || ''); }
  function getPanitia() { return localStorage.getItem(LS.PANITIA) || ''; }
  function setPanitia(n) { localStorage.setItem(LS.PANITIA, n || ''); }

  /* ------------------------------- UI helper ----------------------------- */
  function toast(msg, kind) {
    let host = document.getElementById('sae-toast');
    if (!host) {
      host = document.createElement('div');
      host.id = 'sae-toast';
      document.body.appendChild(host);
    }
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || 'info');
    el.textContent = msg;
    host.appendChild(el);
    setTimeout(() => { el.classList.add('show'); }, 10);
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3200);
  }

  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    // Saat service worker baru mengambil alih, muat ulang sekali agar konten
    // terbaru langsung tampil (menghindari "tampilan lama" karena cache SW).
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./service-worker.js').then((reg) => {
        reg.update();
        // periksa pembaruan tiap kali tab kembali fokus
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update();
        });
      }).catch(() => {});
    });
  }

  function param(name) {
    return new URLSearchParams(location.search).get(name);
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  return {
    // config
    getApiUrl, setApiUrl, isOnline, modeLabel,
    // events
    listEvents, getEvent, createEvent, updateEvent, deleteEvent,
    // participants
    listParticipants, getParticipant, rsvp, scan,
    // stats
    stats,
    // geo
    getPosition, validateGeo, distanceMeters,
    // qr
    qrPayload, parseScan, ticketUrl, waLink, mailLink,
    // export
    rekapRows, exportCsv, exportXlsx,
    // pdf undangan
    extractPdfText, parseLetterFields, fileToDataUrl,
    savePdfBlob, getPdfBlob, deletePdfBlob, pdfViewUrl,
    // dokumentasi, laporan, berbagi & LPJ
    getPhotos, addPhotos, removePhoto, deletePhotos,
    shareText, shareWaLink, downloadLpj, printLpj,
    downloadCertificate, printCertificate, downloadCertificatesBatch,
    // active / panitia
    getActiveEventId, setActiveEventId, getPanitia, setPanitia,
    // helpers
    fmtTime, fmtDateTime, durationStr, toast, registerSW, param, esc, uid
  };
})();

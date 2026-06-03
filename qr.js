/* ============================================================================
 * Smart Attendance Event — QR helpers (qr.js)
 * Membungkus QRCode.js (generate) dan html5-qrcode (scan kamera).
 * Library dimuat lazy dari CDN dan di-cache oleh service worker untuk offline.
 * ==========================================================================*/
window.SAEQR = (function () {
  'use strict';

  const CDN = {
    qrcode: 'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js',
    scanner: 'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js'
  };

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

  /* ------------------------------- GENERATE ------------------------------ */
  // Render QR ke dalam elemen kontainer. Membersihkan isi sebelumnya.
  async function render(el, text, size) {
    if (!window.QRCode) await loadScript(CDN.qrcode);
    el.innerHTML = '';
    return new QRCode(el, {
      text: String(text),
      width: size || 220,
      height: size || 220,
      colorDark: '#0f172a',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M
    });
  }

  // Ambil dataURL PNG dari QR yang sudah dirender (untuk download/unduh).
  function toDataUrl(el) {
    const canvas = el.querySelector('canvas');
    if (canvas) return canvas.toDataURL('image/png');
    const img = el.querySelector('img');
    return img ? img.src : '';
  }

  /* -------------------------------- SCAN --------------------------------- */
  let scanner = null;

  // Mulai pemindaian. onScan(text) dipanggil tiap QR terbaca.
  async function startScan(elementId, onScan, onError) {
    if (!window.Html5Qrcode) await loadScript(CDN.scanner);
    stopScan();
    scanner = new Html5Qrcode(elementId, { verbose: false });
    const config = {
      fps: 10,
      qrbox: (vw, vh) => {
        const min = Math.min(vw, vh);
        const box = Math.floor(min * 0.7);
        return { width: box, height: box };
      },
      aspectRatio: 1.0,
      rememberLastUsedCamera: true
    };
    try {
      await scanner.start({ facingMode: 'environment' }, config,
        (decodedText) => onScan(decodedText),
        () => { /* abaikan frame tanpa QR */ });
    } catch (err) {
      if (onError) onError(err);
      else throw err;
    }
  }

  async function stopScan() {
    if (scanner) {
      try { await scanner.stop(); } catch (e) { /* ignore */ }
      try { await scanner.clear(); } catch (e) { /* ignore */ }
      scanner = null;
    }
  }

  function isScanning() { return !!scanner; }

  return { render, toDataUrl, startScan, stopScan, isScanning };
})();

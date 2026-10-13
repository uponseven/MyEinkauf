// Barcode-Scanner über die Kamera.
// Nutzt den eingebauten BarcodeDetector (Chrome auf Android), sonst ZXing als Rückfall
// (z. B. Chrome/Edge auf Windows, Firefox). Kamera braucht HTTPS oder localhost.

import { isValidEan, normalizeEan } from './ean.js';

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];
const VIDEO_CONSTRAINTS = {
  video: {
    facingMode: { ideal: 'environment' },
    width: { ideal: 1280 },
    height: { ideal: 720 },
  },
  audio: false,
};

let zxingPromise;

function loadZxing() {
  if (!zxingPromise) {
    zxingPromise = new Promise((resolve, reject) => {
      if (window.ZXingBrowser) return resolve(window.ZXingBrowser);
      const script = document.createElement('script');
      script.src = new URL('../vendor/zxing/zxing-browser.min.js', import.meta.url).href;
      script.onload = () => resolve(window.ZXingBrowser);
      script.onerror = () => {
        zxingPromise = undefined;
        reject(new Error('Scanner-Bibliothek konnte nicht geladen werden'));
      };
      document.head.append(script);
    });
  }
  return zxingPromise;
}

async function nativeDetectorAvailable() {
  if (!('BarcodeDetector' in window)) return false;
  try {
    const supported = await window.BarcodeDetector.getSupportedFormats();
    return FORMATS.some((f) => supported.includes(f));
  } catch {
    return false;
  }
}

export function cameraSupported() {
  return !!navigator.mediaDevices?.getUserMedia && window.isSecureContext;
}

export function describeCameraError(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Kamerazugriff verweigert. Bitte in den Browser-Einstellungen erlauben.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'Keine Kamera gefunden.';
    case 'NotReadableError':
      return 'Kamera wird gerade von einer anderen App benutzt.';
    default:
      return err?.message || 'Kamera konnte nicht gestartet werden.';
  }
}

/**
 * Startet den Scanner im übergebenen <video>-Element.
 * onDetect(ean) wird einmal mit einem gültigen Barcode aufgerufen, danach stoppt der Scanner.
 * @returns {Promise<{stop: () => void}>}
 */
export async function startScanner(video, onDetect) {
  let stopped = false;
  let finish = () => {};

  const handle = (raw) => {
    const ean = normalizeEan(raw);
    if (stopped || !isValidEan(ean)) return;
    controls.stop();
    navigator.vibrate?.(80);
    onDetect(ean);
  };

  const controls = {
    stop() {
      if (stopped) return;
      stopped = true;
      finish();
    },
  };

  if (await nativeDetectorAvailable()) {
    const stream = await navigator.mediaDevices.getUserMedia(VIDEO_CONSTRAINTS);
    video.srcObject = stream;
    video.setAttribute('playsinline', '');
    video.muted = true;
    await video.play();
    const supported = await window.BarcodeDetector.getSupportedFormats();
    const detector = new window.BarcodeDetector({
      formats: FORMATS.filter((f) => supported.includes(f)),
    });
    let timer;
    const tick = async () => {
      if (stopped) return;
      try {
        if (video.readyState >= 2) {
          const codes = await detector.detect(video);
          if (codes.length) handle(codes[0].rawValue);
        }
      } catch {
        // Einzelne Fehlschläge ignorieren, nächster Versuch folgt.
      }
      if (!stopped) timer = setTimeout(tick, 150);
    };
    finish = () => {
      clearTimeout(timer);
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    };
    if (stopped) finish();
    else tick();
  } else {
    const ZXing = await loadZxing();
    const reader = new ZXing.BrowserMultiFormatReader();
    const zxControls = await reader.decodeFromConstraints(VIDEO_CONSTRAINTS, video, (result) => {
      if (result) handle(result.getText());
    });
    finish = () => zxControls.stop();
    // Falls stop() schon während des Kamerastarts aufgerufen wurde.
    if (stopped) finish();
  }

  return controls;
}

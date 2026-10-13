// Prüfung und Normalisierung von EAN/GTIN-Barcodes (EAN-8, UPC-A, EAN-13, GTIN-14).

export function normalizeEan(raw) {
  return String(raw ?? '').replace(/\D/g, '');
}

export function isValidEan(raw) {
  const code = normalizeEan(raw);
  if (![8, 12, 13, 14].includes(code.length)) return false;
  const digits = [...code].map(Number);
  const check = digits.pop();
  // Von rechts gewichtet: 3, 1, 3, 1, ...
  const sum = digits
    .reverse()
    .reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

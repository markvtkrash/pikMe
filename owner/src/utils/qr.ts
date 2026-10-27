import QRCode from 'qrcode';

// A QR code as rows of dark / light squares, so it can be drawn with plain SVG. Nothing is sent anywhere: the link is a secret and
// is drawn on the owner's own device.
export function qrMatrix(text: string): boolean[][] {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const size = modules.size;
  const rows: boolean[][] = [];
  for (let r = 0; r < size; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < size; c++) row.push(modules.get(r, c) === 1);
    rows.push(row);
  }
  return rows;
}

// One SVG path covering every dark square (a single element). Dark squares side by side in a row are drawn as one bar, which also
// avoids hairline gaps between them on some screens.
export function qrPath(matrix: boolean[][]): string {
  const parts: string[] = [];
  matrix.forEach((row, r) => {
    let c = 0;
    while (c < row.length) {
      if (!row[c]) {
        c++;
        continue;
      }
      const start = c;
      while (c < row.length && row[c]) c++;
      const len = c - start;
      parts.push(`M${start} ${r}h${len}v1h-${len}z`);
    }
  });
  return parts.join('');
}

import { qrMatrix, qrPath } from './qr';

describe('qrMatrix', () => {
  const url = 'https://owner.example.com/kiosk/k_' + 'a'.repeat(64);
  const matrix = qrMatrix(url);

  it('is a square grid big enough to hold the link', () => {
    expect(matrix.length).toBeGreaterThanOrEqual(21);
    for (const row of matrix) expect(row).toHaveLength(matrix.length);
  });

  it('has the finder square every QR code starts with in its three corners', () => {
    const n = matrix.length;
    // a 7-wide solid top edge, then a solid left edge, at the top-left, top-right and bottom-left
    for (let i = 0; i < 7; i++) {
      expect(matrix[0][i]).toBe(true);
      expect(matrix[i][0]).toBe(true);
      expect(matrix[0][n - 1 - i]).toBe(true);
      expect(matrix[n - 1 - i][0]).toBe(true);
    }
    // and an empty ring inside it
    expect(matrix[1][1]).toBe(false);
  });

  it('is the same every time for the same text, and differs for different text', () => {
    expect(qrMatrix(url)).toEqual(matrix);
    expect(qrMatrix(url + 'x')).not.toEqual(matrix);
  });
});

describe('qrPath', () => {
  it('draws one square per dark module', () => {
    const path = qrPath([[true, false], [false, true]]);
    expect(path).toBe('M0 0h1v1h-1zM1 1h1v1h-1z');
  });
  it('draws dark squares side by side in a row as one bar', () => {
    expect(qrPath([[true, true, true, false, true]])).toBe('M0 0h3v1h-3zM4 0h1v1h-1z');
  });
  it('covers exactly the dark squares of a real code', () => {
    const matrix = qrMatrix('https://example.com');
    const dark = matrix.flat().filter(Boolean).length;
    const covered = [...qrPath(matrix).matchAll(/M\d+ \d+h(\d+)v1/g)].reduce((sum, m) => sum + Number(m[1]), 0);
    expect(covered).toBe(dark);
  });
  it('is empty for an all-light grid', () => {
    expect(qrPath([[false, false]])).toBe('');
  });
});

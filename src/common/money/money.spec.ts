import {
  computePercentagePoisha,
  sumPoisha,
  toJsonPoisha,
  toPoisha,
} from './money.js';

describe('Money (integer poisha)', () => {
  it('converts and sums exact poisha without floating point drift', () => {
    const tk10000 = toPoisha(1000000);
    const tk40000 = toPoisha(4000000);
    const tk50000 = sumPoisha([tk10000, tk40000]);
    expect(toJsonPoisha(tk50000)).toBe(5000000);
    expect(toJsonPoisha(tk50000 - tk10000)).toBe(4000000);
  });

  it('computes percentage advance in poisha', () => {
    const total = toPoisha(5000000); // Tk 50,000
    const advance = computePercentagePoisha(total, 20n);
    expect(toJsonPoisha(advance)).toBe(1000000); // Tk 10,000
  });

  it('rejects non-integer numbers', () => {
    expect(() => toPoisha(100.5)).toThrow();
  });
});

export function toPoisha(value: number | bigint | string): bigint {
  if (typeof value === 'bigint') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || !Number.isSafeInteger(value)) {
      throw new Error(`Invalid integer poisha value: ${value}`);
    }
    return BigInt(value);
  }
  if (typeof value === 'string') {
    if (!/^-?\d+$/.test(value.trim())) {
      throw new Error(`Invalid poisha string: ${value}`);
    }
    return BigInt(value.trim());
  }
  throw new Error('Unsupported poisha value type');
}

export function toJsonPoisha(value: bigint): number {
  const num = Number(value);
  if (!Number.isSafeInteger(num)) {
    throw new Error(`Poisha value ${value.toString()} exceeds JS safe integer range`);
  }
  return num;
}

export function sumPoisha(values: readonly bigint[]): bigint {
  let total = 0n;
  for (const v of values) {
    total += v;
  }
  return total;
}

export function computePercentagePoisha(amountPoisha: bigint, percentage: bigint): bigint {
  if (percentage < 0n || percentage > 100n) {
    throw new Error(`Percentage must be between 0 and 100, got ${percentage}`);
  }
  // Round up to nearest poisha if fractional, or exact integer division
  return (amountPoisha * percentage + 99n) / 100n;
}

export function computeRequiredAdvancePoisha(
  agreedTotalPoisha: bigint,
  policyType: 'NONE' | 'PERCENTAGE' | 'FIXED',
  policyValue: bigint,
): bigint {
  if (policyType === 'NONE') {
    return 0n;
  }
  if (policyType === 'FIXED') {
    return policyValue > agreedTotalPoisha ? agreedTotalPoisha : policyValue;
  }
  return computePercentagePoisha(agreedTotalPoisha, policyValue);
}

/**
 * Formats integer poisha into a human-readable Taka (Tk) string, never exposing raw poisha in UI errors.
 * Example: 5000000n -> "Tk 50,000", 1000050n -> "Tk 10,000.50"
 */
export function formatTk(
  valuePoisha: bigint | number,
  currency = 'BDT',
): string {
  const poisha = typeof valuePoisha === 'bigint' ? valuePoisha : BigInt(Math.trunc(valuePoisha));
  const isNegative = poisha < 0n;
  const absPoisha = isNegative ? -poisha : poisha;
  const wholeTaka = absPoisha / 100n;
  const remainderPoisha = absPoisha % 100n;

  const formattedWhole = Number(wholeTaka).toLocaleString('en-IN');
  const fractionPart =
    remainderPoisha > 0n ? `.${remainderPoisha.toString().padStart(2, '0')}` : '';
  const prefix = currency === 'BDT' ? 'Tk' : currency;
  const sign = isNegative ? '-' : '';

  return `${sign}${prefix} ${formattedWhole}${fractionPart}`;
}


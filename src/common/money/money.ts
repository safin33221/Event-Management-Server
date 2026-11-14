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

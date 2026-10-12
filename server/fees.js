// TZS uses whole shillings. Round each order's fee once, without floating-point money.
export function platformFee(amount, basisPoints) {
  if (
    !Number.isSafeInteger(amount) ||
    amount < 0 ||
    !Number.isInteger(basisPoints) ||
    basisPoints < 0 ||
    basisPoints > 10000
  )
    throw new Error('Invalid fee calculation');
  return Number((BigInt(amount) * BigInt(basisPoints) + 5000n) / 10000n);
}

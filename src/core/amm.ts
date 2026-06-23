// Minimal AMM math to turn a position's liquidity + tick range into token amounts for display.

export const Q96 = BigInt('79228162514264337593543950336')

export const tickToPrice = (tick: number): number => Math.pow(1.0001, tick)
export const priceToSqrtPriceX96 = (price: number): bigint => BigInt(Math.floor(Math.sqrt(price) * Number(Q96)))

/** token0 amount held by `liquidity` between two sqrt prices. */
export function getAmount0(sqrtA: bigint, sqrtB: bigint, liquidity: bigint): bigint {
  const [lo, hi] = sqrtA < sqrtB ? [sqrtA, sqrtB] : [sqrtB, sqrtA]
  if (lo === 0n || hi === 0n) return 0n
  return liquidity * Q96 * (hi - lo) / hi / lo
}

/** token1 amount held by `liquidity` between two sqrt prices. */
export function getAmount1(sqrtA: bigint, sqrtB: bigint, liquidity: bigint): bigint {
  const [lo, hi] = sqrtA < sqrtB ? [sqrtA, sqrtB] : [sqrtB, sqrtA]
  return liquidity * (hi - lo) / Q96
}

/** Position token amounts from liquidity, current sqrt price, and tick range. */
export function positionAmounts(liquidity: bigint, sqrtPrice: bigint, tickLower: number, tickUpper: number): { amount0: bigint; amount1: bigint } {
  if (liquidity <= 0n) return { amount0: 0n, amount1: 0n }
  const sqrtL = priceToSqrtPriceX96(tickToPrice(tickLower))
  const sqrtU = priceToSqrtPriceX96(tickToPrice(tickUpper))
  const sqrtC = sqrtPrice < sqrtL ? sqrtL : sqrtPrice > sqrtU ? sqrtU : sqrtPrice
  return { amount0: getAmount0(sqrtC, sqrtU, liquidity), amount1: getAmount1(sqrtL, sqrtC, liquidity) }
}

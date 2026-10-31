export const CLEAR_BONUS = 0.2
export function potential(score: number | null, cc: number | null, cleared = false): number | null {
  if (score === null || cc === null) return null
  let base: number
  if (score >= 100_000_000) base = cc + 2
  else if (score >= 98_000_000) base = cc + 1 + (score - 98_000_000) / 2_000_000
  else if (score >= 0) base = Math.max(0, cc + (score - 95_000_000) / 3_000_000)
  else return null
  return base + (cleared ? CLEAR_BONUS : 0)
}
// 上位30件、上位10件は×2、合計/40
export function overall(pots: number[]): number {
  const top = [...pots].sort((a, b) => b - a).slice(0, 30)
  return top.reduce((s, p, i) => s + (i < 10 ? p * 2 : p), 0) / 40
}
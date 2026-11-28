export function countBy(values: Iterable<string>): Record<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Object.fromEntries([...counts].sort(([a], [b]) => a.localeCompare(b)));
}

export function distribution(values: readonly number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = sorted.reduce((sum, value) => sum + value, 0) / (sorted.length || 1);
  const percentile = (p: number): number | null => {
    if (!sorted.length) return null;
    const point = p * (sorted.length - 1);
    const lower = Math.floor(point);
    return sorted[lower]! + (sorted[Math.ceil(point)]! - sorted[lower]!) * (point - lower);
  };
  return {
    count: sorted.length, mean: sorted.length ? mean : null,
    min: percentile(0), p05: percentile(0.05), p25: percentile(0.25), median: percentile(0.5),
    p75: percentile(0.75), p95: percentile(0.95), max: percentile(1),
    populationSD: sorted.length ? Math.sqrt(sorted.reduce((sum, x) => sum + (x - mean) ** 2, 0) / sorted.length) : null,
    signs: countBy(sorted.map((value) => value > 1e-12 ? 'POSITIVE' : value < -1e-12 ? 'NEGATIVE' : 'ZERO')),
  };
}

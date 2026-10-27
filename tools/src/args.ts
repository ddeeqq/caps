/** --name value 형태의 간단한 인자 파서 */
export function arg(name: string): string | undefined;
export function arg(name: string, fallback: string): string;
export function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const value = process.argv[i + 1];
  return value && !value.startsWith('--') ? value : 'true';
}

export function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] as number;
}

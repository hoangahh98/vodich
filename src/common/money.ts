export function parseMoney(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const cleaned = String(value).replace(/[^\d.-]/g, '');
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatMoney(value: unknown): string {
  const number = typeof value === 'number' ? value : Number(value ?? 0);
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(Number.isFinite(number) ? number : 0);
}

export function roundUpToStep(value: number, step = 50000): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.ceil(value / step) * step;
}

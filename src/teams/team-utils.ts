export function monthDate(month?: string) {
  return new Date(`${month || new Date().toISOString().slice(0, 7)}-01T00:00:00Z`);
}

export function addMonths(date: Date, amount: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + amount, 1));
}

export function hasMoneyValue(value?: string) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

export function normalizeMemberType(value?: string) {
  return value === 'GUEST' ? 'GUEST' : 'FIXED';
}

export function cleanText(value?: string) {
  return value && value.trim() ? value.trim() : null;
}

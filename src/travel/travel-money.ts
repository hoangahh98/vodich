import { Decimal } from '@prisma/client/runtime/library';

export type MoneyInput = string | number | Decimal | null | undefined;

export function parseMoney(value: MoneyInput): number {
  if (value instanceof Decimal) return Number(value);
  const normalized = String(value ?? '0').replace(/[^\d.-]/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

export function splitEvenly(amount: number, memberIds: bigint[]) {
  if (!memberIds.length) return [];
  const total = Math.max(0, Math.round(amount));
  const base = Math.floor(total / memberIds.length);
  const remainder = total - base * memberIds.length;
  return memberIds.map((memberId, index) => ({
    memberId,
    amount: base + (index < remainder ? 1 : 0),
  }));
}

import { Decimal } from '@prisma/client/runtime/library';
import { parseMoney as parseMoneyBase } from '../common/money';

export type MoneyInput = string | number | Decimal | null | undefined;

/** Như common parseMoney nhưng clamp không âm — khoản thu/chi du lịch luôn >= 0. */
export function parseMoney(value: MoneyInput): number {
  if (value instanceof Decimal) return Math.max(0, Math.round(Number(value)));
  return Math.max(0, parseMoneyBase(value));
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

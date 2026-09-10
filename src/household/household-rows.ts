import { HouseholdPurpose, HouseholdRecurring, HouseholdSource, HouseholdTransaction } from '@prisma/client';
import { PurposeRow, RecurringRow, SourceRow, TransactionRow } from './household-month';

/** Đưa dòng Prisma (BigInt, Decimal) về mảng thuần cho phần toán ở household-month.ts. */

export const toSourceRow = (source: HouseholdSource): SourceRow => ({
  id: String(source.id),
  name: source.name,
  kind: source.kind,
  limitGroup: source.limitGroup,
  openingBalance: Number(source.openingBalance),
  creditLimit: Number(source.creditLimit),
  interestRate: Number(source.interestRate),
  statementDay: source.statementDay,
  dueDay: source.dueDay,
  active: source.active,
});

export const toPurposeRow = (purpose: HouseholdPurpose): PurposeRow => ({
  id: String(purpose.id),
  name: purpose.name,
  kind: purpose.kind,
  monthlyPlan: Number(purpose.monthlyPlan),
  active: purpose.active,
});

export const toTransactionRow = (tx: HouseholdTransaction): TransactionRow => ({
  id: String(tx.id),
  kind: tx.kind,
  sourceId: String(tx.sourceId),
  targetSourceId: tx.targetSourceId ? String(tx.targetSourceId) : null,
  purposeId: tx.purposeId ? String(tx.purposeId) : null,
  recurringId: tx.recurringId ? String(tx.recurringId) : null,
  amount: Number(tx.amount),
  interest: Number(tx.interest),
  month: tx.month,
  status: tx.status,
  occurredAt: tx.occurredAt,
  description: tx.description,
});

export const toRecurringRow = (recurring: HouseholdRecurring): RecurringRow => ({
  id: String(recurring.id),
  name: recurring.name,
  kind: recurring.kind,
  sourceId: recurring.sourceId ? String(recurring.sourceId) : null,
  targetSourceId: recurring.targetSourceId ? String(recurring.targetSourceId) : null,
  purposeId: recurring.purposeId ? String(recurring.purposeId) : null,
  amount: Number(recurring.amount),
  interestMode: recurring.interestMode,
  dayOfMonth: recurring.dayOfMonth,
  startMonth: recurring.startMonth,
  endMonth: recurring.endMonth,
  active: recurring.active,
});

/** Mô tả chuẩn hoá để so "lần trước nội dung này xếp vào mục nào": bỏ dấu, số, khoảng trắng thừa. */
export function normalizeDescription(text: string): string {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\d+/g, '')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

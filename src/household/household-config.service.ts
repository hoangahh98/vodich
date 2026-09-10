import { Injectable } from '@nestjs/common';
import { parseMoney } from '../common/money';
import { PrismaService } from '../prisma.service';
import { isDebtSource, normalizeBank, normalizeInterestMode, normalizeMonth, normalizePurposeKind, normalizeSourceKind, normalizeTxKind } from './household-enums';
import { sourceBalances } from './household-month';
import { toSourceRow, toTransactionRow } from './household-rows';

type Form = Record<string, string | undefined>;

const clampDay = (value: unknown) => Math.min(31, Math.max(0, Number.parseInt(String(value || '0'), 10) || 0));
const text = (value: unknown, max = 120) => String(value || '').trim().slice(0, max);

/**
 * Cấu hình của một hộ: nguồn tiền, mục đích, khoản định kỳ. Mọi hàm nhận `householdId` và lọc
 * theo nó ngay trong truy vấn (updateMany/deleteMany) — id gửi lên thuộc hộ khác thì không đụng
 * được, khỏi phải kiểm riêng.
 */
@Injectable()
export class HouseholdConfigService {
  constructor(private readonly prisma: PrismaService) {}

  // ───────────────────────────── Nguồn tiền ─────────────────────────────

  private sourceData(form: Form) {
    const kind = normalizeSourceKind(form.kind);
    // Chỉ tài khoản và thẻ mới nhận tin ngân hàng. Tiền mặt / khoản vay / cho vay mà mang bank = TIMO
    // (ô bị ẩn nhưng form vẫn gửi) thì hộ có hai "Timo" và bot không dám chọn — đã dính 10/9/2026.
    const receivesMail = kind === 'BANK' || kind === 'CARD';
    return {
      name: text(form.name) || 'Nguồn tiền',
      kind,
      bank: receivesMail ? normalizeBank(form.bank) : 'OTHER',
      matchKey: receivesMail ? text(form.matchKey, 40).replace(/\s+/g, '') : '',
      ownerName: text(form.ownerName),
      // Hạn mức thẻ KHÔNG còn khai tay (chủ app 10/9/2026: thẻ thông dùng chung hạn mức, khai kiểu gì cũng
      // sai) — thẻ chỉ hiện "hạn mức khả dụng" ngân hàng báo trong mail gần nhất, dư nợ cộng từ giao dịch.
      interestRate: Math.max(0, Number.parseFloat(String(form.interestRate || '0').replace(',', '.')) || 0),
      statementDay: clampDay(form.statementDay),
      dueDay: clampDay(form.dueDay),
    };
  }

  /**
   * Thẻ thông (hai thẻ dùng chung một hạn mức): chọn "dùng chung hạn mức với thẻ X" thì cả hai thẻ mang
   * CÙNG mã nhóm, để phần đối chiếu hạn mức khả dụng cộng tiền quẹt của cả nhóm — quẹt thẻ A thì mail của
   * thẻ B cũng báo hạn mức đã trừ khoản ấy (chủ app 10/9/2026). Hai thẻ khác hạn mức nhau vẫn dùng được:
   * chỉ so phần CHÊNH giữa hai lần ngân hàng báo. Chọn "thẻ riêng" thì bỏ mã của chính thẻ này.
   */
  private async limitGroupFor(householdId: bigint, form: Form, selfId: bigint | null): Promise<string> {
    const otherId = await this.ownSourceId(householdId, form.limitGroupWith);
    if (!otherId || (selfId && otherId === selfId)) return '';
    const other = await this.prisma.householdSource.findFirst({ where: { id: otherId, householdId, kind: 'CARD' } });
    if (!other) return '';
    const key = other.limitGroup || `g${other.id}`;
    if (!other.limitGroup) await this.prisma.householdSource.updateMany({ where: { id: otherId, householdId }, data: { limitGroup: key } });
    return key;
  }

  /** Nguồn mới chưa có giao dịch: số hiện tại nhập vào chính là số đầu kỳ. */
  async createSource(householdId: bigint, form: Form) {
    const data = this.sourceData(form);
    const limitGroup = data.kind === 'CARD' ? await this.limitGroupFor(householdId, form, null) : '';
    return this.prisma.householdSource.create({ data: { householdId, ...data, limitGroup, openingBalance: parseMoney(form.currentBalance) } });
  }

  /**
   * Sửa nguồn: ô "Số dư / Nợ hiện tại" là số HIỆN TẠI (chủ app nhìn app hoặc ngân hàng rồi gõ), app tự
   * suy số đầu kỳ sao cho cộng với dòng tiền đã ghi ra đúng số ấy. Không nhập gì thì giữ nguyên.
   */
  async updateSource(householdId: bigint, sourceId: bigint, form: Form) {
    const data: Record<string, unknown> = { ...this.sourceData(form), active: form.active !== 'off' };
    data.limitGroup = data.kind === 'CARD' ? await this.limitGroupFor(householdId, form, sourceId) : '';
    const wanted = String(form.currentBalance || '').trim();
    if (wanted) data.openingBalance = await this.openingFor(householdId, sourceId, String(data.kind), parseMoney(wanted));
    return this.prisma.householdSource.updateMany({ where: { id: sourceId, householdId }, data });
  }

  /**
   * Số đầu kỳ để số hiện tại của nguồn bằng `current`: BANK/CASH có current = opening + dòng tiền,
   * CARD/LOAN có nợ = opening − dòng tiền. Dùng chung cho form sửa nguồn và cho Timo báo số dư.
   */
  async openingFor(householdId: bigint, sourceId: bigint, kind: string, current: number): Promise<number> {
    const [source, transactions] = await Promise.all([
      this.prisma.householdSource.findFirst({ where: { id: sourceId, householdId } }),
      this.prisma.householdTransaction.findMany({ where: { householdId, OR: [{ sourceId }, { targetSourceId: sourceId }] } }),
    ]);
    if (!source) return current;
    const zeroOpening = { ...toSourceRow(source), kind, openingBalance: 0 };
    const flow = sourceBalances([zeroOpening], transactions.map(toTransactionRow)).get(String(sourceId))?.balance ?? 0;
    // flow đã mang dấu theo loại: BANK → +dòng tiền, CARD/LOAN → −dòng tiền. current = opening + flow.
    return isDebtSource(kind) ? current - flow : current - flow;
  }

  /** Nguồn có giao dịch thì chỉ ẩn (active = false) để số cũ không mất; chưa có thì xoá hẳn. */
  async deleteSource(householdId: bigint, sourceId: bigint) {
    const used = await this.prisma.householdTransaction.count({ where: { householdId, OR: [{ sourceId }, { targetSourceId: sourceId }] } });
    if (used) return this.prisma.householdSource.updateMany({ where: { id: sourceId, householdId }, data: { active: false } });
    return this.prisma.householdSource.deleteMany({ where: { id: sourceId, householdId } });
  }

  // ───────────────────────────── Mục đích ─────────────────────────────

  createPurpose(householdId: bigint, form: Form) {
    return this.prisma.householdPurpose.create({
      data: { householdId, name: text(form.name) || 'Mục mới', kind: normalizePurposeKind(form.kind), monthlyPlan: parseMoney(form.monthlyPlan), sortOrder: 999 },
    });
  }

  updatePurpose(householdId: bigint, purposeId: bigint, form: Form) {
    return this.prisma.householdPurpose.updateMany({
      where: { id: purposeId, householdId },
      data: { name: text(form.name) || 'Mục', kind: normalizePurposeKind(form.kind), monthlyPlan: parseMoney(form.monthlyPlan), active: form.active !== 'off' },
    });
  }

  async deletePurpose(householdId: bigint, purposeId: bigint) {
    const used = await this.prisma.householdTransaction.count({ where: { householdId, purposeId } });
    if (used) return this.prisma.householdPurpose.updateMany({ where: { id: purposeId, householdId }, data: { active: false } });
    return this.prisma.householdPurpose.deleteMany({ where: { id: purposeId, householdId } });
  }

  // ───────────────────────────── Khoản định kỳ ─────────────────────────────

  private async recurringData(householdId: bigint, form: Form) {
    const kind = normalizeTxKind(form.kind);
    const sourceId = await this.ownSourceId(householdId, form.sourceId);
    const targetSourceId = kind === 'TRANSFER' ? await this.ownSourceId(householdId, form.targetSourceId) : null;
    const purposeId = await this.ownPurposeId(householdId, form.purposeId);
    const startMonth = normalizeMonth(form.startMonth);
    const endMonth = form.endMonth && /^\d{4}-\d{2}$/.test(form.endMonth) ? form.endMonth : null;
    return {
      name: text(form.name) || 'Khoản định kỳ',
      kind,
      sourceId,
      targetSourceId,
      purposeId,
      amount: parseMoney(form.amount),
      interestMode: targetSourceId ? normalizeInterestMode(form.interestMode) : 'NONE',
      dayOfMonth: Math.min(31, Math.max(1, clampDay(form.dayOfMonth) || 1)),
      startMonth,
      endMonth: endMonth && endMonth < startMonth ? null : endMonth,
      note: text(form.note, 500),
    };
  }

  async createRecurring(householdId: bigint, form: Form) {
    return this.prisma.householdRecurring.create({ data: { householdId, ...(await this.recurringData(householdId, form)) } });
  }

  async updateRecurring(householdId: bigint, recurringId: bigint, form: Form) {
    return this.prisma.householdRecurring.updateMany({
      where: { id: recurringId, householdId },
      data: { ...(await this.recurringData(householdId, form)), active: form.active !== 'off' },
    });
  }

  /** Kết thúc khoản định kỳ: tháng sau không sinh dự kiến nữa, lịch sử đã trả vẫn giữ. */
  async deleteRecurring(householdId: bigint, recurringId: bigint) {
    const used = await this.prisma.householdTransaction.count({ where: { householdId, recurringId } });
    if (used) return this.prisma.householdRecurring.updateMany({ where: { id: recurringId, householdId }, data: { active: false } });
    return this.prisma.householdRecurring.deleteMany({ where: { id: recurringId, householdId } });
  }

  /** Id nguồn gửi lên phải thuộc hộ này, không thì coi như không chọn. */
  async ownSourceId(householdId: bigint, raw: unknown): Promise<bigint | null> {
    if (!/^\d+$/.test(String(raw || ''))) return null;
    const id = BigInt(String(raw));
    return (await this.prisma.householdSource.count({ where: { id, householdId } })) ? id : null;
  }

  async ownPurposeId(householdId: bigint, raw: unknown): Promise<bigint | null> {
    if (!/^\d+$/.test(String(raw || ''))) return null;
    const id = BigInt(String(raw));
    return (await this.prisma.householdPurpose.count({ where: { id, householdId } })) ? id : null;
  }
}

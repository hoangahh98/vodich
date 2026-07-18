import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CurrentUser } from '../types';
import { Leftover, matchKey } from './cabinet';

/**
 * Tủ thuốc theo admin: thuốc còn tồn dùng chung cho cả nhà, không gắn với một người
 * thân cụ thể (một hộp thuốc trong nhà thì ai dùng cũng được).
 */
@Injectable()
export class CabinetService {
  constructor(private readonly prisma: PrismaService) {}

  list(user: CurrentUser) {
    return this.prisma.medCabinetItem.findMany({
      where: { ownerAdminId: BigInt(user.id) },
      orderBy: [{ drugName: 'asc' }],
    });
  }

  get(user: CurrentUser, id: bigint) {
    return this.prisma.medCabinetItem.findFirst({ where: { id, ownerAdminId: BigInt(user.id) } });
  }

  /**
   * Ghi thuốc thừa vào tủ. Cùng thuốc + cùng ngày mua thì cộng dồn thay vì tạo dòng
   * mới, tránh tủ thuốc đầy bản ghi trùng khi bấm lại nhiều lần.
   */
  async addLeftovers(user: CurrentUser, leftovers: Leftover[], purchasedAt: Date | null) {
    for (const left of leftovers) {
      const existing = await this.prisma.medCabinetItem.findFirst({
        where: { ownerAdminId: BigInt(user.id), matchKey: left.matchKey, purchasedAt },
      });
      if (existing) {
        await this.prisma.medCabinetItem.update({
          where: { id: existing.id },
          data: { quantity: left.quantity, drugName: left.drugName, unit: left.unit },
        });
        continue;
      }
      await this.prisma.medCabinetItem.create({
        data: {
          ownerAdminId: BigInt(user.id),
          drugName: left.drugName.slice(0, 255),
          matchKey: left.matchKey.slice(0, 255),
          unit: left.unit,
          quantity: left.quantity,
          purchasedAt,
        },
      });
    }
  }

  create(user: CurrentUser, body: Record<string, string>) {
    const name = String(body.drugName || '').trim() || 'Không rõ';
    return this.prisma.medCabinetItem.create({
      data: {
        ownerAdminId: BigInt(user.id),
        drugName: name.slice(0, 255),
        matchKey: matchKey(name).slice(0, 255),
        unit: String(body.unit || '').trim().slice(0, 20),
        quantity: toInt(body.quantity),
        purchasedAt: toDate(body.purchasedAt),
        expiryDate: toDate(body.expiryDate),
        note: String(body.note || '').trim(),
      },
    });
  }

  async update(user: CurrentUser, id: bigint, body: Record<string, string>) {
    const item = await this.get(user, id);
    if (!item) return null;
    const name = String(body.drugName || '').trim() || item.drugName;
    const expiryDate = toDate(body.expiryDate);
    return this.prisma.medCabinetItem.update({
      where: { id },
      data: {
        drugName: name.slice(0, 255),
        matchKey: matchKey(name).slice(0, 255),
        unit: String(body.unit || '').trim().slice(0, 20),
        quantity: toInt(body.quantity),
        purchasedAt: toDate(body.purchasedAt),
        expiryDate,
        note: String(body.note || '').trim(),
        // Điền hạn thật rồi thì phần AI đoán không còn ý nghĩa, xoá đi cho khỏi rối.
        ...(expiryDate ? { aiExpiryNote: null, aiExpiryRisk: null } : {}),
      },
    });
  }

  async remove(user: CurrentUser, id: bigint) {
    const item = await this.get(user, id);
    if (!item) return false;
    await this.prisma.medCabinetItem.delete({ where: { id } });
    return true;
  }

  saveExpiryVerdict(id: bigint, risk: string, note: string) {
    return this.prisma.medCabinetItem.update({ where: { id }, data: { aiExpiryRisk: risk, aiExpiryNote: note } });
  }

  /** Thuốc trong tủ khớp với các thuốc của một đơn — để cảnh báo "nhà còn sẵn". */
  async matchFor(user: CurrentUser, drugNames: string[]) {
    const keys = [...new Set(drugNames.map(matchKey).filter(Boolean))];
    if (!keys.length) return [];
    return this.prisma.medCabinetItem.findMany({
      where: { ownerAdminId: BigInt(user.id), matchKey: { in: keys }, quantity: { gt: 0 } },
      orderBy: [{ drugName: 'asc' }],
    });
  }
}

function toInt(value?: string) {
  const parsed = Math.round(Number(String(value ?? '').replace(/[^\d]/g, '')));
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 9999) : 0;
}

function toDate(value?: string) {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

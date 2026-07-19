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
    // Sửa về 0 nghĩa là nhà hết thuốc đó -> bỏ hẳn khỏi tủ. Giữ lại dòng 0 chỉ tổ làm
    // tủ dài ra bằng những thứ không còn tồn tại, mà đọc lướt lại tưởng là đang có.
    if (toInt(body.quantity) <= 0) {
      await this.prisma.medCabinetItem.delete({ where: { id } });
      return item;
    }
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
  /**
   * Thuốc nhà đang có sẵn ứng với danh sách tên thuốc — để khỏi mua trùng.
   *
   * "Có sẵn" ở đây phải nghĩa là THỪA THẬT: còn ở nhà và KHÔNG nằm trong lịch nào đang
   * chạy. Thuốc đang được một đơn chưa dừng tiêu thụ thì số trong tủ chính là số đang
   * uống dở — báo "nhà có sẵn 8 gói" là đếm hai lần, dễ dẫn tới không mua thứ đang cần.
   *
   * Trả về hai nhóm tách bạch thay vì lặng lẽ giấu:
   *   - available: thừa thật, dùng được ngay (kèm cờ đã quá hạn).
   *   - inUse:     có ở nhà nhưng đang thuộc đơn đang chạy, cố ý KHÔNG tính là thừa.
   *
   * Thuốc quá hạn vẫn trả về nhưng gắn cờ `expired`, không lọc bỏ: giấu đi thì người dùng
   * tưởng nhà không có rồi đi mua, trong khi thứ cần là đem ra kiểm tra vỏ thuốc.
   */
  async matchFor(user: CurrentUser, drugNames: string[]) {
    const keys = [...new Set(drugNames.map(matchKey).filter(Boolean))];
    if (!keys.length) return { available: [], inUse: [] };
    const items = await this.prisma.medCabinetItem.findMany({
      where: { ownerAdminId: BigInt(user.id), matchKey: { in: keys }, quantity: { gt: 0 } },
      orderBy: [{ drugName: 'asc' }],
    });
    if (!items.length) return { available: [], inUse: [] };

    const committed = await this.committedKeys(user);
    const today = new Date().toISOString().slice(0, 10);
    const decorate = (item: (typeof items)[number]) => ({
      ...item,
      expired: Boolean(item.expiryDate && item.expiryDate.toISOString().slice(0, 10) < today),
    });
    return {
      available: items.filter((item) => !committed.has(item.matchKey)).map(decorate),
      inUse: items.filter((item) => committed.has(item.matchKey)).map(decorate),
    };
  }

  /**
   * Sửa số lượng nhiều thuốc trong MỘT lần bấm.
   *
   * Tủ hay phải dọn cả loạt sau mỗi đợt ốm (thứ hết, thứ vơi đi, thứ quá hạn phải bỏ).
   * Bắt sửa từng dòng một là mấy chục lần bấm cho một việc.
   *
   * Chỉ đụng vào dòng của đúng admin này — lọc theo ownerAdminId chứ không tin id gửi lên.
   * Số về 0 nghĩa là bỏ khỏi tủ, giống hệt đường sửa tay từng dòng — nên màn hình KHÔNG
   * cần thêm ô tick bỏ, đó chỉ là đường thứ hai làm đúng việc này.
   */
  async bulkAdjust(user: CurrentUser, quantities: Record<string, number>) {
    const ownerAdminId = BigInt(user.id);
    const owned = await this.prisma.medCabinetItem.findMany({
      where: { ownerAdminId },
      select: { id: true, quantity: true },
    });
    const byId = new Map(owned.map((item) => [item.id.toString(), item]));

    const remove = new Set<string>();
    for (const [id, quantity] of Object.entries(quantities)) {
      if (!byId.has(id)) continue;
      if (quantity <= 0) remove.add(id);
    }

    const updates = Object.entries(quantities)
      .filter(([id, quantity]) => byId.has(id) && !remove.has(id) && quantity !== byId.get(id)!.quantity)
      .map(([id, quantity]) =>
        this.prisma.medCabinetItem.update({ where: { id: BigInt(id) }, data: { quantity } }),
      );
    if (remove.size) {
      updates.push(
        this.prisma.medCabinetItem.deleteMany({
          where: { ownerAdminId, id: { in: [...remove].map((id) => BigInt(id)) } },
        }) as never,
      );
    }
    if (updates.length) await this.prisma.$transaction(updates);
    return { updated: updates.length - (remove.size ? 1 : 0), removed: remove.size };
  }

  /**
   * Ghi nhận số thuốc đã mua cho một dòng đơn, rồi đặt lại tồn kho cho khớp thực tế.
   *
   *     tủ = max(0, tồn_lúc_khai + đã_mua − đơn_cần)
   *
   * Ví dụ nhà còn 7, đơn cần 10:
   *     mua 3  -> 7 + 3 − 10 = 0   (vừa đủ, tủ hết)
   *     mua 10 -> 7 + 10 − 10 = 7  (mua đủ đơn, 7 gói cũ vẫn nằm tủ)
   *     mua 0  -> 7 + 0 − 10 = −3  -> kẹp về 0, thiếu 3 (màn hình cảnh báo riêng)
   *
   * TÍNH TUYỆT ĐỐI từ `baseline`, KHÔNG cộng trừ dồn theo từng lần bấm. Bản trước cộng
   * dồn và đã sai thật: mua 0 -> tủ kẹp về 0 (mất dấu phần âm), sửa lại thành mua 3 thì
   * cộng 3 vào 0 ra 3, trong khi đúng phải là 0. Cứ tính lại từ mốc gốc thì bấm lưu bao
   * nhiêu lần cũng ra một kết quả.
   *
   * Trả `baseline` để chỗ gọi lưu làm mốc cố định (xem stockAtPurchase trong schema).
   */
  async recordPurchase(
    user: CurrentUser,
    input: { drugName: string; unit: string; bought: number; needed: number; baseline: number | null },
  ): Promise<{ baseline: number; after: number }> {
    const key = matchKey(input.drugName);
    if (!key) return { baseline: 0, after: 0 };
    const ownerAdminId = BigInt(user.id);
    const existing = await this.prisma.medCabinetItem.findFirst({
      where: { ownerAdminId, matchKey: key },
      orderBy: { id: 'asc' },
    });

    // Lần đầu thì mốc là tồn đang có; những lần sau dùng lại đúng mốc đã chốt, vì tủ lúc
    // này đã bị trừ phần đơn dùng nên đọc lại là ra số khác.
    const baseline = input.baseline ?? existing?.quantity ?? 0;
    const after = Math.max(0, baseline + input.bought - input.needed);

    if (existing) {
      // Tính ra 0 nghĩa là đơn này dùng hết sạch phần nhà đang có -> bỏ khỏi tủ luôn,
      // không để lại dòng "còn 0 gói". Đổi ý mua nhiều hơn thì nhánh dưới tạo lại.
      if (after <= 0) await this.prisma.medCabinetItem.delete({ where: { id: existing.id } });
      else await this.prisma.medCabinetItem.update({ where: { id: existing.id }, data: { quantity: after } });
      return { baseline, after };
    }
    // Chưa có dòng nào mà tính ra vẫn còn dư thì mở dòng mới; ra 0 thì thôi, không tạo
    // bản ghi rỗng làm rác tủ.
    if (after > 0) {
      await this.prisma.medCabinetItem.create({
        data: {
          ownerAdminId,
          drugName: input.drugName.slice(0, 255),
          matchKey: key,
          unit: input.unit,
          quantity: after,
        },
      });
    }
    return { baseline, after };
  }

  /**
   * Khoá của những thuốc đang bị một đơn CHƯA DỪNG chiếm chỗ (đã chốt lịch, thuốc còn bật).
   * Chỉ soi hồ sơ mà admin này có quyền — cùng bộ lọc với phần còn lại của module y tế.
   */
  private async committedKeys(user: CurrentUser): Promise<Set<string>> {
    const adminId = BigInt(user.id);
    const items = await this.prisma.medPrescriptionItem.findMany({
      where: {
        enabled: true,
        prescription: {
          scheduleStopped: false,
          scheduleStart: { not: null },
          patient: { OR: [{ ownerAdminId: adminId }, { permissions: { some: { adminId } } }] },
        },
      },
      select: { drugName: true },
    });
    return new Set(items.map((item) => matchKey(item.drugName)).filter(Boolean));
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

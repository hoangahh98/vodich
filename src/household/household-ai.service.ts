import { Injectable } from '@nestjs/common';
import { AiService } from '../common/ai.service';
import { PrismaService } from '../prisma.service';
import { HouseholdService } from './household.service';
import { currentMonth, normalizeMonth, parseVnd } from './household-calc';

/** Số tin nhắn giữ lại trong sổ; cũ hơn thì xoá bớt để bảng không phình mãi. */
const KEEP_MESSAGES = 60;
/** Số tin nhắn gần nhất đưa vào lời nhắc để hỏi nối tiếp ("thế còn tháng trước?"). */
const CONTEXT_MESSAGES = 8;
const MAX_QUESTION = 500;

export interface ChatMessage {
  id: bigint;
  role: string;
  content: string;
  askedBy: string;
  createdAt: Date;
}

/** Một khoản trợ lý đọc ra từ câu nói, CHƯA ghi vào sổ — người dùng bấm xác nhận mới ghi. */
export interface QuickEntryDraft {
  type: 'income' | 'expense';
  categoryId: string;
  categoryName: string;
  amount: number;
  occurredAt: string; // YYYY-MM-DD
  note: string;
}

/**
 * Trợ lý chi tiêu: hỏi đáp trên chính số liệu của sổ, và đọc câu nói thường thành một khoản
 * chi/thu điền sẵn.
 *
 * Hai nguyên tắc, đừng bỏ:
 *
 * 1. AI KHÔNG BAO GIỜ TỰ GHI VÀO SỔ. Nó chỉ trả về một bản nháp; người dùng xem rồi bấm
 *    xác nhận, và lúc đó đi qua đúng đường ghi thường (HouseholdService.addIncome/addExpense)
 *    với đầy đủ kiểm tra quyền và kiểm tra sổ. Model đoán sai số tiền là chuyện thường —
 *    đoán sai mà tự ghi vào sổ tiền của người ta thì không chấp nhận được.
 * 2. Lời nhắc chỉ chứa SỐ ĐÃ TÍNH SẴN của đúng sổ đang mở, không kèm id sổ khác, không kèm
 *    thông tin người dùng.
 */
@Injectable()
export class HouseholdAiService {
  constructor(
    private readonly ai: AiService,
    private readonly prisma: PrismaService,
    private readonly household: HouseholdService,
  ) {}

  isConfigured() {
    return this.ai.isConfigured();
  }

  /** Lịch sử hội thoại, cũ → mới (đọc từ dưới lên nên khi hiện ra là đúng thứ tự chat). */
  async history(householdId: number): Promise<ChatMessage[]> {
    const rows = await this.prisma.householdChatMessage.findMany({
      where: { householdId },
      orderBy: { id: 'desc' },
      take: CONTEXT_MESSAGES * 3,
    });
    return rows.reverse();
  }

  clearHistory(householdId: number) {
    return this.prisma.householdChatMessage.deleteMany({ where: { householdId } });
  }

  /** Hỏi trợ lý một câu về sổ. Lưu cả câu hỏi lẫn câu trả lời để lần sau hỏi nối tiếp được. */
  async ask(householdId: number, month: string | undefined, question: string, askedBy: string): Promise<string> {
    const asked = question.trim().slice(0, MAX_QUESTION);
    if (!asked) throw new Error('Chưa nhập câu hỏi.');

    const [snapshot, history] = await Promise.all([this.snapshot(householdId, month), this.history(householdId)]);
    const prompt = [
      'Bạn là trợ lý quản lý chi tiêu gia đình người Việt, nói chuyện thân thiện, ngắn gọn, xưng "mình".',
      'Dưới đây là TOÀN BỘ số liệu sổ chi tiêu của người dùng (đơn vị: đồng). Chỉ được trả lời dựa trên số liệu này.',
      '',
      JSON.stringify(snapshot),
      '',
      history.length ? `Vài câu trao đổi trước đó:\n${history.slice(-CONTEXT_MESSAGES).map((m) => `${m.role === 'user' ? 'Người dùng' : 'Trợ lý'}: ${m.content}`).join('\n')}` : '',
      '',
      `Câu hỏi: ${asked}`,
      '',
      'Yêu cầu: trả lời tiếng Việt, tối đa 6 câu, có số cụ thể (viết kiểu 12.500.000đ). Nếu số liệu trong sổ không đủ để trả lời thì nói thẳng là sổ chưa có dữ liệu đó và gợi ý cần khai thêm gì — TUYỆT ĐỐI không bịa số. Không dùng markdown, không dùng bảng.',
    ].join('\n');

    const answer = (await this.ai.generate(prompt, { temperature: 0.4, maxTokens: 900 })).trim();
    await this.prisma.householdChatMessage.createMany({
      data: [
        { householdId, role: 'user', content: asked, askedBy: askedBy.slice(0, 80) },
        { householdId, role: 'assistant', content: answer.slice(0, 4000), askedBy: '' },
      ],
    });
    await this.trim(householdId);
    return answer;
  }

  /**
   * Đọc một câu kiểu "trưa nay ăn cơm hết 65k" thành bản nháp một khoản chi. Loại phải là
   * MỘT trong các loại có thật của sổ — trả về id, không phải tên tự nghĩ ra.
   */
  async draftEntry(householdId: number, rawText: string): Promise<QuickEntryDraft> {
    const said = rawText.trim().slice(0, MAX_QUESTION);
    if (!said) throw new Error('Chưa nhập nội dung để ghi.');

    const book = await this.household.book(householdId, currentMonth());
    const incomes = book.incomeCategories.filter((c) => c.active);
    const expenses = book.expenseCategories.filter((c) => c.active);
    if (!incomes.length && !expenses.length) throw new Error('Sổ chưa có loại thu/chi nào — vào mục Loại chi phí khai trước đã.');

    const list = (rows: typeof incomes) => rows.map((c) => `${c.id}=${c.name}`).join(', ') || '(chưa có)';
    const prompt = [
      'Bạn đọc một câu tiếng Việt nói về việc thu hoặc chi tiền trong gia đình, rồi bóc thành dữ liệu.',
      `Hôm nay là ${todayIso()}.`,
      `Các LOẠI CHI PHÍ có sẵn (id=tên): ${list(expenses)}`,
      `Các LOẠI THU NHẬP có sẵn (id=tên): ${list(incomes)}`,
      '',
      `Câu cần bóc: "${said}"`,
      '',
      'Trả về JSON đúng schema:',
      '{ "type": "expense hoặc income", "categoryId": "id của loại phù hợp nhất, lấy TRONG danh sách trên", "amount": số tiền dạng số nguyên đồng, "occurredAt": "YYYY-MM-DD", "note": "nội dung ngắn gọn" }',
      '',
      'Quy ước tiền Việt: "65k"/"65 nghìn" = 65000, "2 triệu rưỡi" = 2500000, "1tr2" = 1200000, "500 lít"/"500 củ" = 500000.',
      'Nếu câu nói về tiền NHẬN được (lương, thưởng, ai đó trả tiền) thì type = income, còn lại là expense.',
      '"hôm qua" = ngày hôm trước, "hôm nay"/không nói ngày = hôm nay. Chỉ trả JSON.',
    ].join('\n');

    const raw = await this.ai.generateJson<Record<string, unknown>>(prompt, { temperature: 0.1, maxTokens: 400 });
    const type = String(raw.type ?? '') === 'income' ? 'income' : 'expense';
    const pool = type === 'income' ? incomes : expenses;
    // Model hay trả về tên loại thay vì id, hoặc id của một loại nó tự nghĩ ra — chỉ nhận
    // khi khớp đúng một loại CÓ THẬT của sổ này, không thì rơi về loại đầu tiên.
    const wanted = String(raw.categoryId ?? '').trim();
    const category = pool.find((c) => String(c.id) === wanted) ?? pool.find((c) => c.name.toLowerCase() === wanted.toLowerCase()) ?? pool[0];
    if (!category) throw new Error(`Sổ chưa có loại ${type === 'income' ? 'thu nhập' : 'chi phí'} nào để ghi vào.`);

    const amount = parseVnd(raw.amount);
    if (amount <= 0) throw new Error('Không đọc được số tiền trong câu vừa nhập, thử ghi rõ số tiền xem.');

    return {
      type,
      categoryId: String(category.id),
      categoryName: category.name,
      amount,
      occurredAt: isoDate(raw.occurredAt) ?? todayIso(),
      note: String(raw.note ?? '').trim().slice(0, 120) || said.slice(0, 120),
    };
  }

  /**
   * Số liệu gửi cho AI: đã tính sẵn, gọn, không có id nội bộ nào ngoài tên loại. Gửi con số
   * thay vì gửi từng dòng thô để lời nhắc không phình theo số năm dùng sổ.
   */
  private async snapshot(householdId: number, rawMonth?: string) {
    const month = normalizeMonth(rawMonth) ?? currentMonth();
    const { report, expenses, incomes, expenseCategories, incomeCategories } = await this.household.book(householdId, month);
    const nameOf = (rows: Array<{ id: bigint; name: string }>, id: bigint | null) =>
      rows.find((row) => row.id === id)?.name ?? '(loại đã xoá)';

    return {
      thang_dang_xem: month,
      thu_nhap_thang: report.income,
      chi_phi_thang: report.expense,
      gui_tiet_kiem_thang: report.savingIn,
      rut_tiet_kiem_thang: report.savingOut,
      tiet_kiem_dang_co: report.savingBalance, // không gồm quỹ du lịch, quỹ đó tách riêng ở dưới
      quy_du_lich_nam_nay: report.travelThisYear,
      quy_du_lich_tu_dau_so: report.travelAllTime,
      con_lai_thang: report.leftover, // tiền mặt còn, CHƯA trừ ngân sách đã hứa
      ngan_sach_da_khai_thang: report.plannedTotal,
      ngan_sach_chua_tieu: report.budgetLeft,
      con_tu_do_thang: report.freeThisMonth, // đã trừ ngân sách chưa tiêu
      con_lai_luy_ke: report.leftoverTotal,
      con_tu_do_luy_ke: report.freeTotal,
      thu_theo_loai: report.incomeByCategory.map((row) => ({ loai: row.name, tien: row.amount, so_khoan: row.count })),
      chi_theo_loai: report.expenseByCategory.map((row) => ({ loai: row.name, tien: row.amount, so_khoan: row.count, ty_trong_phan_tram: row.share })),
      tiet_kiem_theo_loai: report.savingByCategory.map((row) => ({ loai: row.name, tien: row.amount })),
      sau_thang_gan_nhat: report.trend.map((row) => ({
        thang: row.month,
        thu: row.income,
        chi: row.expense,
        gui_tiet_kiem: row.savingIn,
        con_lai: row.leftover,
      })),
      so_no: {
        tong_minh_dang_no: report.oweRemaining,
        tong_nguoi_ta_no_minh: report.lendRemaining,
        thang_nay_tra_goc: report.debtPrincipalPaid,
        thang_nay_tra_lai: report.debtInterestPaid,
        cac_khoan: report.debts.map((debt) => ({
          ten: debt.name,
          chieu: debt.direction === 'owe' ? 'mình nợ' : 'người ta nợ mình',
          voi_ai: debt.counterparty,
          no_ban_dau: debt.initialAmount,
          da_tra_goc: debt.principalPaid,
          da_tra_lai: debt.interestPaid,
          con_lai: debt.remaining,
        })),
      },
      cac_khoan_chi_thang_nay: expenses.slice(0, 40).map((row) => ({
        ngay: row.occurredAt.toISOString().slice(0, 10),
        loai: nameOf(expenseCategories, row.categoryId),
        tien: Number(row.amount),
        ghi_chu: row.note,
      })),
      cac_khoan_thu_thang_nay: incomes.slice(0, 40).map((row) => ({
        ngay: row.occurredAt.toISOString().slice(0, 10),
        loai: nameOf(incomeCategories, row.categoryId),
        tien: Number(row.amount),
        ghi_chu: row.note,
      })),
    };
  }

  /** Giữ lại KEEP_MESSAGES tin gần nhất của sổ này. */
  private async trim(householdId: number) {
    const keep = await this.prisma.householdChatMessage.findMany({
      where: { householdId },
      orderBy: { id: 'desc' },
      take: KEEP_MESSAGES,
      select: { id: true },
    });
    if (keep.length < KEEP_MESSAGES) return;
    const oldest = keep[keep.length - 1].id;
    await this.prisma.householdChatMessage.deleteMany({ where: { householdId, id: { lt: oldest } } });
  }
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoDate(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

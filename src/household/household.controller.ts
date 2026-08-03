import { Body, Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { forbidden, notFound, parseBigId } from '../common/controller-utils';
import { AdminOnly, FeatureAccess } from '../common/feature.decorator';
import { RateLimitService } from '../common/rate-limit.service';
import { render } from '../common/view';
import { CurrentUser } from '../types';
import { HouseholdAccessService } from './household-access.service';
import { HouseholdAiService, QuickEntryDraft } from './household-ai.service';
import { HouseholdService, WriteResult } from './household.service';

/** Các mục của module, theo đúng thứ tự menu ba gạch. */
const SECTIONS = ['tong-quan', 'thu', 'chi', 'loai-thu', 'loai-chi', 'so-no', 'tro-ly', 'cai-dat'];

/**
 * Module Quản Lý Chi Tiêu — CHỈ dành cho admin (tài chính riêng của gia đình).
 * Gác quyền như các module quản trị khác: cần feature HOUSEHOLD + là admin.
 *
 * Mỗi admin có SỔ riêng và có thể cấp quyền cho admin khác, giống giải đấu / đội bóng.
 * Mọi handler đều đi qua `book()` để lấy id sổ đã kiểm quyền rồi mới gọi service —
 * không handler nào tự nhận id sổ từ body.
 */
@Controller()
@FeatureAccess('HOUSEHOLD')
@AdminOnly()
export class HouseholdController {
  constructor(
    private readonly household: HouseholdService,
    private readonly access: HouseholdAccessService,
    private readonly ai: HouseholdAiService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Get(['/household', '/household/:section'])
  async index(
    @Req() req: Request,
    @Res() res: Response,
    @Param('section') section?: string,
    @Query('book') book?: string,
    @Query('month') month?: string,
    @Query('msg') msg?: string,
    @Query('err') err?: string,
  ) {
    const { books, current } = await this.access.resolveBook(user(req), book);
    const active = SECTIONS.includes(String(section)) ? String(section) : 'tong-quan';
    const [config, data, admins, chat] = await Promise.all([
      this.household.getConfig(current.id),
      this.household.book(current.id, month),
      this.access.availableAdmins(current.id, current.ownerAdminId),
      active === 'tro-ly' ? this.ai.history(current.id) : Promise.resolve([]),
    ]);
    return render(res, 'household/index', {
      section: active,
      config,
      book: data,
      report: data.report,
      books,
      currentBook: current,
      isOwner: this.access.isOwner(user(req), current),
      admins,
      chat,
      aiConfigured: this.ai.isConfigured(),
      draft: readDraft(req.query),
      msg: String(msg || ''),
      err: String(err || ''),
    });
  }

  // ─── Khoản thu ───

  @Post('/household/income')
  async addIncome(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, string>) {
    const id = await this.book(req, res);
    if (id === null) return;
    return this.backTo(res, id, 'thu', await this.household.addIncome(id, body));
  }

  @Post('/household/income/copy')
  async copyIncome(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, string>) {
    const id = await this.book(req, res);
    if (id === null) return;
    return this.backTo(res, id, 'thu', await this.household.copyIncomeFromPreviousMonth(id, body.month));
  }

  @Post('/household/income/:id')
  async updateIncome(@Req() req: Request, @Res() res: Response, @Param('id') rawId: string, @Body() body: Record<string, string>) {
    const id = await this.book(req, res);
    if (id === null) return;
    const incomeId = parseBigId(rawId);
    if (!incomeId) return notFound(res);
    return this.backTo(res, id, 'thu', await this.household.updateIncome(id, incomeId, body));
  }

  @Post('/household/income/:id/delete')
  async deleteIncome(@Req() req: Request, @Res() res: Response, @Param('id') rawId: string) {
    const id = await this.book(req, res);
    if (id === null) return;
    const incomeId = parseBigId(rawId);
    if (!incomeId) return notFound(res);
    const month = await this.household.deleteIncome(id, incomeId);
    return this.backTo(res, id, 'thu', { month, msg: 'Đã xoá khoản thu' });
  }

  // ─── Khoản chi ───

  @Post('/household/expenses')
  async addExpense(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, string>) {
    const id = await this.book(req, res);
    if (id === null) return;
    return this.backTo(res, id, 'chi', await this.household.addExpense(id, body));
  }

  /** Rút tiết kiệm bù phần chi vượt. Quay về đúng mục đang đứng, không quăng người dùng đi đâu. */
  @Post('/household/cover')
  async coverOverspend(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, string>) {
    const id = await this.book(req, res);
    if (id === null) return;
    const from = SECTIONS.includes(String(body.from)) ? String(body.from) : 'tong-quan';
    return this.backTo(res, id, from, await this.household.coverOverspend(id, body));
  }

  @Post('/household/expenses/copy')
  async copyExpense(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, string>) {
    const id = await this.book(req, res);
    if (id === null) return;
    return this.backTo(res, id, 'chi', await this.household.copyExpenseFromPreviousMonth(id, body.month));
  }

  @Post('/household/expenses/:id')
  async updateExpense(@Req() req: Request, @Res() res: Response, @Param('id') rawId: string, @Body() body: Record<string, string>) {
    const id = await this.book(req, res);
    if (id === null) return;
    const expenseId = parseBigId(rawId);
    if (!expenseId) return notFound(res);
    return this.backTo(res, id, 'chi', await this.household.updateExpense(id, expenseId, body));
  }

  @Post('/household/expenses/:id/delete')
  async deleteExpense(@Req() req: Request, @Res() res: Response, @Param('id') rawId: string) {
    const id = await this.book(req, res);
    if (id === null) return;
    const expenseId = parseBigId(rawId);
    if (!expenseId) return notFound(res);
    const month = await this.household.deleteExpense(id, expenseId);
    return this.backTo(res, id, 'chi', { month, msg: 'Đã xoá khoản chi' });
  }

  // ─── Loại thu nhập ───

  @Post('/household/income-categories')
  async addIncomeCategory(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, string>) {
    const id = await this.book(req, res);
    if (id === null) return;
    return this.backTo(res, id, 'loai-thu', await this.household.addIncomeCategory(id, body));
  }

  @Post('/household/income-categories/:id')
  async updateIncomeCategory(@Req() req: Request, @Res() res: Response, @Param('id') rawId: string, @Body() body: Record<string, string>) {
    const id = await this.book(req, res);
    if (id === null) return;
    const categoryId = parseBigId(rawId);
    if (!categoryId) return notFound(res);
    return this.backTo(res, id, 'loai-thu', await this.household.updateIncomeCategory(id, categoryId, body));
  }

  @Post('/household/income-categories/:id/delete')
  async deleteIncomeCategory(@Req() req: Request, @Res() res: Response, @Param('id') rawId: string, @Body() body: Record<string, string>) {
    const id = await this.book(req, res);
    if (id === null) return;
    const categoryId = parseBigId(rawId);
    if (!categoryId) return notFound(res);
    const { count } = await this.household.deleteIncomeCategory(id, categoryId);
    if (!count) return notFound(res, 'Không tìm thấy loại thu nhập trong sổ này');
    return this.backTo(res, id, 'loai-thu', { month: monthOrEmpty(body.month), msg: 'Đã xoá loại thu nhập' });
  }

  // ─── Loại chi phí ───

  @Post('/household/expense-categories')
  async addExpenseCategory(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, string>) {
    const id = await this.book(req, res);
    if (id === null) return;
    return this.backTo(res, id, 'loai-chi', await this.household.addExpenseCategory(id, body));
  }

  @Post('/household/expense-categories/:id')
  async updateExpenseCategory(@Req() req: Request, @Res() res: Response, @Param('id') rawId: string, @Body() body: Record<string, string>) {
    const id = await this.book(req, res);
    if (id === null) return;
    const categoryId = parseBigId(rawId);
    if (!categoryId) return notFound(res);
    return this.backTo(res, id, 'loai-chi', await this.household.updateExpenseCategory(id, categoryId, body));
  }

  @Post('/household/expense-categories/:id/delete')
  async deleteExpenseCategory(@Req() req: Request, @Res() res: Response, @Param('id') rawId: string, @Body() body: Record<string, string>) {
    const id = await this.book(req, res);
    if (id === null) return;
    const categoryId = parseBigId(rawId);
    if (!categoryId) return notFound(res);
    const { count } = await this.household.deleteExpenseCategory(id, categoryId);
    if (!count) return notFound(res, 'Không tìm thấy loại chi phí trong sổ này');
    return this.backTo(res, id, 'loai-chi', { month: monthOrEmpty(body.month), msg: 'Đã xoá loại chi phí' });
  }

  // ─── Sổ nợ ───

  @Post('/household/debts')
  async addDebt(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, string>) {
    const id = await this.book(req, res);
    if (id === null) return;
    return this.backTo(res, id, 'so-no', await this.household.addDebt(id, body));
  }

  @Post('/household/debts/:id')
  async updateDebt(@Req() req: Request, @Res() res: Response, @Param('id') rawId: string, @Body() body: Record<string, string>) {
    const id = await this.book(req, res);
    if (id === null) return;
    const debtId = parseBigId(rawId);
    if (!debtId) return notFound(res);
    return this.backTo(res, id, 'so-no', await this.household.updateDebt(id, debtId, body));
  }

  @Post('/household/debts/:id/delete')
  async deleteDebt(@Req() req: Request, @Res() res: Response, @Param('id') rawId: string, @Body() body: Record<string, string>) {
    const id = await this.book(req, res);
    if (id === null) return;
    const debtId = parseBigId(rawId);
    if (!debtId) return notFound(res);
    const removed = await this.household.deleteDebt(id, debtId);
    if (!removed) return notFound(res, 'Không tìm thấy khoản nợ trong sổ này');
    return this.backTo(res, id, 'so-no', { month: monthOrEmpty(body.month), msg: 'Đã xoá khoản nợ' });
  }

  // ─── Trợ lý AI ───

  @Post('/household/ai/ask')
  async askAi(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, string>) {
    const id = await this.book(req, res);
    if (id === null) return;
    const limited = this.limitAi(req);
    if (limited) return this.backTo(res, id, 'tro-ly', { month: monthOrEmpty(body.month), err: limited });
    try {
      await this.ai.ask(id, body.month, String(body.question || ''), user(req).displayName || '');
    } catch (error) {
      return this.backTo(res, id, 'tro-ly', { month: monthOrEmpty(body.month), err: message(error) });
    }
    return this.backTo(res, id, 'tro-ly', { month: monthOrEmpty(body.month) });
  }

  @Post('/household/ai/clear')
  async clearAi(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, string>) {
    const id = await this.book(req, res);
    if (id === null) return;
    await this.ai.clearHistory(id);
    return this.backTo(res, id, 'tro-ly', { month: monthOrEmpty(body.month), msg: 'Đã xoá lịch sử trò chuyện' });
  }

  /**
   * Ghi nhanh bằng câu nói: AI chỉ ĐỌC ra bản nháp rồi trả về màn hình cho người dùng xem;
   * bấm xác nhận mới thật sự ghi, và lúc đó đi qua đúng đường /household/income|expenses.
   * Bản nháp đi theo query string nên không cần bảng tạm nào.
   */
  @Post('/household/ai/draft')
  async draftEntry(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, string>) {
    const id = await this.book(req, res);
    if (id === null) return;
    const limited = this.limitAi(req);
    if (limited) return this.backTo(res, id, 'tro-ly', { month: monthOrEmpty(body.month), err: limited });
    let draft: QuickEntryDraft;
    try {
      draft = await this.ai.draftEntry(id, String(body.text || ''));
    } catch (error) {
      return this.backTo(res, id, 'tro-ly', { month: monthOrEmpty(body.month), err: message(error) });
    }
    return this.backTo(res, id, 'tro-ly', {
      month: monthOrEmpty(body.month),
      draftType: draft.type,
      draftCategoryId: draft.categoryId,
      draftCategoryName: draft.categoryName,
      draftAmount: String(draft.amount),
      draftDate: draft.occurredAt,
      draftNote: draft.note,
    });
  }

  // ─── Phân quyền admin (chỉ chủ sổ) ───

  @Post('/household/permissions')
  async addPermission(@Req() req: Request, @Res() res: Response, @Body('adminId') adminIdRaw: string) {
    const book = await this.ownedBook(req, res);
    if (!book) return;
    const adminId = parseBigId(adminIdRaw);
    if (!adminId) return notFound(res, 'Không tìm thấy admin');
    await this.access.addPermission(book.id, adminId);
    return this.backTo(res, book.id, 'cai-dat', { msg: 'Đã cấp quyền' });
  }

  @Post('/household/permissions/:permissionId/delete')
  async removePermission(@Req() req: Request, @Res() res: Response, @Param('permissionId') permissionIdParam: string) {
    const book = await this.ownedBook(req, res);
    if (!book) return;
    const permissionId = parseBigId(permissionIdParam);
    if (!permissionId) return notFound(res);
    await this.access.removePermission(book.id, permissionId);
    return this.backTo(res, book.id, 'cai-dat', { msg: 'Đã gỡ quyền' });
  }

  /** Id sổ đang thao tác, đã kiểm quyền. Trả null nghĩa là đã trả lời lỗi cho client. */
  private async book(req: Request, res: Response): Promise<number | null> {
    const { current } = await this.access.resolveBook(user(req), req.body?.book ?? req.query.book);
    if (!current) {
      notFound(res, 'Không tìm thấy sổ chi tiêu');
      return null;
    }
    return current.id;
  }

  private async ownedBook(req: Request, res: Response) {
    const { current } = await this.access.resolveBook(user(req), req.body?.book ?? req.query.book);
    if (!current) {
      notFound(res, 'Không tìm thấy sổ chi tiêu');
      return null;
    }
    if (!this.access.isOwner(user(req), current)) {
      forbidden(res, 'Chỉ người tạo sổ mới được phân quyền');
      return null;
    }
    return current;
  }

  /** Mỗi lượt gọi AI đều tốn tiền và tốn hạn mức chung của app, nên chặn bấm liên tục. */
  private limitAi(req: Request): string | null {
    const limit = this.rateLimit.consume(`ai:household:${req.ip || 'unknown'}`, { max: 12, windowMs: 60_000 });
    return limit.allowed ? null : `Hỏi hơi nhanh rồi, thử lại sau ${limit.retryAfterSeconds}s nhé`;
  }

  private backTo(res: Response, bookId: number, section: string, params: Record<string, string | undefined> = {}) {
    const clean = Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1]));
    const query = new URLSearchParams([['book', String(bookId)], ...clean]);
    return res.redirect(`/household/${section}?${query.toString()}`);
  }
}

function user(req: Request): CurrentUser {
  return req.session.user!;
}

/** Tháng đang xem gửi kèm form — bỏ trống thì để service rơi về tháng hiện tại. */
function monthOrEmpty(value: unknown): string {
  const raw = String(value ?? '').trim();
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : '';
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Trợ lý gặp lỗi, thử lại sau nhé';
}

/** Bản nháp trợ lý vừa đọc ra, lấy lại từ query string để dựng form xác nhận. */
function readDraft(query: Request['query']): QuickEntryDraft | null {
  const type = String(query.draftType || '');
  const amount = Number.parseInt(String(query.draftAmount || ''), 10);
  if ((type !== 'income' && type !== 'expense') || !Number.isFinite(amount) || amount <= 0) return null;
  return {
    type,
    categoryId: String(query.draftCategoryId || ''),
    categoryName: String(query.draftCategoryName || ''),
    amount,
    occurredAt: String(query.draftDate || ''),
    note: String(query.draftNote || ''),
  };
}

export type { WriteResult };

import { Body, Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { forbidden, notFound, parseBigId } from '../common/controller-utils';
import { AdminOnly, FeatureAccess } from '../common/feature.decorator';
import { render } from '../common/view';
import { CurrentUser } from '../types';
import { HouseholdAccessService } from './household-access.service';
import { HouseholdService } from './household.service';

/** Năm phần của bảng tính, cộng thêm Tổng quan và Cài đặt. Thứ tự này chính là thứ tự menu. */
const SECTIONS = ['tong-quan', 'thu', 'tiet-kiem', 'tra-no', 'chi-phi-co-dinh', 'phat-sinh', 'cai-dat'];

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
    const [config, data, admins] = await Promise.all([
      this.household.getConfig(current.id),
      this.household.book(current.id, month),
      this.access.availableAdmins(current.id, current.ownerAdminId),
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
      msg: String(msg || ''),
      err: String(err || ''),
    });
  }

  @Post('/household/config')
  async saveConfig(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, string>) {
    const id = await this.book(req, res);
    if (id === null) return;
    await this.household.updateConfig(id, body);
    return this.backTo(res, id, 'cai-dat', { msg: 'Đã lưu cài đặt' });
  }

  @Post('/household/seed')
  async seed(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, string>) {
    const id = await this.book(req, res);
    if (id === null) return;
    const { month, added } = await this.household.seedTemplate(id, body.month);
    const back = SECTIONS.includes(String(body.section)) ? String(body.section) : 'cai-dat';
    const note = added.length ? `Đã nạp mẫu: ${added.join(', ')}` : 'Các danh mục đã có sẵn, không nạp thêm gì';
    return this.backTo(res, id, back, { month, ...(added.length ? { msg: note } : { err: note }) });
  }

  // ─── 1. Thu ───
  @Post('/household/income')
  async addIncome(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, string>) {
    const id = await this.book(req, res);
    if (id === null) return;
    const month = await this.household.addIncome(id, body);
    return this.backTo(res, id, 'thu', { month });
  }

  @Post('/household/income/copy')
  async copyIncome(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, string>) {
    const id = await this.book(req, res);
    if (id === null) return;
    const { month, copied } = await this.household.copyIncomeFromPreviousMonth(id, body.month);
    const note = copied ? `Đã chép ${copied} khoản thu từ tháng trước` : 'Tháng trước không có khoản thu nào mới để chép';
    return this.backTo(res, id, 'thu', { month, ...(copied ? { msg: note } : { err: note }) });
  }

  @Post('/household/income/:id/delete')
  async deleteIncome(@Req() req: Request, @Res() res: Response, @Param('id') rawId: string) {
    const id = await this.book(req, res);
    if (id === null) return;
    const incomeId = parseBigId(rawId);
    if (!incomeId) return notFound(res);
    const month = await this.household.deleteIncome(id, incomeId);
    return this.backTo(res, id, 'thu', { month });
  }

  // ─── 2. Tiết kiệm ───
  @Post('/household/funds')
  async addFund(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, string>) {
    const id = await this.book(req, res);
    if (id === null) return;
    await this.household.addFund(id, body);
    return this.backTo(res, id, 'tiet-kiem', { month: monthOrEmpty(body.month), msg: 'Đã thêm quỹ' });
  }

  @Post('/household/funds/:id')
  async updateFund(@Req() req: Request, @Res() res: Response, @Param('id') rawId: string, @Body() body: Record<string, string>) {
    const id = await this.book(req, res);
    if (id === null) return;
    const fundId = parseBigId(rawId);
    if (!fundId) return notFound(res);
    await this.household.updateFund(id, fundId, body);
    return this.backTo(res, id, 'tiet-kiem', { month: monthOrEmpty(body.month), msg: 'Đã lưu quỹ' });
  }

  @Post('/household/funds/:id/delete')
  async deleteFund(@Req() req: Request, @Res() res: Response, @Param('id') rawId: string, @Body() body: Record<string, string>) {
    const id = await this.book(req, res);
    if (id === null) return;
    const fundId = parseBigId(rawId);
    if (!fundId) return notFound(res);
    const removed = await this.household.deleteFund(id, fundId);
    if (!removed) return notFound(res, 'Không tìm thấy quỹ trong sổ này');
    return this.backTo(res, id, 'tiet-kiem', { month: monthOrEmpty(body.month), msg: 'Đã xoá quỹ' });
  }

  @Post('/household/fund-entries')
  async addFundEntry(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, string>) {
    const id = await this.book(req, res);
    if (id === null) return;
    const month = await this.household.addFundEntry(id, body);
    return this.backTo(res, id, 'tiet-kiem', { month });
  }

  @Post('/household/fund-entries/:id/delete')
  async deleteFundEntry(@Req() req: Request, @Res() res: Response, @Param('id') rawId: string) {
    const id = await this.book(req, res);
    if (id === null) return;
    const entryId = parseBigId(rawId);
    if (!entryId) return notFound(res);
    const month = await this.household.deleteFundEntry(id, entryId);
    return this.backTo(res, id, 'tiet-kiem', { month });
  }

  // ─── 3. Trả nợ ───
  @Post('/household/debts')
  async addDebt(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, string>) {
    const id = await this.book(req, res);
    if (id === null) return;
    await this.household.addDebt(id, body);
    return this.backTo(res, id, 'tra-no', { month: monthOrEmpty(body.month), msg: 'Đã thêm khoản nợ' });
  }

  @Post('/household/debts/:id')
  async updateDebt(@Req() req: Request, @Res() res: Response, @Param('id') rawId: string, @Body() body: Record<string, string>) {
    const id = await this.book(req, res);
    if (id === null) return;
    const debtId = parseBigId(rawId);
    if (!debtId) return notFound(res);
    await this.household.updateDebt(id, debtId, body);
    return this.backTo(res, id, 'tra-no', { month: monthOrEmpty(body.month), msg: 'Đã lưu khoản nợ' });
  }

  @Post('/household/debts/:id/delete')
  async deleteDebt(@Req() req: Request, @Res() res: Response, @Param('id') rawId: string, @Body() body: Record<string, string>) {
    const id = await this.book(req, res);
    if (id === null) return;
    const debtId = parseBigId(rawId);
    if (!debtId) return notFound(res);
    const removed = await this.household.deleteDebt(id, debtId);
    if (!removed) return notFound(res, 'Không tìm thấy khoản nợ trong sổ này');
    return this.backTo(res, id, 'tra-no', { month: monthOrEmpty(body.month), msg: 'Đã xoá khoản nợ' });
  }

  @Post('/household/debt-payments')
  async saveDebtPayment(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, string>) {
    const id = await this.book(req, res);
    if (id === null) return;
    const month = await this.household.saveDebtPayment(id, body);
    return this.backTo(res, id, 'tra-no', { month, msg: 'Đã lưu gốc & lãi tháng này' });
  }

  // ─── 4. Chi phí cố định ───
  @Post('/household/fixed-costs')
  async addFixedCost(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, string>) {
    const id = await this.book(req, res);
    if (id === null) return;
    await this.household.addFixedCost(id, body);
    return this.backTo(res, id, 'chi-phi-co-dinh', { month: monthOrEmpty(body.month), msg: 'Đã thêm khoản cố định' });
  }

  @Post('/household/fixed-costs/:id')
  async updateFixedCost(@Req() req: Request, @Res() res: Response, @Param('id') rawId: string, @Body() body: Record<string, string>) {
    const id = await this.book(req, res);
    if (id === null) return;
    const costId = parseBigId(rawId);
    if (!costId) return notFound(res);
    await this.household.updateFixedCost(id, costId, body);
    return this.backTo(res, id, 'chi-phi-co-dinh', { month: monthOrEmpty(body.month), msg: 'Đã lưu khoản cố định' });
  }

  @Post('/household/fixed-costs/:id/delete')
  async deleteFixedCost(@Req() req: Request, @Res() res: Response, @Param('id') rawId: string, @Body() body: Record<string, string>) {
    const id = await this.book(req, res);
    if (id === null) return;
    const costId = parseBigId(rawId);
    if (!costId) return notFound(res);
    const removed = await this.household.deleteFixedCost(id, costId);
    if (!removed) return notFound(res, 'Không tìm thấy khoản cố định trong sổ này');
    return this.backTo(res, id, 'chi-phi-co-dinh', { month: monthOrEmpty(body.month), msg: 'Đã xoá khoản cố định' });
  }

  @Post('/household/fixed-spends')
  async addFixedSpend(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, string>) {
    const id = await this.book(req, res);
    if (id === null) return;
    const month = await this.household.addFixedSpend(id, body);
    return this.backTo(res, id, 'chi-phi-co-dinh', { month });
  }

  @Post('/household/fixed-spends/:id/delete')
  async deleteFixedSpend(@Req() req: Request, @Res() res: Response, @Param('id') rawId: string) {
    const id = await this.book(req, res);
    if (id === null) return;
    const spendId = parseBigId(rawId);
    if (!spendId) return notFound(res);
    const month = await this.household.deleteFixedSpend(id, spendId);
    return this.backTo(res, id, 'chi-phi-co-dinh', { month });
  }

  // ─── 5. Chi phí phát sinh ───
  @Post('/household/extras')
  async addExtra(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, string>) {
    const id = await this.book(req, res);
    if (id === null) return;
    const month = await this.household.addExtraCost(id, body);
    return this.backTo(res, id, 'phat-sinh', { month });
  }

  @Post('/household/extras/:id/delete')
  async deleteExtra(@Req() req: Request, @Res() res: Response, @Param('id') rawId: string) {
    const id = await this.book(req, res);
    if (id === null) return;
    const extraId = parseBigId(rawId);
    if (!extraId) return notFound(res);
    const month = await this.household.deleteExtraCost(id, extraId);
    return this.backTo(res, id, 'phat-sinh', { month });
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

  private backTo(res: Response, bookId: number, section: string, params: Record<string, string> = {}) {
    const clean = Object.fromEntries(Object.entries(params).filter(([, value]) => value !== ''));
    const query = new URLSearchParams({ book: String(bookId), ...clean });
    return res.redirect(`/household/${section}?${query.toString()}`);
  }
}

function user(req: Request): CurrentUser {
  return req.session.user!;
}

/** Tháng đang xem gửi kèm form sửa danh mục — bỏ trống thì để service rơi về tháng hiện tại. */
function monthOrEmpty(value: unknown): string {
  const raw = String(value ?? '').trim();
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : '';
}

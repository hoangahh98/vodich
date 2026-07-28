import { Body, Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { forbidden, notFound, parseBigId } from '../common/controller-utils';
import { AdminOnly, FeatureAccess } from '../common/feature.decorator';
import { render } from '../common/view';
import { CurrentUser } from '../types';
import { HouseholdAccessService } from './household-access.service';
import { HouseholdService } from './household.service';

const SECTIONS = ['tong-quan', 'thu-nhap', 'chi-tieu', 'cai-dat'];

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
    const [config, summary, members, txns, monthBook, admins] = await Promise.all([
      this.household.getConfig(current.id),
      this.household.summary(current.id),
      this.household.listMembers(current.id),
      this.household.listTxns(current.id),
      this.household.monthBook(current.id, month),
      this.access.availableAdmins(current.id, current.ownerAdminId),
    ]);
    return render(res, 'household/index', {
      section: active,
      config,
      summary,
      members,
      txns,
      book: monthBook,
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

  // ─── Thành viên ───
  @Post('/household/members')
  async addMember(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, string>) {
    const id = await this.book(req, res);
    if (id === null) return;
    await this.household.addMember(id, body);
    return this.backTo(res, id, 'cai-dat');
  }

  @Post('/household/members/:id')
  async updateMember(@Req() req: Request, @Res() res: Response, @Param('id') memberIdParam: string, @Body() body: Record<string, string>) {
    const id = await this.book(req, res);
    if (id === null) return;
    const memberId = parseBigId(memberIdParam);
    if (!memberId) return notFound(res);
    await this.household.updateMember(id, memberId, body);
    return this.backTo(res, id, 'cai-dat', { msg: 'Đã lưu thành viên' });
  }

  @Post('/household/members/:id/delete')
  async deleteMember(@Req() req: Request, @Res() res: Response, @Param('id') memberIdParam: string) {
    const id = await this.book(req, res);
    if (id === null) return;
    const memberId = parseBigId(memberIdParam);
    if (!memberId) return notFound(res);
    const removed = await this.household.deleteMember(id, memberId);
    if (!removed) return notFound(res, 'Không tìm thấy thành viên trong sổ này');
    return this.backTo(res, id, 'cai-dat', { msg: 'Đã xoá thành viên (khoản chi cũ chuyển thành chi chung)' });
  }

  // ─── Thu nhập & phân bổ ───
  @Post('/household/income')
  async addIncome(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, string>) {
    const id = await this.book(req, res);
    if (id === null) return;
    const month = await this.household.addIncome(id, body);
    return this.backTo(res, id, 'thu-nhap', { month });
  }

  @Post('/household/income/:id/delete')
  async deleteIncome(@Req() req: Request, @Res() res: Response, @Param('id') incomeIdParam: string) {
    const id = await this.book(req, res);
    if (id === null) return;
    const incomeId = parseBigId(incomeIdParam);
    if (!incomeId) return notFound(res);
    const month = await this.household.deleteIncome(id, incomeId);
    return this.backTo(res, id, 'thu-nhap', { month });
  }

  @Post('/household/allocations')
  async addAllocation(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, string>) {
    const id = await this.book(req, res);
    if (id === null) return;
    const month = await this.household.addAllocation(id, body);
    return this.backTo(res, id, 'thu-nhap', { month });
  }

  @Post('/household/allocations/:id/delete')
  async deleteAllocation(@Req() req: Request, @Res() res: Response, @Param('id') allocationIdParam: string) {
    const id = await this.book(req, res);
    if (id === null) return;
    const allocationId = parseBigId(allocationIdParam);
    if (!allocationId) return notFound(res);
    const month = await this.household.deleteAllocation(id, allocationId);
    return this.backTo(res, id, 'thu-nhap', { month });
  }

  @Post('/household/allocations/copy')
  async copyAllocations(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, string>) {
    const id = await this.book(req, res);
    if (id === null) return;
    const { month, copied } = await this.household.copyAllocationsFromPreviousMonth(id, body.month);
    const note = copied ? `Đã chép ${copied} khoản từ tháng trước` : 'Tháng trước không có khoản nào mới để chép';
    return this.backTo(res, id, 'thu-nhap', { month, ...(copied ? { msg: note } : { err: note }) });
  }

  // ─── Chi tiêu ───
  @Post('/household/txns')
  async addTxn(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, string>) {
    const id = await this.book(req, res);
    if (id === null) return;
    await this.household.addTxn(id, body);
    return this.backTo(res, id, 'chi-tieu');
  }

  @Post('/household/txns/:id/delete')
  async deleteTxn(@Req() req: Request, @Res() res: Response, @Param('id') txnIdParam: string) {
    const id = await this.book(req, res);
    if (id === null) return;
    const txnId = parseBigId(txnIdParam);
    if (!txnId) return notFound(res);
    const removed = await this.household.deleteTxn(id, txnId);
    if (!removed) return notFound(res, 'Không tìm thấy khoản chi trong sổ này');
    return this.backTo(res, id, 'chi-tieu');
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
    const query = new URLSearchParams({ book: String(bookId), ...params });
    return res.redirect(`/household/${section}?${query.toString()}`);
  }
}

function user(req: Request): CurrentUser {
  return req.session.user!;
}

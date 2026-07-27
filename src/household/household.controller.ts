import { Body, Controller, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { notFound, parseBigId } from '../common/controller-utils';
import { AdminOnly, FeatureAccess } from '../common/feature.decorator';
import { FeatureGuard } from '../common/feature.guard';
import { render } from '../common/view';
import { HouseholdService } from './household.service';

const SECTIONS = ['tong-quan', 'thu-nhap', 'chi-tieu', 'cai-dat'];

/**
 * Module Quản Lý Chi Tiêu — CHỈ dành cho admin (tài chính riêng của gia đình).
 * Gác quyền như các module quản trị khác: cần feature HOUSEHOLD + là admin.
 */
@Controller()
@UseGuards(FeatureGuard)
@FeatureAccess('HOUSEHOLD')
@AdminOnly()
export class HouseholdController {
  constructor(private readonly household: HouseholdService) {}

  @Get(['/household', '/household/:section'])
  async index(
    @Res() res: Response,
    @Param('section') section?: string,
    @Query('month') month?: string,
    @Query('msg') msg?: string,
    @Query('err') err?: string,
  ) {
    const active = SECTIONS.includes(String(section)) ? String(section) : 'tong-quan';
    const [config, summary, members, txns, book] = await Promise.all([
      this.household.getConfig(),
      this.household.summary(),
      this.household.listMembers(),
      this.household.listTxns(),
      this.household.monthBook(month),
    ]);
    return render(res, 'household/index', {
      section: active,
      config,
      summary,
      members,
      txns,
      book,
      msg: String(msg || ''),
      err: String(err || ''),
    });
  }

  @Post('/household/config')
  async saveConfig(@Res() res: Response, @Body() body: Record<string, string>) {
    await this.household.updateConfig(body);
    return res.redirect('/household/cai-dat?msg=' + encodeURIComponent('Đã lưu cài đặt'));
  }

  // ─── Thành viên ───
  @Post('/household/members')
  async addMember(@Res() res: Response, @Body() body: Record<string, string>) {
    await this.household.addMember(body);
    return res.redirect('/household/cai-dat');
  }

  @Post('/household/members/:id')
  async updateMember(@Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string>) {
    const memberId = parseBigId(id);
    if (!memberId) return notFound(res);
    await this.household.updateMember(memberId, body);
    return res.redirect('/household/cai-dat?msg=' + encodeURIComponent('Đã lưu thành viên'));
  }

  @Post('/household/members/:id/delete')
  async deleteMember(@Res() res: Response, @Param('id') id: string) {
    const memberId = parseBigId(id);
    if (!memberId) return notFound(res);
    await this.household.deleteMember(memberId);
    return res.redirect('/household/cai-dat?msg=' + encodeURIComponent('Đã xoá thành viên (khoản chi cũ chuyển thành chi chung)'));
  }

  // ─── Thu nhập & phân bổ ───
  @Post('/household/income')
  async addIncome(@Res() res: Response, @Body() body: Record<string, string>) {
    const month = await this.household.addIncome(body);
    return res.redirect(`/household/thu-nhap?month=${month}`);
  }

  @Post('/household/income/:id/delete')
  async deleteIncome(@Res() res: Response, @Param('id') id: string) {
    const incomeId = parseBigId(id);
    if (!incomeId) return notFound(res);
    const month = await this.household.deleteIncome(incomeId);
    return res.redirect(`/household/thu-nhap?month=${month}`);
  }

  @Post('/household/allocations')
  async addAllocation(@Res() res: Response, @Body() body: Record<string, string>) {
    const month = await this.household.addAllocation(body);
    return res.redirect(`/household/thu-nhap?month=${month}`);
  }

  @Post('/household/allocations/:id/delete')
  async deleteAllocation(@Res() res: Response, @Param('id') id: string) {
    const allocationId = parseBigId(id);
    if (!allocationId) return notFound(res);
    const month = await this.household.deleteAllocation(allocationId);
    return res.redirect(`/household/thu-nhap?month=${month}`);
  }

  @Post('/household/allocations/copy')
  async copyAllocations(@Res() res: Response, @Body() body: Record<string, string>) {
    const { month, copied } = await this.household.copyAllocationsFromPreviousMonth(body.month);
    const note = copied ? `Đã chép ${copied} khoản từ tháng trước` : 'Tháng trước không có khoản nào mới để chép';
    return res.redirect(`/household/thu-nhap?month=${month}&${copied ? 'msg' : 'err'}=${encodeURIComponent(note)}`);
  }

  // ─── Chi tiêu ───
  @Post('/household/txns')
  async addTxn(@Res() res: Response, @Body() body: Record<string, string>) {
    await this.household.addTxn(body);
    return res.redirect('/household/chi-tieu');
  }

  @Post('/household/txns/:id/delete')
  async deleteTxn(@Res() res: Response, @Param('id') id: string) {
    const txnId = parseBigId(id);
    if (!txnId) return notFound(res);
    await this.household.deleteTxn(txnId);
    return res.redirect('/household/chi-tieu');
  }
}

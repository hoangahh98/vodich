import { Body, Controller, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { notFound, parseBigId } from '../common/controller-utils';
import { AdminOnly, FeatureAccess } from '../common/feature.decorator';
import { FeatureGuard } from '../common/feature.guard';
import { render } from '../common/view';
import { HouseholdEmailService } from './household-email.service';
import { HouseholdService } from './household.service';

/**
 * Module Quản Lý Chi Tiêu — CHỈ dành cho admin (tài chính riêng của gia đình).
 * Gác quyền như các module quản trị khác: cần feature HOUSEHOLD + là admin.
 */
@Controller()
@UseGuards(FeatureGuard)
@FeatureAccess('HOUSEHOLD')
@AdminOnly()
export class HouseholdController {
  constructor(
    private readonly household: HouseholdService,
    private readonly email: HouseholdEmailService,
  ) {}

  @Get('/household')
  async index(@Res() res: Response, @Query('msg') msg?: string, @Query('err') err?: string) {
    const [config, summary, txns, accounts, savings, pendingNotes] = await Promise.all([
      this.household.getConfig(),
      this.household.summary(),
      this.household.listTxns(),
      this.household.listAccounts(),
      this.household.listSavingsEntries(),
      this.household.pendingNoteEntries(),
    ]);
    return render(res, 'household/index', {
      config,
      summary,
      txns,
      accounts,
      savings,
      pendingNotes,
      emailConfigured: this.email.isConfigured(),
      mailbox: this.email.mailbox(),
      msg: String(msg || ''),
      err: String(err || ''),
    });
  }

  @Post('/household/scan')
  async scan(@Res() res: Response) {
    const result = await this.email.scan();
    const key = result.ok ? 'msg' : 'err';
    return res.redirect(`/household?${key}=${encodeURIComponent(result.message)}`);
  }

  @Post('/household/config')
  async saveConfig(@Res() res: Response, @Body() body: Record<string, string>) {
    await this.household.updateConfig(body);
    return res.redirect('/household?msg=' + encodeURIComponent('Đã lưu cấu hình'));
  }

  @Post('/household/accounts')
  async addAccount(@Res() res: Response, @Body() body: Record<string, string>) {
    await this.household.addAccount(body);
    return res.redirect('/household');
  }

  @Post('/household/accounts/:id/delete')
  async deleteAccount(@Res() res: Response, @Param('id') id: string) {
    const accId = parseBigId(id);
    if (!accId) return notFound(res);
    await this.household.deleteAccount(accId);
    return res.redirect('/household');
  }

  @Post('/household/txns/:id/category')
  async setCategory(@Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string>) {
    const txnId = parseBigId(id);
    if (!txnId) return notFound(res);
    await this.household.setTxnCategory(txnId, body.category, body.note);
    return res.redirect('/household');
  }

  @Post('/household/savings/:id/note')
  async noteSavings(@Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string>) {
    const entryId = parseBigId(id);
    if (!entryId) return notFound(res);
    if (!String(body.note || '').trim()) {
      return res.redirect('/household?err=' + encodeURIComponent('Cần nhập lý do lẹm tiết kiệm'));
    }
    await this.household.acknowledgeSavings(entryId, body.note);
    return res.redirect('/household?msg=' + encodeURIComponent('Đã ghi chú khoản lẹm tiết kiệm'));
  }

  @Post('/household/savings/adjust')
  async adjustSavings(@Res() res: Response, @Body() body: Record<string, string>) {
    await this.household.adjustSavings(body);
    return res.redirect('/household');
  }
}

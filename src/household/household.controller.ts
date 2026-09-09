import { Body, Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { forbidden, idList, notFound, parseBigId, safeHouseholdSection } from '../common/controller-utils';
import { AdminOnly, FeatureAccess } from '../common/feature.decorator';
import { render } from '../common/view';
import { HouseholdConfigService } from './household-config.service';
import { HOUSEHOLD_LABELS, normalizeMonth } from './household-enums';
import { HouseholdLedgerService } from './household-ledger.service';
import { HouseholdService } from './household.service';

type Form = Record<string, string | undefined>;

/**
 * Chi tiêu gia đình. Controller chỉ routing/kiểm quyền/redirect; nghiệp vụ ở ba service:
 * HouseholdService (hộ, quyền), HouseholdConfigService (nguồn/mục đích/định kỳ),
 * HouseholdLedgerService (giao dịch). Mọi route ghi đều @AdminOnly + canManage.
 */
@Controller()
@FeatureAccess('HOUSEHOLD')
export class HouseholdController {
  constructor(
    private readonly households: HouseholdService,
    private readonly config: HouseholdConfigService,
    private readonly ledger: HouseholdLedgerService,
  ) {}

  @Get('/household')
  async index(@Req() req: Request, @Res() res: Response) {
    const households = await this.households.list(req.session.user!);
    return render(res, 'household/index', { households });
  }

  @Post('/household')
  @AdminOnly()
  async create(@Req() req: Request, @Res() res: Response, @Body() body: Form) {
    const household = await this.households.create(req.session.user!, String(body.name || ''), body.description);
    req.session.flash = 'Đã tạo hộ. Khai nguồn tiền trước, rồi liên kết Telegram ở Cài đặt.';
    return res.redirect(`/household/${household.id}/sources`);
  }

  @Get('/household/:id')
  redirectDetail(@Req() req: Request, @Res() res: Response, @Param('id') id: string) {
    const query = req.query.month ? `?month=${req.query.month}` : '';
    return res.redirect(`/household/${id}/overview${query}`);
  }

  @Get('/household/:id/:section')
  async detail(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Param('section') section: string) {
    const householdId = parseBigId(id);
    if (!householdId) return notFound(res);
    const user = req.session.user!;
    if (!(await this.households.canView(user, householdId))) return forbidden(res);
    const safeSection = safeHouseholdSection(section);
    if (user.role !== 'ADMIN' && safeSection === 'settings') return res.redirect(`/household/${id}/overview`);
    const detail = await this.households.detail(householdId, req.query.month);
    const linkCode = user.role === 'ADMIN' && safeSection === 'settings' && !detail.linked ? await this.households.ensureLinkCode(householdId) : '';
    return render(res, 'household/detail', { ...detail, section: safeSection, linkCode, labels: HOUSEHOLD_LABELS });
  }

  // ───────────────────────────── Hộ, quyền, thành viên ─────────────────────────────

  @Post('/household/:id/settings')
  @AdminOnly()
  async updateSettings(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Form) {
    const householdId = await this.manageable(req, res, id);
    if (!householdId) return;
    await this.households.update(householdId, String(body.name || ''), body.description);
    return res.redirect(`/household/${id}/settings`);
  }

  @Post('/household/:id/delete')
  @AdminOnly()
  async delete(@Req() req: Request, @Res() res: Response, @Param('id') id: string) {
    const householdId = await this.manageable(req, res, id);
    if (!householdId) return;
    await this.households.delete(householdId);
    return res.redirect('/household');
  }

  @Post('/household/:id/permissions')
  @AdminOnly()
  async addPermission(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body('adminId') adminId: string) {
    const householdId = await this.manageable(req, res, id);
    if (!householdId) return;
    const admin = parseBigId(adminId);
    if (admin) await this.households.addPermission(householdId, admin);
    return res.redirect(`/household/${id}/settings`);
  }

  @Post('/household/:id/permissions/:permissionId/delete')
  @AdminOnly()
  async removePermission(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Param('permissionId') permissionId: string) {
    const householdId = await this.manageable(req, res, id);
    if (!householdId) return;
    const permission = parseBigId(permissionId);
    if (permission) await this.households.removePermission(householdId, permission);
    return res.redirect(`/household/${id}/settings`);
  }

  @Post('/household/:id/members')
  @AdminOnly()
  async addMembers(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string | string[]>) {
    const householdId = await this.manageable(req, res, id);
    if (!householdId) return;
    await this.households.addMembers(req.session.user!, householdId, idList(body.playerIds));
    return res.redirect(`/household/${id}/settings`);
  }

  @Post('/household/:id/members/:accessId/delete')
  @AdminOnly()
  async removeMember(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Param('accessId') accessId: string) {
    const householdId = await this.manageable(req, res, id);
    if (!householdId) return;
    const access = parseBigId(accessId);
    if (access) await this.households.removeMember(householdId, access);
    return res.redirect(`/household/${id}/settings`);
  }

  @Post('/household/:id/telegram/unlink')
  @AdminOnly()
  async unlinkTelegram(@Req() req: Request, @Res() res: Response, @Param('id') id: string) {
    const householdId = await this.manageable(req, res, id);
    if (!householdId) return;
    await this.households.unlinkTelegram(householdId);
    return res.redirect(`/household/${id}/settings`);
  }

  // ───────────────────────────── Nguồn tiền ─────────────────────────────

  @Post('/household/:id/sources')
  @AdminOnly()
  async createSource(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Form) {
    const householdId = await this.manageable(req, res, id);
    if (!householdId) return;
    await this.config.createSource(householdId, body);
    return res.redirect(`/household/${id}/sources`);
  }

  @Post('/household/:id/sources/:sourceId')
  @AdminOnly()
  async updateSource(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Param('sourceId') sourceId: string, @Body() body: Form) {
    const householdId = await this.manageable(req, res, id);
    if (!householdId) return;
    const source = parseBigId(sourceId);
    if (source) await this.config.updateSource(householdId, source, body);
    return res.redirect(`/household/${id}/sources`);
  }

  @Post('/household/:id/sources/:sourceId/delete')
  @AdminOnly()
  async deleteSource(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Param('sourceId') sourceId: string) {
    const householdId = await this.manageable(req, res, id);
    if (!householdId) return;
    const source = parseBigId(sourceId);
    if (source) await this.config.deleteSource(householdId, source);
    return res.redirect(`/household/${id}/sources`);
  }

  // ───────────────────────────── Mục đích ─────────────────────────────

  @Post('/household/:id/purposes')
  @AdminOnly()
  async createPurpose(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Form) {
    const householdId = await this.manageable(req, res, id);
    if (!householdId) return;
    await this.config.createPurpose(householdId, body);
    return res.redirect(`/household/${id}/settings`);
  }

  @Post('/household/:id/purposes/:purposeId')
  @AdminOnly()
  async updatePurpose(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Param('purposeId') purposeId: string, @Body() body: Form) {
    const householdId = await this.manageable(req, res, id);
    if (!householdId) return;
    const purpose = parseBigId(purposeId);
    if (purpose) await this.config.updatePurpose(householdId, purpose, body);
    return res.redirect(`/household/${id}/settings`);
  }

  @Post('/household/:id/purposes/:purposeId/delete')
  @AdminOnly()
  async deletePurpose(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Param('purposeId') purposeId: string) {
    const householdId = await this.manageable(req, res, id);
    if (!householdId) return;
    const purpose = parseBigId(purposeId);
    if (purpose) await this.config.deletePurpose(householdId, purpose);
    return res.redirect(`/household/${id}/settings`);
  }

  // ───────────────────────────── Khoản định kỳ ─────────────────────────────

  @Post('/household/:id/recurring')
  @AdminOnly()
  async createRecurring(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Form) {
    const householdId = await this.manageable(req, res, id);
    if (!householdId) return;
    await this.config.createRecurring(householdId, body);
    return res.redirect(`/household/${id}/recurring?month=${normalizeMonth(body.month)}`);
  }

  @Post('/household/:id/recurring/:recurringId')
  @AdminOnly()
  async updateRecurring(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Param('recurringId') recurringId: string, @Body() body: Form) {
    const householdId = await this.manageable(req, res, id);
    if (!householdId) return;
    const recurring = parseBigId(recurringId);
    if (recurring) await this.config.updateRecurring(householdId, recurring, body);
    return res.redirect(`/household/${id}/recurring?month=${normalizeMonth(body.month)}`);
  }

  @Post('/household/:id/recurring/:recurringId/delete')
  @AdminOnly()
  async deleteRecurring(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Param('recurringId') recurringId: string, @Body() body: Form) {
    const householdId = await this.manageable(req, res, id);
    if (!householdId) return;
    const recurring = parseBigId(recurringId);
    if (recurring) await this.config.deleteRecurring(householdId, recurring);
    return res.redirect(`/household/${id}/recurring?month=${normalizeMonth(body.month)}`);
  }

  /** Nút "Ghi nhận" trên dòng định kỳ dự kiến: tạo giao dịch đúng số dự kiến của tháng đang xem. */
  @Post('/household/:id/recurring/:recurringId/record')
  @AdminOnly()
  async recordRecurring(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Param('recurringId') recurringId: string, @Body() body: Form) {
    const householdId = await this.manageable(req, res, id);
    if (!householdId) return;
    const recurring = parseBigId(recurringId);
    const month = normalizeMonth(body.month);
    if (recurring) await this.ledger.recordExpectation(householdId, recurring, month);
    return res.redirect(`/household/${id}/recurring?month=${month}`);
  }

  // ───────────────────────────── Giao dịch ─────────────────────────────

  @Post('/household/:id/transactions')
  @AdminOnly()
  async createTransaction(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Form) {
    const householdId = await this.manageable(req, res, id);
    if (!householdId) return;
    const result = await this.ledger.createFromForm(householdId, body);
    if (!result) req.session.flash = 'Chưa chọn nguồn tiền.';
    else if (result.matched) req.session.flash = `Đã khớp khoản định kỳ "${result.matched.recurring.name}".`;
    return res.redirect(`/household/${id}/transactions?month=${result ? result.transaction.month : normalizeMonth(body.month)}`);
  }

  @Post('/household/:id/transactions/:txId')
  @AdminOnly()
  async updateTransaction(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Param('txId') txId: string, @Body() body: Form) {
    const householdId = await this.manageable(req, res, id);
    if (!householdId) return;
    const transaction = parseBigId(txId);
    if (transaction) await this.ledger.update(householdId, transaction, body);
    return res.redirect(`/household/${id}/transactions?month=${normalizeMonth(body.month)}`);
  }

  /** Ô chọn mục đích ngay trong bảng (data-autosubmit). */
  @Post('/household/:id/transactions/:txId/purpose')
  @AdminOnly()
  async setPurpose(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Param('txId') txId: string, @Body() body: Form) {
    const householdId = await this.manageable(req, res, id);
    if (!householdId) return;
    const transaction = parseBigId(txId);
    if (transaction) await this.ledger.setPurpose(householdId, transaction, await this.config.ownPurposeId(householdId, body.purposeId));
    return res.redirect(`/household/${id}/${body.section === 'overview' ? 'overview' : 'transactions'}?month=${normalizeMonth(body.month)}`);
  }

  @Post('/household/:id/transactions/:txId/delete')
  @AdminOnly()
  async deleteTransaction(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Param('txId') txId: string, @Body() body: Form) {
    const householdId = await this.manageable(req, res, id);
    if (!householdId) return;
    const transaction = parseBigId(txId);
    if (transaction) await this.ledger.delete(householdId, transaction);
    return res.redirect(`/household/${id}/transactions?month=${normalizeMonth(body.month)}`);
  }

  /** Id hộ hợp lệ và người này quản lý được; không thì đã trả 404/403 và trả về null. */
  private async manageable(req: Request, res: Response, id: string): Promise<bigint | null> {
    const householdId = parseBigId(id);
    if (!householdId) {
      notFound(res);
      return null;
    }
    if (!(await this.households.canManage(req.session.user!, householdId))) {
      forbidden(res);
      return null;
    }
    return householdId;
  }
}

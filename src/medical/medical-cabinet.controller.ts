import { Body, Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { notFound, parseBigId } from '../common/controller-utils';
import { FeatureAccess } from '../common/feature.decorator';
import { RateLimitService } from '../common/rate-limit.service';
import { render } from '../common/view';
import { CabinetService } from './cabinet.service';
import { currentUser, todayInVietnam } from './medical-controller-utils';
import { MedicalAiService } from './medical-ai.service';
import { MedicalService } from './medical.service';

/** Tủ thuốc ở nhà: thuốc còn thừa sau mỗi đợt, dùng để soát trước khi mua thêm. */
@Controller()
@FeatureAccess('MEDICAL')
export class MedicalCabinetController {
  constructor(
    private readonly cabinet: CabinetService,
    private readonly medical: MedicalService,
    private readonly ai: MedicalAiService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Get('/medical/tu-thuoc')
  async cabinetPage(@Req() req: Request, @Res() res: Response, @Query('err') err?: string) {
    const user = currentUser(req);
    const items = await this.cabinet.list(user);
    // Tủ thuốc không gắn với người thân nào, nhưng menu y tế vẫn nên đủ mục. Nếu chỉ có
    // một người thân thì lấy luôn làm ngữ cảnh; nhiều người thì không đoán bừa.
    const patients = await this.medical.listPatients(user);
    const only = patients.length === 1 ? patients[0] : null;
    return render(res, 'medical/cabinet', {
      items,
      menuPatientId: only ? only.id.toString() : '',
      menuPrescriptionId: only?.prescriptions[0]?.id.toString() || '',
      today: todayInVietnam(),
      aiConfigured: this.ai.isConfigured(),
      aiError: String(err || ''),
    });
  }

  @Post('/medical/tu-thuoc')
  async cabinetCreate(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, string>) {
    await this.cabinet.create(currentUser(req), body);
    return res.redirect('/medical/tu-thuoc');
  }

  @Post('/medical/tu-thuoc/:id/edit')
  async cabinetUpdate(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string>) {
    const itemId = parseBigId(id);
    if (!itemId) return notFound(res);
    const updated = await this.cabinet.update(currentUser(req), itemId, body);
    if (!updated) return notFound(res);
    return res.redirect('/medical/tu-thuoc');
  }

  @Post('/medical/tu-thuoc/:id/delete')
  async cabinetDelete(@Req() req: Request, @Res() res: Response, @Param('id') id: string) {
    const itemId = parseBigId(id);
    if (!itemId) return notFound(res);
    if (!(await this.cabinet.remove(currentUser(req), itemId))) return notFound(res);
    return res.redirect('/medical/tu-thuoc');
  }

  /**
   * Sửa số lượng nhiều thuốc trong một lần bấm.
   * Tủ hay phải dọn cả loạt sau mỗi đợt ốm; bắt làm từng dòng là mấy chục lần bấm.
   *
   * Chỉ nhận số lượng, KHÔNG có ô tick bỏ: sửa về 0 đã là bỏ khỏi tủ rồi, thêm ô tick là
   * hai đường làm cùng một việc trên cùng một dòng.
   */
  @Post('/medical/tu-thuoc/hang-loat')
  async cabinetBulk(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, unknown>) {
    const quantities: Record<string, number> = {};
    for (const [key, raw] of Object.entries(body)) {
      if (!key.startsWith('qty_')) continue;
      const value = Math.round(Number(raw));
      if (Number.isFinite(value)) quantities[key.slice(4)] = Math.max(0, value);
    }
    await this.cabinet.bulkAdjust(currentUser(req), quantities);
    return res.redirect('/medical/tu-thuoc');
  }

  /** Nhờ AI ước lượng hạn cho những thuốc CHƯA điền hạn. */
  @Post('/medical/tu-thuoc/kiem-tra-han')
  async cabinetCheckExpiry(@Req() req: Request, @Res() res: Response) {
    const user = currentUser(req);
    const back = '/medical/tu-thuoc';
    if (!this.ai.isConfigured()) return res.redirect(`${back}?err=${encodeURIComponent('Chưa cấu hình AI trên server (GROQ_API_KEY)')}`);
    const limit = this.rateLimit.consume(`ai:cabinet:${req.ip || 'unknown'}`, { max: 10, windowMs: 60_000 });
    if (!limit.allowed) return res.redirect(`${back}?err=${encodeURIComponent(`Thao tác quá nhanh, thử lại sau ${limit.retryAfterSeconds}s`)}`);
    const items = await this.cabinet.list(user);
    // Chỉ hỏi AI những thuốc chưa có hạn thật; đã điền hạn thì không cần đoán.
    const pending = items.filter((item) => !item.expiryDate);
    if (!pending.length) return res.redirect(`${back}?err=${encodeURIComponent('Mọi thuốc đều đã có hạn dùng, không cần đoán')}`);
    try {
      const verdicts = await this.ai.assessExpiry(
        pending.map((item) => ({
          drugName: item.drugName,
          unit: item.unit,
          quantity: item.quantity,
          purchasedAt: item.purchasedAt ? item.purchasedAt.toISOString().slice(0, 10) : 'không rõ',
        })),
        todayInVietnam(),
      );
      for (const item of pending) {
        const verdict = verdicts.find((entry) => entry.drugName === item.drugName);
        if (!verdict) continue;
        const note = [verdict.estimatedExpiry ? `Ước lượng hạn: ${verdict.estimatedExpiry}` : '', verdict.advice]
          .filter(Boolean)
          .join('. ');
        await this.cabinet.saveExpiryVerdict(item.id, verdict.risk, note);
      }
    } catch (error) {
      return res.redirect(`${back}?err=${encodeURIComponent(error instanceof Error ? error.message : 'Ước lượng hạn thất bại')}`);
    }
    return res.redirect(back);
  }
}

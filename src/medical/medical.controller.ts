import { Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { forbidden, notFound, parseBigId } from '../common/controller-utils';
import { FeatureAccess } from '../common/feature.decorator';
import { FeatureGuard } from '../common/feature.guard';
import { render } from '../common/view';
import { CurrentUser } from '../types';
import { MedicalAiService } from './medical-ai.service';
import { MedicalService } from './medical.service';

@Controller()
@UseGuards(FeatureGuard)
@FeatureAccess('MEDICAL')
export class MedicalController {
  constructor(
    private readonly medical: MedicalService,
    private readonly ai: MedicalAiService,
  ) {}

  @Get('/medical')
  async index(@Res() res: Response) {
    const patients = await this.medical.listPatients();
    return render(res, 'medical/index', { patients });
  }

  @Post('/medical/patients')
  async createPatient(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, string>) {
    const patient = await this.medical.createPatient(req.session.user as CurrentUser, body);
    return res.redirect(`/medical/patients/${patient.id}`);
  }

  @Get('/medical/patients/:id')
  async patient(@Res() res: Response, @Param('id') id: string, @Query('err') err?: string) {
    const patientId = parseBigId(id);
    if (!patientId) return notFound(res);
    const patient = await this.medical.getPatient(patientId);
    if (!patient) return notFound(res);
    return render(res, 'medical/patient', {
      patient,
      aiConfigured: this.ai.isConfigured(),
      disclaimer: this.ai.disclaimer(),
      aiError: String(err || ''),
    });
  }

  @Post('/medical/patients/:id/edit')
  async editPatient(@Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string>) {
    const patientId = parseBigId(id);
    if (!patientId) return notFound(res);
    await this.medical.updatePatient(patientId, body);
    return res.redirect(`/medical/patients/${patientId}`);
  }

  @Post('/medical/patients/:id/delete')
  async deletePatient(@Res() res: Response, @Param('id') id: string) {
    const patientId = parseBigId(id);
    if (!patientId) return notFound(res);
    await this.medical.deletePatient(patientId);
    return res.redirect('/medical');
  }

  @Post('/medical/patients/:id/prescriptions')
  async addPrescription(@Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string>) {
    const patientId = parseBigId(id);
    if (!patientId) return notFound(res);
    const patient = await this.medical.getPatient(patientId);
    if (!patient) return notFound(res);
    const back = `/medical/patients/${patientId}`;
    if (!this.ai.isConfigured()) return res.redirect(`${back}?err=${encodeURIComponent('Chưa cấu hình GEMINI_API_KEY')}`);
    const image = parseImage(body.imageData, body.imageMime);
    if (!image) return res.redirect(`${back}?err=${encodeURIComponent('Cần chọn ảnh đơn thuốc')}`);
    try {
      const extracted = await this.ai.extractFromImage(image.data, image.mime);
      if (!extracted.items.length) return res.redirect(`${back}?err=${encodeURIComponent('AI không đọc được thuốc trong ảnh, thử ảnh rõ hơn')}`);
      const prescription = await this.medical.createPrescription(patientId, extracted, image);
      await this.runAnalysis(patientId, prescription.id);
    } catch (error) {
      return res.redirect(`${back}?err=${encodeURIComponent(error instanceof Error ? error.message : 'Xử lý đơn thất bại')}`);
    }
    return res.redirect(back);
  }

  @Post('/medical/prescriptions/:id/reanalyze')
  async reanalyze(@Res() res: Response, @Param('id') id: string) {
    const prescriptionId = parseBigId(id);
    if (!prescriptionId) return notFound(res);
    const prescription = await this.medical.getPrescription(prescriptionId);
    if (!prescription) return notFound(res);
    const back = `/medical/patients/${prescription.patientId}`;
    try {
      await this.runAnalysis(prescription.patientId, prescriptionId);
    } catch (error) {
      return res.redirect(`${back}?err=${encodeURIComponent(error instanceof Error ? error.message : 'Phân tích thất bại')}`);
    }
    return res.redirect(back);
  }

  @Post('/medical/prescriptions/:id/delete')
  async deletePrescription(@Res() res: Response, @Param('id') id: string) {
    const prescriptionId = parseBigId(id);
    if (!prescriptionId) return notFound(res);
    const prescription = await this.medical.getPrescription(prescriptionId);
    if (!prescription) return notFound(res);
    await this.medical.deletePrescription(prescriptionId);
    return res.redirect(`/medical/patients/${prescription.patientId}`);
  }

  @Get('/medical/prescriptions/:id/image')
  async image(@Res() res: Response, @Param('id') id: string) {
    const prescriptionId = parseBigId(id);
    if (!prescriptionId) return notFound(res);
    const prescription = await this.medical.getPrescription(prescriptionId);
    if (!prescription?.imageData) return notFound(res, 'Không có ảnh');
    const buffer = Buffer.from(prescription.imageData, 'base64');
    res.setHeader('Content-Type', prescription.imageMime || 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return res.send(buffer);
  }

  private async runAnalysis(patientId: bigint, prescriptionId: bigint) {
    const [prescription, patient, history] = await Promise.all([
      this.medical.getPrescription(prescriptionId),
      this.medical.getPatient(patientId),
      this.medical.historyForPatient(patientId, prescriptionId),
    ]);
    if (!prescription || !patient) return;
    const analysis = await this.ai.analyze(
      { name: patient.name, birthYear: patient.birthYear, gender: patient.gender, allergies: patient.allergies, conditions: patient.conditions },
      prescription.items.map((item) => ({
        drugName: item.drugName,
        isAntibiotic: item.isAntibiotic,
        dosage: item.dosage,
        frequency: item.frequency,
        duration: item.duration,
        note: item.note,
      })),
      history.map((entry) => ({
        date: entry.prescribedDate ? entry.prescribedDate.toISOString().slice(0, 10) : '',
        items: entry.items.map((item) => ({ drugName: item.drugName, isAntibiotic: item.isAntibiotic, duration: item.duration })),
      })),
    );
    await this.medical.saveAnalysis(prescriptionId, analysis.risk, analysis.summary);
  }
}

/** Tách base64 (bỏ tiền tố data:...;base64,) và giới hạn kích thước. */
function parseImage(raw?: string, mime?: string): { data: string; mime: string } | null {
  let value = String(raw || '').trim();
  if (!value) return null;
  let detectedMime = String(mime || '').trim();
  const match = value.match(/^data:(.+?);base64,(.*)$/s);
  if (match) {
    detectedMime = detectedMime || match[1];
    value = match[2];
  }
  if (!value || value.length > 12_000_000) return null;
  return { data: value, mime: detectedMime || 'image/jpeg' };
}

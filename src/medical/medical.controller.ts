import { Body, Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { notFound, parseBigId } from '../common/controller-utils';
import { FeatureAccess } from '../common/feature.decorator';
import { render } from '../common/view';
import { CurrentUser } from '../types';
import { currentUser, doseTimesOf, todayInVietnam, toScheduleItems } from './medical-controller-utils';
import { MedicalAiService } from './medical-ai.service';
import { MedicalScopeService } from './medical-scope.service';
import { MedicalService } from './medical.service';
import { buildSchedule, remainingFrom, safeStartSlot } from './medication-schedule';

/**
 * Hồ sơ người thân: danh sách, tạo/sửa/xoá, cấu hình giờ nhắc và phân quyền.
 *
 * Module y tế được chẻ theo LUỒNG NGƯỜI DÙNG, mỗi luồng một controller:
 * - MedicalController (file này) — hồ sơ người thân
 * - MedicalCabinetController      — tủ thuốc ở nhà
 * - MedicalPrescriptionController — chụp đơn, AI đọc, soát thuốc, gộp đơn cũ
 * - MedicalScheduleController     — lịch uống và file .ics
 *
 * Trước đây cả bốn nằm chung một file 962 dòng / 24 route: muốn sửa lịch uống thì phải
 * cuộn qua tủ thuốc và phân quyền, và mọi thay đổi đều đụng vào cùng một file.
 * Phần lấy dữ liệu theo id kèm kiểm quyền dùng chung qua MedicalScopeService.
 */
@Controller()
@FeatureAccess('MEDICAL')
export class MedicalController {
  constructor(
    private readonly medical: MedicalService,
    private readonly ai: MedicalAiService,
    private readonly scope: MedicalScopeService,
  ) {}

  @Get('/medical')
  async index(@Req() req: Request, @Res() res: Response) {
    const patients = await this.medical.listPatients(currentUser(req));
    const today = todayInVietnam();
    // Người thân nào đang có lịch đã chốt và CÒN cữ phải uống thì hiện luôn nút nạp
    // lịch ngoài danh sách. Uống hết liệu trình là nút tự biến mất.
    const activeSchedules = patients.map((patient) => {
      const prescription = patient.prescriptions[0];
      if (!prescription?.scheduleStart) return null;
      const startDate = prescription.scheduleStart.toISOString().slice(0, 10);
      const startSlot = safeStartSlot(prescription.scheduleSlot);
      const { groups } = buildSchedule(toScheduleItems(prescription.items), startDate, startSlot, doseTimesOf(patient));
      const remaining = remainingFrom(groups, today, '00:00');
      if (!remaining.length) return null;
      return {
        prescriptionId: prescription.id.toString(),
        remainingCount: remaining.length,
        lastDate: remaining[remaining.length - 1].date,
      };
    });
    return render(res, 'medical/index', { patients, activeSchedules });
  }

  @Post('/medical/patients')
  async createPatient(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, string>) {
    const patient = await this.medical.createPatient(req.session.user as CurrentUser, body);
    return res.redirect(`/medical/patients/${patient.id}`);
  }

  @Get('/medical/patients/:id')
  async patient(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Query('err') err?: string) {
    const patient = await this.scope.patient(req, res, id);
    if (!patient) return;
    return render(res, 'medical/patient', {
      patient,
      // Điều hướng nằm ở menu ba gạch, không dùng nút mũi tên trong trang.
      // Lịch nhắc trỏ vào đơn mới nhất (danh sách đã sắp giảm dần theo ngày kê).
      menuPatientId: patient.id.toString(),
      menuPrescriptionId: patient.prescriptions[0]?.id.toString() || '',
      // Chỉ chủ hồ sơ mới được cấp/thu quyền, người được cấp thì không.
      isOwner: patient.ownerAdminId?.toString() === currentUser(req).id.toString(),
      availableAdmins: await this.medical.availableAdmins(patient.id, patient.ownerAdminId),
      // CỐ Ý không đối chiếu tủ thuốc ở đây. Tồn kho nằm ngay dưới TỪNG DÒNG THUỐC trong
      // trang chi tiết đơn — đó mới là chỗ đang soát thuốc và đủ ngữ cảnh để nói "cần mua
      // thêm bao nhiêu". Nhắc lại ở đầu trang này chỉ là nhiễu.
      aiConfigured: this.ai.isConfigured(),
      aiError: String(err || ''),
    });
  }

  @Post('/medical/patients/:id/edit')
  async editPatient(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: Record<string, string>) {
    const patient = await this.scope.patient(req, res, id);
    if (!patient) return;
    await this.medical.updatePatient(patient.id, body);
    return res.redirect(`/medical/patients/${patient.id}/cau-hinh`);
  }

  @Post('/medical/patients/:id/delete')
  async deletePatient(@Req() req: Request, @Res() res: Response, @Param('id') id: string) {
    const patient = await this.scope.patient(req, res, id);
    if (!patient) return;
    await this.medical.deletePatient(patient.id);
    return res.redirect('/medical');
  }

  /** Trang cấu hình của một người thân: giờ nhắc, ai được xem, sửa/xóa hồ sơ. */
  @Get('/medical/patients/:id/cau-hinh')
  async patientSettings(@Req() req: Request, @Res() res: Response, @Param('id') id: string) {
    const patient = await this.scope.patient(req, res, id);
    if (!patient) return;
    return render(res, 'medical/settings', {
      patient,
      menuPatientId: patient.id.toString(),
      menuPrescriptionId: patient.prescriptions[0]?.id.toString() || '',
      isOwner: patient.ownerAdminId?.toString() === currentUser(req).id.toString(),
      availableAdmins: await this.medical.availableAdmins(patient.id, patient.ownerAdminId),
    });
  }

  /** Cho admin khác xem cùng hồ sơ này. Chỉ chủ hồ sơ được làm. */
  @Post('/medical/patients/:id/permissions')
  async addPermission(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body('adminId') adminId: string) {
    const patient = await this.scope.ownedPatient(req, res, id);
    if (!patient) return;
    const target = parseBigId(adminId);
    if (!target) return notFound(res);
    await this.medical.addPermission(patient.id, target);
    return res.redirect(`/medical/patients/${patient.id}/cau-hinh`);
  }

  @Post('/medical/patients/:patientId/permissions/:permissionId/delete')
  async removePermission(@Req() req: Request, @Res() res: Response, @Param('patientId') patientId: string, @Param('permissionId') permissionId: string) {
    const patient = await this.scope.ownedPatient(req, res, patientId);
    if (!patient) return;
    const permId = parseBigId(permissionId);
    if (!permId) return notFound(res);
    await this.medical.removePermission(patient.id, permId);
    return res.redirect(`/medical/patients/${patient.id}/cau-hinh`);
  }
}

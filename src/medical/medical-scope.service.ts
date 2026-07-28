import { Injectable } from '@nestjs/common';
import { Request, Response } from 'express';
import { forbidden, notFound, parseBigId } from '../common/controller-utils';
import { currentUser } from './medical-controller-utils';
import { MedicalService } from './medical.service';

/**
 * Cửa duy nhất để bốn controller y tế lấy hồ sơ / đơn thuốc theo id từ URL.
 *
 * Gom vào một chỗ vì đây là điểm dễ rò dữ liệu nhất của cả app: mọi route đều nhận id
 * thô từ người dùng, chỉ cần một handler quên kiểm quyền là lộ bệnh án nhà người khác.
 * Có một cửa thì chỉ cần đúng một chỗ làm đúng.
 *
 * Trả về null nghĩa là ĐÃ gửi response lỗi — controller chỉ cần `if (!x) return;`.
 */
@Injectable()
export class MedicalScopeService {
  constructor(private readonly medical: MedicalService) {}

  /**
   * Cố ý trả 404 chứ không 403 khi không có quyền: 403 sẽ tiết lộ rằng hồ sơ đó có tồn tại,
   * mà chỉ riêng việc "nhà đó có hồ sơ y tế" đã là thông tin không nên lộ.
   */
  async patient(req: Request, res: Response, idParam: string) {
    const patientId = parseBigId(idParam);
    if (!patientId) {
      notFound(res);
      return null;
    }
    const patient = await this.medical.getPatient(patientId, currentUser(req));
    if (!patient) {
      notFound(res);
      return null;
    }
    return patient;
  }

  /** Như patient() nhưng đòi đúng chủ hồ sơ — dùng cho việc cấp/thu quyền. */
  async ownedPatient(req: Request, res: Response, idParam: string) {
    const patient = await this.patient(req, res, idParam);
    if (!patient) return null;
    if (patient.ownerAdminId?.toString() !== currentUser(req).id.toString()) {
      forbidden(res, 'Chỉ người tạo hồ sơ mới được phân quyền');
      return null;
    }
    return patient;
  }

  async prescription(req: Request, res: Response, idParam: string) {
    const prescriptionId = parseBigId(idParam);
    if (!prescriptionId) {
      notFound(res);
      return null;
    }
    const prescription = await this.medical.getPrescription(prescriptionId, currentUser(req));
    if (!prescription) {
      notFound(res);
      return null;
    }
    return prescription;
  }
}

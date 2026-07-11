import { Injectable } from '@nestjs/common';
import { GeminiService } from '../common/gemini.service';

export interface ExtractedItem {
  drugName: string;
  isAntibiotic: boolean;
  dosage: string;
  frequency: string;
  duration: string;
  note: string;
}

export interface ExtractedPrescription {
  doctor: string;
  clinic: string;
  prescribedDate: string; // YYYY-MM-DD hoặc rỗng
  diagnosis: string;
  items: ExtractedItem[];
}

export interface SafetyAnalysis {
  risk: 'LOW' | 'MEDIUM' | 'HIGH';
  summary: string;
}

interface PatientContext {
  name: string;
  birthYear?: number | null;
  gender?: string | null;
  allergies?: string | null;
  conditions?: string | null;
}

interface HistoryEntry {
  date: string;
  items: Array<{ drugName: string; isAntibiotic: boolean; duration: string }>;
}

const MED_DISCLAIMER =
  'LƯU Ý QUAN TRỌNG: Đây là phân tích tham khảo bằng AI, KHÔNG thay thế tư vấn của bác sĩ/dược sĩ. Luôn hỏi ý kiến chuyên môn trước khi dùng, ngừng hay đổi thuốc.';

@Injectable()
export class MedicalAiService {
  constructor(private readonly gemini: GeminiService) {}

  isConfigured() {
    return this.gemini.isConfigured();
  }

  disclaimer() {
    return MED_DISCLAIMER;
  }

  /** Đọc ảnh đơn thuốc và trích xuất thông tin có cấu trúc. */
  async extractFromImage(imageBase64: string, mimeType: string): Promise<ExtractedPrescription> {
    const prompt = [
      'Bạn là dược sĩ đọc đơn thuốc trong ảnh. Trích xuất chính xác thông tin, trả về JSON đúng schema:',
      '{ "doctor": "", "clinic": "", "prescribedDate": "YYYY-MM-DD hoặc rỗng nếu không rõ", "diagnosis": "chẩn đoán nếu có",',
      '  "items": [ { "drugName": "tên thuốc (kèm hàm lượng nếu có)", "isAntibiotic": true/false, "dosage": "liều mỗi lần", "frequency": "số lần/ngày, cách dùng", "duration": "số ngày dùng", "note": "ghi chú" } ] }',
      'Quy tắc: liệt kê MỌI thuốc thấy trong đơn. isAntibiotic=true nếu là kháng sinh (amoxicillin, augmentin, cefixim, azithromycin, cephalexin...). Nếu ảnh mờ/không đọc được thì trả items rỗng. Chỉ trả JSON, không giải thích.',
    ].join('\n');
    const result = await this.gemini.generateJson<ExtractedPrescription>(prompt, {
      images: [{ mimeType, data: imageBase64 }],
      temperature: 0.1,
    });
    return {
      doctor: String(result.doctor || ''),
      clinic: String(result.clinic || ''),
      prescribedDate: String(result.prescribedDate || ''),
      diagnosis: String(result.diagnosis || ''),
      items: Array.isArray(result.items) ? result.items : [],
    };
  }

  /** Phân tích an toàn đơn mới dựa trên thông tin bệnh nhân + lịch sử đơn cũ. */
  async analyze(patient: PatientContext, currentItems: ExtractedItem[], history: HistoryEntry[]): Promise<SafetyAnalysis> {
    const age = patient.birthYear ? new Date().getFullYear() - patient.birthYear : null;
    const prompt = [
      'Bạn là dược sĩ lâm sàng thận trọng. Phân tích ĐỘ AN TOÀN của đơn thuốc MỚI dựa trên bối cảnh bệnh nhân và lịch sử đơn cũ.',
      `Bệnh nhân: ${patient.name}${age !== null ? `, ${age} tuổi` : ''}${patient.gender ? `, ${patient.gender}` : ''}.`,
      `Dị ứng: ${patient.allergies || 'không rõ'}. Bệnh nền: ${patient.conditions || 'không rõ'}.`,
      `Đơn MỚI: ${JSON.stringify(currentItems)}`,
      `Lịch sử đơn cũ (mới nhất trước): ${JSON.stringify(history)}`,
      'Hãy xét: (1) trùng/lặp hoạt chất; (2) kháng sinh: có đang dùng liên tiếp/lặp lại quá gần, đủ liệu trình chưa, nguy cơ kháng thuốc; (3) tương tác thuốc bất lợi; (4) chống chỉ định theo dị ứng/bệnh nền/độ tuổi (đặc biệt trẻ em); (5) tác dụng phụ đáng chú ý và dấu hiệu cần đi khám ngay.',
      'Trả về JSON: { "risk": "LOW|MEDIUM|HIGH", "summary": "phân tích bằng tiếng Việt, gạch đầu dòng ngắn gọn theo 5 mục trên, nêu rõ nếu KHÔNG có vấn đề" }.',
      `Bắt buộc kết thúc summary bằng đúng câu: "${MED_DISCLAIMER}". Chỉ trả JSON.`,
    ].join('\n');
    const result = await this.gemini.generateJson<SafetyAnalysis>(prompt, { temperature: 0.3 });
    const risk = ['LOW', 'MEDIUM', 'HIGH'].includes(result.risk) ? result.risk : 'MEDIUM';
    let summary = String(result.summary || '').trim();
    if (!summary.includes('KHÔNG thay thế')) summary = `${summary}\n\n${MED_DISCLAIMER}`;
    return { risk, summary };
  }
}

import { Injectable } from '@nestjs/common';
import { AiService } from '../common/ai.service';

export interface ExtractedItem {
  drugName: string;
  isAntibiotic: boolean;
  dosage: string;
  frequency: string;
  duration: string;
  note: string;
  // Dạng số/enum để lên lịch nhắc được; 0 nghĩa là đọc không ra, người dùng sẽ tự điền.
  timesPerDay: number;
  days: number;
  quantity: string;
  quantityCount: number;
  route: string;
  timing: string;
}

export interface ExtractedPrescription {
  doctor: string;
  clinic: string;
  prescribedDate: string; // YYYY-MM-DD hoặc rỗng
  diagnosis: string;
  items: ExtractedItem[];
}

/** Phần thông tin thuốc mà bước phân tích an toàn cần — không kéo theo field lên lịch. */
export type AnalyzeItem = Pick<ExtractedItem, 'drugName' | 'isAntibiotic' | 'dosage' | 'frequency' | 'duration' | 'note'>;

export interface ExpiryQuery {
  drugName: string;
  unit: string;
  quantity: number;
  /** Ngày mua (= ngày kê đơn), YYYY-MM-DD. */
  purchasedAt: string;
}

export interface ExpiryVerdict {
  drugName: string;
  /** OK = nhiều khả năng còn tốt, CHECK = phải xem vỏ, BO = nên bỏ. */
  risk: 'OK' | 'CHECK' | 'BO';
  estimatedExpiry: string;
  advice: string;
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

const ROUTES = ['UONG', 'NHO_MUI', 'KHI_DUNG', 'XIT', 'BOI', 'KHAC'];
const TIMINGS = ['SAU_AN', 'TRUOC_AN', 'TRUOC_NGU'];

/** AI hay trả số dạng chuỗi ("2 lần") hoặc enum lạ — ép về đúng kiểu trước khi vào DB. */
function normalizeItem(item: Partial<ExtractedItem>): ExtractedItem {
  const route = String(item.route || '').toUpperCase();
  const timing = String(item.timing || '').toUpperCase();
  return {
    drugName: String(item.drugName || ''),
    isAntibiotic: Boolean(item.isAntibiotic),
    dosage: String(item.dosage || ''),
    frequency: String(item.frequency || ''),
    duration: String(item.duration || ''),
    note: String(item.note || ''),
    // Chặn trên 6 lần/ngày và 90 ngày: quá ngưỡng này gần như chắc chắn AI đọc sai.
    timesPerDay: clampInt(item.timesPerDay, 0, 6),
    days: clampInt(item.days, 0, 90),
    quantity: String(item.quantity || '').slice(0, 80),
    quantityCount: clampInt(item.quantityCount, 0, 500),
    route: ROUTES.includes(route) ? route : '',
    timing: TIMINGS.includes(timing) ? timing : '',
  };
}

/**
 * Đơn không ghi số ngày nhưng có số lượng thì suy ra: 5 ống, ngày 2 lần = 2,5 ngày.
 * Chỉ áp dụng cho dạng đếm được từng liều (gói, ống, viên). Lọ/chai thì một lọ dùng
 * nhiều lần nên số lượng không nói lên số ngày -> để 0 cho người dùng tự điền.
 */
const COUNTABLE = /gói|ống|viên|vien|goi|ong/i;

export function inferDays(item: ExtractedItem): number {
  if (item.days > 0) return item.days;
  if (!item.timesPerDay || !item.quantityCount) return 0;
  if (!COUNTABLE.test(item.quantity)) return 0;
  // Làm tròn tới 0,5 ngày: nửa ngày là mức chi tiết nhất còn có nghĩa với cữ sáng/tối.
  return Math.round((item.quantityCount / item.timesPerDay) * 2) / 2;
}

function clampInt(value: unknown, min: number, max: number): number {
  const parsed = Math.round(Number(String(value ?? '').replace(/[^\d.]/g, '')));
  if (!Number.isFinite(parsed) || parsed < min) return min;
  return Math.min(parsed, max);
}

@Injectable()
export class MedicalAiService {
  constructor(private readonly ai: AiService) {}

  isConfigured() {
    return this.ai.isConfigured();
  }

  /** Đọc ảnh đơn thuốc và trích xuất thông tin có cấu trúc. */
  async extractFromImage(imageBase64: string, mimeType: string): Promise<ExtractedPrescription> {
    const prompt = [
      'Bạn là dược sĩ đọc đơn thuốc trong ảnh. Trích xuất chính xác thông tin, trả về JSON đúng schema:',
      '{ "doctor": "", "clinic": "", "prescribedDate": "YYYY-MM-DD hoặc rỗng nếu không rõ", "diagnosis": "chẩn đoán nếu có",',
      '  "items": [ { "drugName": "tên thuốc (kèm hàm lượng nếu có)", "isAntibiotic": true/false, "dosage": "liều mỗi lần, ví dụ 4ml hoặc 1 gói hoặc 2 giọt/bên",',
      '    "frequency": "nguyên văn cách dùng trong đơn", "duration": "nguyên văn số ngày trong đơn", "note": "ghi chú, lưu ý",',
      '    "timesPerDay": số_lần_dùng_mỗi_ngày_dạng_số, "days": số_ngày_dùng_dạng_số, "quantity": "tổng số lượng được cấp, ví dụ 10 gói",',
    '    "quantityCount": tổng_số_lượng_dạng_số (10 gói -> 10, 5 ống -> 5, 1 lọ -> 1),',
      '    "route": "UONG|NHO_MUI|KHI_DUNG|XIT|BOI|KHAC", "timing": "SAU_AN|TRUOC_AN|TRUOC_NGU hoặc rỗng" } ] }',
      'Quy tắc:',
      '- Liệt kê MỌI thuốc thấy trong đơn, kể cả thuốc bị gạch bỏ (người dùng sẽ tự quyết định bỏ sau).',
      '- isAntibiotic=true nếu là kháng sinh (amoxicillin, augmentin, cefixim, azithromycin, cephalexin, ciprofloxacin...).',
      '- timesPerDay và days BẮT BUỘC là số nguyên. Đọc không chắc thì để 0, TUYỆT ĐỐI không đoán bừa.',
      '- Đơn ghi khoảng (ví dụ "dùng 5-7 ngày") thì days lấy số NHỎ hơn (5) cho an toàn.',
      '- Nếu ảnh mờ/không đọc được thì trả items rỗng. Chỉ trả JSON, không giải thích.',
    ].join('\n');
    const result = await this.ai.generateJson<ExtractedPrescription>(prompt, {
      images: [{ mimeType, data: imageBase64 }],
      temperature: 0.1,
    });
    return {
      doctor: String(result.doctor || ''),
      clinic: String(result.clinic || ''),
      prescribedDate: String(result.prescribedDate || ''),
      diagnosis: String(result.diagnosis || ''),
      items: Array.isArray(result.items)
        ? result.items.map(normalizeItem).map((item) => ({ ...item, days: inferDays(item) }))
        : [],
    };
  }

  /**
   * Ước lượng hạn dùng cho thuốc tồn KHÔNG điền hạn.
   *
   * Chỉ dùng khi người dùng không nhập hạn thật trên vỏ. Bản chất là phỏng đoán: ngày
   * kê đơn KHÔNG phải ngày sản xuất, và thuốc lẻ cắt ra khỏi vỉ/hộp gốc thì mất luôn
   * thông tin hạn. Vì thế prompt bắt AI trả lời thiên về thận trọng và luôn nhắc kiểm
   * tra vỏ, không được khuyến khích dùng lại thuốc cũ một cách vô điều kiện.
   */
  async assessExpiry(items: ExpiryQuery[], today: string): Promise<ExpiryVerdict[]> {
    if (!items.length) return [];
    const prompt = [
      'Bạn là dược sĩ. Với mỗi thuốc còn tồn trong tủ thuốc gia đình dưới đây, hãy ước lượng thuốc còn dùng được không.',
      `Hôm nay là ${today}.`,
      JSON.stringify(items),
      'Với mỗi thuốc, xét: (1) dạng bào chế và hạn dùng thông thường của loại đó khi còn nguyên vỏ;',
      '(2) đã bao lâu kể từ ngày mua; (3) thuốc lẻ cắt khỏi vỉ/hộp gốc thì bảo quản kém hơn nhiều.',
      'Quy tắc bắt buộc:',
      '- Ngày mua KHÔNG phải ngày sản xuất, nên đây chỉ là ƯỚC LƯỢNG. Luôn thiên về thận trọng.',
      '- Kháng sinh còn thừa từ đợt trước: LUÔN khuyên không tự dùng lại mà phải hỏi bác sĩ.',
      '- risk="OK" nếu nhiều khả năng còn tốt, "CHECK" nếu cần xem kỹ vỏ/hạn, "BO" nếu nhiều khả năng nên bỏ.',
      'Trả về JSON: { "items": [ { "drugName": "đúng tên đã cho", "risk": "OK|CHECK|BO",',
      '  "estimatedExpiry": "MM/YYYY hoặc rỗng nếu không đoán được", "advice": "1-2 câu tiếng Việt, nói rõ có nên mua mới không" } ] }',
      'Chỉ trả JSON.',
    ].join('\n');
    const result = await this.ai.generateJson<{ items?: ExpiryVerdict[] }>(prompt, { temperature: 0.2 });
    const list = Array.isArray(result.items) ? result.items : [];
    return list.map((entry) => ({
      drugName: String(entry.drugName || ''),
      risk: ['OK', 'CHECK', 'BO'].includes(String(entry.risk)) ? (entry.risk as ExpiryVerdict['risk']) : 'CHECK',
      estimatedExpiry: String(entry.estimatedExpiry || ''),
      advice: String(entry.advice || ''),
    }));
  }

  /** Phân tích an toàn đơn mới dựa trên thông tin bệnh nhân + lịch sử đơn cũ. */
  async analyze(patient: PatientContext, currentItems: AnalyzeItem[], history: HistoryEntry[]): Promise<SafetyAnalysis> {
    const age = patient.birthYear ? new Date().getFullYear() - patient.birthYear : null;
    const prompt = [
      'Bạn là dược sĩ lâm sàng thận trọng. Phân tích ĐỘ AN TOÀN của đơn thuốc MỚI dựa trên bối cảnh bệnh nhân và lịch sử đơn cũ.',
      `Bệnh nhân: ${patient.name}${age !== null ? `, ${age} tuổi` : ''}${patient.gender ? `, ${patient.gender}` : ''}.`,
      `Dị ứng: ${patient.allergies || 'không rõ'}. Bệnh nền: ${patient.conditions || 'không rõ'}.`,
      `Đơn MỚI: ${JSON.stringify(currentItems)}`,
      `Lịch sử đơn cũ (mới nhất trước): ${JSON.stringify(history)}`,
      'Hãy xét: (1) trùng/lặp hoạt chất; (2) kháng sinh: có đang dùng liên tiếp/lặp lại quá gần, đủ liệu trình chưa, nguy cơ kháng thuốc; (3) tương tác thuốc bất lợi; (4) chống chỉ định theo dị ứng/bệnh nền/độ tuổi (đặc biệt trẻ em); (5) tác dụng phụ đáng chú ý và dấu hiệu cần đi khám ngay.',
      'Trả về JSON: { "risk": "LOW|MEDIUM|HIGH", "summary": "phân tích bằng tiếng Việt, gạch đầu dòng ngắn gọn theo 5 mục trên, nêu rõ nếu KHÔNG có vấn đề" }.',
      'Viết gọn, đi thẳng vào vấn đề, không thêm câu miễn trừ trách nhiệm. Chỉ trả JSON.',
    ].join('\n');
    const result = await this.ai.generateJson<SafetyAnalysis>(prompt, { temperature: 0.3 });
    const risk = ['LOW', 'MEDIUM', 'HIGH'].includes(result.risk) ? result.risk : 'MEDIUM';
    let summary = String(result.summary || '').trim();
    // Người dùng đã tắt câu lưu ý ở giao diện, nên cũng cắt nốt nếu model tự thêm vào.
    summary = summary.replace(/LƯU Ý QUAN TRỌNG:[\s\S]*$/i, '').trim();
    return { risk, summary };
  }
}

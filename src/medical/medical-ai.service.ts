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
  /** Thuốc dùng khi cần (hạ sốt khi sốt, khí dung khi khó thở) -> không lên lịch nhắc. */
  asNeeded: boolean;
  /** days được suy ra từ số lượng chứ không phải đơn ghi rõ. */
  daysFromQuantity: boolean;
}

export interface ExtractedPrescription {
  doctor: string;
  clinic: string;
  prescribedDate: string; // YYYY-MM-DD hoặc rỗng
  /** Ngày tái khám ghi trong đơn, YYYY-MM-DD hoặc rỗng. */
  followUpDate: string;
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

/**
 * Cảnh báo cho MỘT dòng thuốc cụ thể của đơn mới.
 *
 * `index` là vị trí trong mảng currentItems đã gửi lên, KHÔNG phải tên thuốc: đối chiếu
 * theo tên thì AI trả về "Augmentin 250" trong khi đơn ghi "Augmentin 250mg/31.25mg" là
 * mất cảnh báo mà không ai biết. Bắt echo lại số thứ tự thì hoặc khớp, hoặc bỏ hẳn.
 */
export interface ItemWarning {
  index: number;
  /** rỗng = không có gì đáng nói, CHECK = nên để ý, WARN = phải hỏi bác sĩ trước khi uống. */
  level: '' | 'CHECK' | 'WARN';
  reason: string;
}

export interface SafetyAnalysis {
  risk: 'LOW' | 'MEDIUM' | 'HIGH';
  summary: string;
  /** Chỉ chứa những dòng THẬT SỰ có vấn đề; thuốc không có gì thì không xuất hiện. */
  warnings: ItemWarning[];
}

/** Một thuốc còn tồn trong tủ, để AI xét chuyện uống trùng / uống lại thuốc cũ. */
export interface CabinetEntry {
  drugName: string;
  quantity: number;
  unit: string;
  /** YYYY-MM-DD hoặc rỗng nếu không rõ hạn. */
  expiryDate: string;
  expired: boolean;
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
  /** Đơn này còn đang chạy lịch uống hay không — thuốc đang uống dở nặng ký hơn đơn đã xong. */
  running?: boolean;
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
    asNeeded: resolveAsNeeded(item),
    daysFromQuantity: false,
  };
}

/**
 * Chỉ những triệu chứng cụ thể mới làm thuốc thành "dùng khi cần".
 *
 * KHÔNG tin mỗi cờ của AI. Đã có ca thật: đơn ghi "Khí dung ngày 2 lần mỗi lần 1 ống",
 * AI đọc nhầm thành "Khi dùng ngày 2 lần" rồi đánh dấu khi-cần, làm Budesonid — một
 * corticoid duy trì phải dùng đều — biến mất khỏi lịch nhắc mà không ai biết.
 *
 * "khí dung" là ĐƯỜNG DÙNG, không phải điều kiện. Nên ở đây đòi phải có triệu chứng
 * tường minh, và mặc định nghiêng về CÓ lịch: thừa một lời nhắc thì người dùng nhìn
 * thấy và bỏ qua, còn thiếu lời nhắc thì không ai phát hiện ra.
 */
const SYMPTOM_TRIGGER =
  /kh[ií]\s*c[âầ]n|khi\s*s[oố]t|n[eế]u\s*s[oố]t|khi\s*ho\b|khi\s*kh[oó]\s*th[ơở]|khi\s*đau|n[eế]u\s*đau|khi\s*n[oô]n|s[oố]t\s*(tr[eê]n|cao|>|≥)|l[eê]n\s*c[ơo]n|khi\s*ng[uạ]t/i;

export function resolveAsNeeded(item: Partial<ExtractedItem>): boolean {
  if (!item.asNeeded) return false;
  const text = [item.frequency, item.note, item.duration, item.dosage].filter(Boolean).join(' ');
  return SYMPTOM_TRIGGER.test(text);
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

/**
 * Lọc cảnh báo theo dòng của AI về dạng tin được.
 *
 * Vứt thẳng những mục không trỏ vào đúng một dòng thuốc có thật, hoặc không nói được lý
 * do. Cảnh báo trôi nổi không gắn được vào thuốc nào thì tệ hơn là không có: người dùng
 * thấy có chữ đỏ ở một dòng ngẫu nhiên rồi bỏ qua đúng dòng đáng lo.
 *
 * Mỗi dòng chỉ giữ MỘT cảnh báo, ưu tiên mức nặng hơn — hai ba dòng chữ đỏ chồng lên nhau
 * ở cùng một thuốc là mất tác dụng cảnh báo.
 */
export function normalizeWarnings(raw: unknown, itemCount: number): ItemWarning[] {
  if (!Array.isArray(raw)) return [];
  const byIndex = new Map<number, ItemWarning>();
  for (const entry of raw) {
    const index = Math.round(Number((entry as ItemWarning)?.index));
    if (!Number.isInteger(index) || index < 0 || index >= itemCount) continue;
    const level = String((entry as ItemWarning)?.level || '').toUpperCase();
    if (level !== 'CHECK' && level !== 'WARN') continue;
    const reason = String((entry as ItemWarning)?.reason || '').trim().slice(0, 400);
    if (!reason) continue;
    const existing = byIndex.get(index);
    if (existing && (existing.level === 'WARN' || level === existing.level)) continue;
    byIndex.set(index, { index, level, reason });
  }
  return [...byIndex.values()];
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
    '  "followUpDate": "ngày tái khám dạng YYYY-MM-DD nếu đơn có ghi (tái khám / hẹn khám lại), rỗng nếu không có",',
      '  "items": [ { "drugName": "tên thuốc (kèm hàm lượng nếu có)", "isAntibiotic": true/false, "dosage": "liều mỗi lần, ví dụ 4ml hoặc 1 gói hoặc 2 giọt/bên",',
      '    "frequency": "nguyên văn cách dùng trong đơn", "duration": "nguyên văn số ngày trong đơn", "note": "ghi chú, lưu ý",',
      '    "timesPerDay": số_lần_dùng_mỗi_ngày_dạng_số, "days": số_ngày_dùng_dạng_số, "quantity": "tổng số lượng được cấp, ví dụ 10 gói",',
    '    "quantityCount": tổng_số_lượng_dạng_số (10 gói -> 10, 5 ống -> 5, 1 lọ -> 1),',
      '    "route": "UONG|NHO_MUI|KHI_DUNG|XIT|BOI|KHAC", "timing": "SAU_AN|TRUOC_AN|TRUOC_NGU hoặc rỗng",',
    '    "asNeeded": true CHỈ KHI đơn ghi rõ một triệu chứng kích hoạt (khi sốt trên 38.5, khi khó thở, khi lên cơn, khi cần), ngược lại false } ] }',
      'Quy tắc:',
      '- Liệt kê MỌI thuốc thấy trong đơn, kể cả thuốc bị gạch bỏ (người dùng sẽ tự quyết định bỏ sau).',
      '- isAntibiotic=true nếu là kháng sinh (amoxicillin, augmentin, cefixim, azithromycin, cephalexin, ciprofloxacin...).',
      '- timesPerDay và days BẮT BUỘC là số nguyên. Đọc không chắc thì để 0, TUYỆT ĐỐI không đoán bừa.',
      '- Đơn ghi khoảng (ví dụ "dùng 5-7 ngày") thì days lấy số NHỎ hơn (5) cho an toàn.',
      '- CẢNH BÁO: "khí dung" là ĐƯỜNG DÙNG (route=KHI_DUNG), KHÔNG phải điều kiện. "Khí dung ngày 2 lần" là thuốc dùng ĐỀU ĐẶN -> asNeeded=false.',
      '- asNeeded=true chỉ khi có triệu chứng kích hoạt rõ ràng (hạ sốt khi sốt trên 38.5, xịt khi lên cơn khó thở). Đơn ghi số lần cố định mỗi ngày mà không kèm triệu chứng thì luôn là false.',
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
      followUpDate: String(result.followUpDate || ''),
      diagnosis: String(result.diagnosis || ''),
      items: Array.isArray(result.items)
        ? result.items.map(normalizeItem).map((item) => {
            const days = inferDays(item);
            return { ...item, days, daysFromQuantity: item.days === 0 && days > 0 };
          })
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

  /**
   * Phân tích an toàn đơn mới dựa trên bối cảnh bệnh nhân + đợt thuốc gần nhất + tủ thuốc.
   *
   * Trả về HAI mức: phần tóm tắt cả đơn (summary) và cảnh báo gắn vào TỪNG DÒNG THUỐC
   * (warnings). Phần theo dòng mới là phần chính — xem ItemWarning và cột aiWarnLevel
   * trong schema để biết vì sao không gộp hết vào summary.
   */
  async analyze(
    patient: PatientContext,
    currentItems: AnalyzeItem[],
    history: HistoryEntry[],
    cabinet: CabinetEntry[] = [],
  ): Promise<SafetyAnalysis> {
    const age = patient.birthYear ? new Date().getFullYear() - patient.birthYear : null;
    // Đánh số để AI trỏ ngược lại đúng dòng thuốc; xem ItemWarning.index.
    const numbered = currentItems.map((item, index) => ({ index, ...item }));
    const prompt = [
      'Bạn là dược sĩ lâm sàng thận trọng. Phân tích ĐỘ AN TOÀN của đơn thuốc MỚI dựa trên bối cảnh bệnh nhân, đợt thuốc gần nhất và thuốc còn trong tủ nhà.',
      `Bệnh nhân: ${patient.name}${age !== null ? `, ${age} tuổi` : ''}${patient.gender ? `, ${patient.gender}` : ''}.`,
      `Dị ứng: ${patient.allergies || 'không rõ'}. Bệnh nền: ${patient.conditions || 'không rõ'}.`,
      `Đơn MỚI (mỗi thuốc có "index" để trỏ ngược lại): ${JSON.stringify(numbered)}`,
      `Các đợt thuốc trước, MỚI NHẤT ĐỨNG ĐẦU ("running": true nghĩa là lịch uống vẫn đang chạy): ${JSON.stringify(history)}`,
      `Thuốc còn trong tủ thuốc nhà: ${cabinet.length ? JSON.stringify(cabinet) : 'tủ trống'}`,
      'Hãy xét: (1) trùng/lặp hoạt chất; (2) kháng sinh: có đang dùng liên tiếp/lặp lại quá gần, đủ liệu trình chưa, nguy cơ kháng thuốc; (3) tương tác thuốc bất lợi; (4) chống chỉ định theo dị ứng/bệnh nền/độ tuổi (đặc biệt trẻ em); (5) tác dụng phụ đáng chú ý và dấu hiệu cần đi khám ngay.',
      'Trả về JSON:',
      '{ "risk": "LOW|MEDIUM|HIGH",',
      '  "summary": "phân tích chung bằng tiếng Việt, gạch đầu dòng ngắn gọn theo 5 mục trên, nêu rõ nếu KHÔNG có vấn đề",',
      '  "warnings": [ { "index": số_thứ_tự_thuốc_trong_đơn_mới, "level": "CHECK|WARN", "reason": "1-2 câu tiếng Việt" } ] }',
      'Quy tắc cho "warnings" — phần này quan trọng nhất:',
      '- CHỈ liệt kê thuốc THẬT SỰ có vấn đề. Thuốc bình thường thì KHÔNG đưa vào mảng. Không có thuốc nào đáng nói thì trả mảng rỗng.',
      '- Phải có căn cứ CỤ THỂ: gọi tên hoạt chất trùng, tên nhóm kháng sinh, hoặc tên thuốc kia. Cấm cảnh báo chung chung kiểu "cần thận trọng khi dùng cho trẻ em".',
      '- Nói rõ vấn đề đến TỪ ĐÂU: từ chính đơn mới này, từ đợt thuốc gần nhất, hay từ thuốc còn trong tủ. Có ngày tháng thì ghi ngày.',
      '- level="WARN" khi phải hỏi lại bác sĩ/dược sĩ trước khi cho uống (trùng hoạt chất, hai kháng sinh cùng nhóm, tương tác có hại, chống chỉ định).',
      '- level="CHECK" khi chỉ nên để ý, theo dõi (tác dụng phụ đáng kể, nên uống cách xa nhau, thuốc trong tủ đã cũ).',
      '- Kháng sinh còn thừa trong tủ hoặc lặp lại quá gần đợt trước: LUÔN cảnh báo, tối thiểu là CHECK.',
      '- "index" bắt buộc là số đã cho trong đơn mới. Không chắc thuốc nào thì bỏ qua, đừng đoán số.',
      'Viết gọn, đi thẳng vào vấn đề, không thêm câu miễn trừ trách nhiệm. Chỉ trả JSON.',
    ].join('\n');
    const result = await this.ai.generateJson<SafetyAnalysis>(prompt, { temperature: 0.3 });
    const risk = ['LOW', 'MEDIUM', 'HIGH'].includes(result.risk) ? result.risk : 'MEDIUM';
    let summary = String(result.summary || '').trim();
    // Người dùng đã tắt câu lưu ý ở giao diện, nên cũng cắt nốt nếu model tự thêm vào.
    summary = summary.replace(/LƯU Ý QUAN TRỌNG:[\s\S]*$/i, '').trim();
    return { risk, summary, warnings: normalizeWarnings(result.warnings, currentItems.length) };
  }
}

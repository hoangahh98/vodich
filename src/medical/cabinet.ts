/**
 * Tủ thuốc: chuẩn hoá tên thuốc để đối chiếu, và tính số thuốc còn tồn khi ngừng đơn.
 *
 * Code thuần, không AI: việc đếm tồn phải ra kết quả giống hệt mỗi lần chạy. AI chỉ
 * dùng cho phần ước lượng hạn dùng (xem medical-ai.service).
 */

/** Đơn vị đếm được. Chai/lọ/siro cố ý KHÔNG nhận: mở nắp rồi thì đếm tồn vô nghĩa. */
const COUNTABLE_UNITS = ['gói', 'viên', 'ống', 'gói thuốc', 'vien', 'goi', 'ong'];

const UNIT_PATTERN = /(\d+(?:[.,]\d+)?)\s*(gói|goi|viên|vien|ống|ong)\b/i;

const UNIT_CANON: Record<string, string> = {
  goi: 'gói', 'gói': 'gói',
  vien: 'viên', 'viên': 'viên',
  ong: 'ống', 'ống': 'ống',
};

export interface ParsedQuantity {
  count: number;
  unit: string;
}

/** "10 Gói" -> {count:10, unit:'gói'}. Trả null cho chai/lọ hoặc không rõ. */
export function parseCountable(quantity: string): ParsedQuantity | null {
  const match = String(quantity || '').match(UNIT_PATTERN);
  if (!match) return null;
  const count = Math.round(Number(match[1].replace(',', '.')));
  if (!Number.isFinite(count) || count < 1) return null;
  return { count, unit: UNIT_CANON[match[2].toLowerCase()] || match[2].toLowerCase() };
}

export function isCountableUnit(unit: string): boolean {
  return COUNTABLE_UNITS.includes(String(unit || '').toLowerCase());
}

/**
 * Khoá đối chiếu tên thuốc.
 *
 * AI đọc mỗi lần một kiểu: "Montelukast 4mg (Pakast 4)", "Pakast 4", "Montelukast".
 * Không gom được thì tủ thuốc đầy dòng trùng và cảnh báo chẳng bao giờ khớp. Ở đây bỏ
 * dấu, bỏ hàm lượng và phần trong ngoặc, lấy từ đầu tiên còn lại làm khoá — đủ để gom
 * các biến thể của cùng hoạt chất. Không kỳ vọng đúng 100%, người dùng gộp tay được.
 */
export function matchKey(drugName: string): string {
  const noParen = String(drugName || '').replace(/\([^)]*\)/g, ' ');
  const plain = noParen
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase();
  const noDose = plain
    // bỏ hàm lượng: 4mg, 30mg/5ml, 0.03%, 1.33 %
    .replace(/\d+(?:[.,]\d+)?\s*(?:mg|mcg|g|ml|iu|%)(?:\s*\/\s*\d+(?:[.,]\d+)?\s*(?:mg|mcg|g|ml))?/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Lấy từ đầu tiên có nghĩa (>=4 ký tự) làm khoá; tên hoạt chất luôn đứng đầu.
  const words = noDose.split(' ').filter((w) => w.length >= 4);
  return words[0] || noDose || '';
}

export interface LeftoverInput {
  drugName: string;
  quantity: string;
  /** Tổng số liều đã lên lịch cho tới hôm nay (coi như đã uống). */
  dosesTaken: number;
}

export interface Leftover {
  drugName: string;
  matchKey: string;
  unit: string;
  quantity: number;
}

/**
 * Tính thuốc còn thừa khi ngừng giữa chừng.
 * Chỉ trả về thứ đếm được và còn ít nhất 1 đơn vị.
 */
export function leftoverOf(input: LeftoverInput): Leftover | null {
  const parsed = parseCountable(input.quantity);
  if (!parsed) return null;
  const left = parsed.count - Math.max(0, Math.round(input.dosesTaken));
  if (left < 1) return null;
  return { drugName: input.drugName, matchKey: matchKey(input.drugName), unit: parsed.unit, quantity: left };
}

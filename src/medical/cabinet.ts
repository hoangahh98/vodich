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
 * Khoá đối chiếu tên thuốc: giữ NGUYÊN cả tên, chỉ bỏ dấu và mọi ký tự không phải chữ/số.
 *
 *   "Montelukast 4mg (Pakaat 4)"  ->  "montelukast4mgpakaat4"
 *
 * CỐ Ý KHẮT KHE. Bản trước rút gọn còn TỪ ĐẦU TIÊN (bỏ ngoặc, bỏ hàm lượng) cho dễ khớp,
 * nhưng đã kiểm chứng là báo nhầm hàng loạt:
 *
 *   Vitamin D3            = Vitamin C 500mg          (đều ra "vitamin")
 *   Natri clorid 0.9%     = Natri bicarbonat         (đều ra "natri")
 *   Paracetamol 250mg     = Paracetamol 500mg        (đều ra "paracetamol")
 *   Terbutaline+Guaifenesin = Terbutaline+Bromhexin  (đều ra "terbutaline")
 *
 * Với thuốc trẻ con thì BÁO NHẦM NGUY HIỂM HƠN BỎ SÓT: bỏ sót thì cùng lắm mua trùng,
 * tốn tiền; báo nhầm thì không mua thứ đang cần, hoặc lấy nhầm thuốc khác hàm lượng.
 *
 * Cái giá đã biết và chấp nhận: AI đọc tên lệch một chữ là mất khớp hoàn toàn
 * ("Pakaat 4 (Montelukast 4mg)" không khớp "Montelukast 4mg (Pakaat 4)"). Gợi ý sẽ ít đi
 * hẳn — đó là chủ ý, không phải hỏng.
 *
 * Bỏ hết ký tự không phải chữ/số thay vì giữ dấu ngoặc: dấu câu là chỗ AI hay đọc lệch
 * nhất, mà bỏ đi thì không mất chút sức phân biệt nào.
 */
export function matchKey(drugName: string): string {
  return String(drugName || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 255);
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

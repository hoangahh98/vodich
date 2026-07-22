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

/**
 * Tách tên thuốc thành các TỪ đã chuẩn hoá: bỏ dấu, đ->d, về chữ thường, cắt theo mọi ký
 * tự không phải chữ/số. "Paracetamol hoạt chất 500mg" -> ["paracetamol","hoat","chat","500mg"].
 */
export function drugTokens(drugName: string): string[] {
  return String(drugName || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    // Dán số với đơn vị đi liền sau nó: "500 mg" và "500mg" phải ra cùng một từ, nếu không
    // một dấu cách do AI đọc lệch là coi như khác hàm lượng và bỏ sót cữ trùng.
    .replace(/(\d)\s+([a-z])/g, '$1$2')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Hai từ có phải "gần như một" không (để chịu được lỗi AI đọc sai một ký tự).
 *
 * Chỉ nới cho từ CHỮ THUẦN đủ dài (>=4) — tên thuốc/tên hãng ("vinhpro" vs "vinhopro",
 * "zensonid" vs "zensomid"). Từ có SỐ (hàm lượng "250mg", "500mg", "d3") phải khớp TUYỆT
 * ĐỐI: nới ở đây là gộp nhầm hai liều khác nhau, nguy hiểm hơn nhiều so với lợi ích. */
function tokenSimilar(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  if (/\d/.test(a) || /\d/.test(b)) return false;
  return editDistanceAtMost1(a, b);
}

/** Khoảng cách sửa (thêm/bớt/đổi 1 ký tự) giữa a và b có <= 1 không. Đủ cho lỗi AI đọc
 *  lệch một chữ; không cần hàm Levenshtein đầy đủ. */
function editDistanceAtMost1(a: string, b: string): boolean {
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (la > lb) i++; // b thiếu 1 ký tự
    else if (lb > la) j++; // b thừa 1 ký tự
    else {
      i++;
      j++;
    } // đổi 1 ký tự
  }
  if (i < la || j < lb) edits++;
  return edits <= 1;
}

/**
 * Hai tên thuốc có coi là TRÙNG nhau không — dùng để cảnh báo uống gấp đôi (đơn cũ vs mới,
 * và hai dòng cùng đơn sau khi chuyển đơn).
 *
 * So theo TỪ, không theo chuỗi liền: coi là trùng khi tập từ của thuốc ÍT TỪ hơn nằm GỌN
 * trong thuốc kia. Nhờ vậy bắt được cùng một thuốc bị AI ghi thừa chữ ở BẤT KỲ đâu — kể cả
 * chèn giữa: "Paracetamol 500mg" ⊆ "Paracetamol hoạt chất 500mg", hoặc thêm ở cuối
 * "Paracetamol 500mg (Hapacol)". So từng từ bằng tokenSimilar nên chịu được AI đọc lệch
 * một ký tự ở tên hãng: "(Vinhpro)" vẫn khớp "Ciprofloxacin (Vinhopro)".
 *
 * Hàm lượng VẪN phân biệt được: {paracetamol,250mg} và {paracetamol,500mg} không tập nào
 * chứa tập nào (token số phải khớp đúng) -> KHÔNG gộp. Combo khác hoạt chất cũng vậy:
 * {terbutalin,bromhexin} vs {terbutalin,guaifenesin}. Tên rỗng không trùng với ai.
 *
 * Đánh đổi đã biết & người dùng chấp nhận: nới thế này thà báo dư còn hơn để sót một cữ
 * uống gấp đôi. Khác với matchKey (khoá đối chiếu TỒN KHO, phải khít tuyệt đối để không lấy
 * nhầm thuốc khác hàm lượng) — chỗ này chỉ để CẢNH BÁO nên được phép nới.
 */
export function drugNamesCollide(a: string, b: string): boolean {
  const ta = drugTokens(a);
  const tb = drugTokens(b);
  if (!ta.length || !tb.length) return false;
  const [small, big] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return small.every((token) => big.some((other) => tokenSimilar(token, other)));
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

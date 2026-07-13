import { Injectable } from '@nestjs/common';
import { Monster } from './knight.constants';

// Một cặp để nối: số <-> nhóm đồ vật có đúng số lượng đó.
export interface KnightPair {
  n: number;
  emoji: string;
}

// Một câu hỏi trực quan cho trẻ.
// - type 'choice' (mặc định): emoji minh hoạ + thẻ đáp án bấm chọn.
// - type 'match': nối SỐ với NHÓM hình có đúng số lượng (chạm nối).
export interface KnightQuestion {
  type?: 'choice' | 'match';
  prompt: string;
  visual: string; // chuỗi emoji minh hoạ (có thể rỗng)
  choices: string[]; // 2-4 lựa chọn hiển thị dạng thẻ (rỗng khi type 'match')
  answer: number; // chỉ số đáp án ĐÚNG trong choices (-1 khi type 'match')
  pairs?: KnightPair[]; // các cặp cần nối (chỉ dùng khi type 'match')
  clock?: number; // giờ (1..12) để client vẽ đồng hồ kim rõ ràng
  balance?: KnightBalance; // câu "cân thăng bằng/thay thế" (client vẽ cân bằng hình)
  explain?: string; // giải thích ngắn vì sao ra đáp án (hiện khi bé chọn)
}

// Cân thăng bằng: 1 big = k small. Hỏi: qty của một bên = mấy của bên kia.
export interface KnightBalance {
  big: string; // emoji vật lớn
  small: string; // emoji vật nhỏ
  k: number; // 1 big = k small
  side: 'big' | 'small'; // bên được cho sẵn số lượng trong câu hỏi
  qty: number; // số lượng đã cho của "side"
}

export type KnightLevel = 'easy' | 'medium' | 'hard';

export interface GenerateParams {
  age: number; // 4..7
  notes: string; // ghi chú điểm mạnh/yếu -> cá nhân hoá dạng câu hỏi & hình
  monster: Monster; // loại quái (để chọn emoji/flavor)
  count: number; // số câu cần sinh (không trùng nhau)
  level: KnightLevel; // độ khó do người chơi chọn
  stage: number; // ải hiện tại (1..10) -> khó tăng dần theo ải
}

/**
 * Sinh đề bằng CODE — đáp án luôn đúng theo cấu tạo (không nhờ AI, tránh AI đặt sai đáp án),
 * các câu trong một ải KHÔNG trùng nhau, và trực quan bằng hình ảnh (emoji).
 */
@Injectable()
export class KnightAiService {
  // Luôn sẵn sàng: đề do server tự sinh, không phụ thuộc API.
  isConfigured() {
    return true;
  }

  async generateQuestions(params: GenerateParams): Promise<KnightQuestion[]> {
    const count = clamp(params.count, 3, 50);
    const age = clamp(params.age, 4, 7);
    const emojis = themeEmojis(params.notes || '');
    // Độ khó = mốc theo mức chọn + tiến trình theo ải (ải càng cao càng khó).
    const hardness = clamp(levelBase(params.level) + (clamp(params.stage, 1, 20) - 1), 0, 16);
    const pool = typePool(age, params.notes || '', hardness);

    const out: KnightQuestion[] = [];
    const seen = new Set<string>();
    const maxAttempts = count * 80;
    let attempts = 0;
    while (out.length < count && attempts < maxAttempts) {
      attempts++;
      const type = pool[randInt(0, pool.length - 1)];
      const q = build(type, age, emojis, hardness);
      if (!q) continue;
      const sig = signature(q);
      if (seen.has(sig)) continue; // không trùng nhau
      seen.add(sig);
      out.push(q);
    }
    return out;
  }
}

function levelBase(level: KnightLevel): number {
  return level === 'hard' ? 6 : level === 'medium' ? 3 : 0;
}

// ---- Cá nhân hoá loại câu hỏi theo tuổi + ghi chú ----
type QType =
  | 'count' | 'addPic' | 'subPic' | 'add' | 'sub'
  | 'compareBig' | 'compareSmall' | 'pattern' | 'shape' | 'seq' | 'seqMissing' | 'match'
  // Dạng mở rộng từ ngân hàng 350 câu tư duy 5-7 tuổi:
  | 'compareSign' | 'beforeAfter' | 'shapeSides' | 'realShape' | 'oddOneOut'
  | 'heavier' | 'shareCandy' | 'legsWheels' | 'clock' | 'dayShift' | 'transitive'
  // Dạng cân thăng bằng / thay thế (nhiều hình, ít chữ):
  | 'balance';

function typePool(age: number, notes: string, hardness: number): QType[] {
  const n = notes.toLowerCase();
  let pool: QType[];
  if (age <= 4) pool = ['count', 'count', 'pattern', 'shape', 'addPic', 'compareBig', 'match'];
  else if (age === 5) pool = ['count', 'addPic', 'subPic', 'pattern', 'shape', 'compareBig', 'compareSmall', 'seqMissing', 'match'];
  else if (age === 6) pool = ['add', 'addPic', 'sub', 'subPic', 'compareBig', 'compareSmall', 'seq', 'seqMissing', 'count', 'match'];
  else pool = ['add', 'sub', 'compareBig', 'compareSmall', 'seq', 'seqMissing', 'addPic', 'subPic', 'match'];

  // Bám ghi chú của bố mẹ để luyện đúng điểm yếu (thêm trọng số).
  const boost = (t: QType, times = 2) => { for (let i = 0; i < times; i++) pool.push(t); };
  if (/(cộng|cong|phép cộng|\+)/.test(n)) { boost('add'); boost('addPic'); }
  if (/(trừ|tru|phép trừ)/.test(n)) { boost('sub'); boost('subPic'); }
  if (/(đếm|dem|số lượng|so luong)/.test(n)) { boost('count'); }
  if (/(so sánh|so sanh|lớn|nhỏ|lon hon|nho hon)/.test(n)) { boost('compareBig'); boost('compareSmall'); }
  if (/(hình|hinh|khối|khoi|quy luật|quy luat|pattern)/.test(n)) { boost('pattern'); boost('shape'); }

  // Độ khó cao: ưu tiên phép tính & dãy số (bớt tỉ trọng câu dễ như đếm/hình).
  if (hardness >= 4) { boost('compareBig'); boost('seqMissing'); if (age >= 6) { boost('add'); boost('sub'); } else { boost('addPic'); boost('subPic'); } }
  if (hardness >= 8 && age >= 6) { boost('add'); boost('sub'); boost('seq'); }

  // Dạng mở rộng từ ngân hàng 350 câu (tư duy tổng hợp) — thêm cho phong phú.
  ['compareSign', 'beforeAfter', 'shapeSides', 'oddOneOut', 'shareCandy', 'heavier', 'realShape', 'balance'].forEach((t) => pool.push(t as QType));
  if (age >= 5) ['legsWheels', 'clock', 'balance'].forEach((t) => pool.push(t as QType));
  if (age >= 6) ['clock', 'dayShift', 'transitive', 'legsWheels'].forEach((t) => pool.push(t as QType));
  return pool;
}

function build(type: QType, age: number, emojis: string[], hardness: number): KnightQuestion | null {
  const e = pick(emojis);
  const cap = (base: number, growth: number, min: number, max: number) => clamp(base + Math.round(hardness * growth), min, max);
  switch (type) {
    case 'count': {
      const max = cap(age <= 4 ? 6 : age === 5 ? 8 : 9, 0.5, 4, 15);
      const n = randInt(1, max);
      return numericQ(`Đếm xem có tất cả mấy ${e}?`, repeat(e, n), n, 0, max + 2, `Đếm lần lượt được ${n} ${e} nên đáp án là ${n}.`);
    }
    case 'addPic': {
      const maxSum = cap(age <= 4 ? 5 : age === 5 ? 8 : 10, 0.4, 4, 12); // giới hạn 12 để hàng emoji không quá dài
      const a = randInt(1, maxSum - 1);
      const b = randInt(1, maxSum - a);
      return numericQ(`Có ${a} ${e}, thêm ${b} ${e} nữa. Tất cả mấy?`, `${repeat(e, a)} ➕ ${repeat(e, b)}`, a + b, 0, maxSum + 2, `${a} thêm ${b} là ${a} + ${b} = ${a + b}.`);
    }
    case 'subPic': {
      const maxStart = cap(age <= 5 ? 7 : 10, 0.3, 4, 12);
      const a = randInt(2, maxStart);
      const b = randInt(1, a - 1);
      return numericQ(`Có ${a} ${e}, bớt đi ${b}. Còn lại mấy?`, repeat(e, a), a - b, 0, maxStart, `${a} bớt ${b} là ${a} - ${b} = ${a - b}.`);
    }
    case 'add': {
      const maxSum = cap(age === 6 ? 15 : 20, 1.4, 8, 40);
      const a = randInt(1, maxSum - 1);
      const b = randInt(1, maxSum - a);
      return numericQ(`${a} + ${b} = ?`, '', a + b, 0, maxSum + 3, `${a} + ${b} = ${a + b}.`);
    }
    case 'sub': {
      const maxStart = cap(age === 6 ? 12 : 20, 1.4, 6, 40);
      const a = randInt(2, maxStart);
      const b = randInt(1, a - 1);
      return numericQ(`${a} - ${b} = ?`, '', a - b, 0, maxStart, `${a} - ${b} = ${a - b}.`);
    }
    case 'compareBig':
    case 'compareSmall': {
      const max = cap(age <= 5 ? 10 : 20, 1.6, 5, 60);
      const k = age <= 4 ? 2 : pick([2, 3, 3]); // giống "khoanh số lớn nhất" (2-3 số)
      const set = new Set<number>();
      while (set.size < k) set.add(randInt(1, max));
      const nums = shuffle(Array.from(set));
      const big = type === 'compareBig';
      const answerValue = big ? Math.max(...nums) : Math.min(...nums);
      const choices = nums.map(String);
      return withExplain({ prompt: big ? 'Số nào LỚN nhất?' : 'Số nào NHỎ nhất?', visual: '', choices, answer: choices.indexOf(String(answerValue)) }, `Trong ${nums.join(', ')}, ${answerValue} là số ${big ? 'lớn' : 'nhỏ'} nhất.`);
    }
    case 'pattern': {
      const a = pick(SHAPES);
      let b = pick(SHAPES);
      while (b === a) b = pick(SHAPES);
      let c = pick(SHAPES);
      while (c === a || c === b) c = pick(SHAPES);
      // Dãy lặp A B A B ? -> tiếp theo là A
      const choices = shuffle([a, b, c]);
      return withExplain({ prompt: 'Hình nào tiếp theo trong dãy?', visual: `${a}${b}${a}${b}❓`, choices, answer: choices.indexOf(a) }, `Dãy lặp ${a}${b} rồi lại ${a}${b}, nên sau ${b} là ${a}.`);
    }
    case 'shape': {
      const target = pick(SHAPE_OBJS);
      const pool = shuffle(SHAPE_OBJS.filter((s) => s.emoji !== target.emoji)).slice(0, 2);
      const choices = shuffle([target.emoji, ...pool.map((s) => s.emoji)]);
      return withExplain({ prompt: `Đâu là ${target.name}?`, visual: '', choices, answer: choices.indexOf(target.emoji) }, `${target.emoji} là ${target.name}.`);
    }
    case 'seq': {
      const max = cap(age === 6 ? 15 : 22, 1.4, 10, 40);
      const step = pick([1, 2, 2, 3]);
      const start = randInt(1, Math.max(1, max - step * 4));
      const s2 = start + step, s3 = start + 2 * step, next = start + 3 * step;
      return numericQ(`${start}, ${s2}, ${s3}, ?`, '', next, 0, next + step + 2, `Dãy tăng đều ${step}, sau ${s3} là ${s3} + ${step} = ${next}.`);
    }
    case 'seqMissing': {
      // Điền số CÒN THIẾU ở giữa dãy (giống câu 3: 0, ?, 2).
      const max = cap(age <= 5 ? 10 : age === 6 ? 15 : 22, 1.2, 6, 40);
      const step = pick([1, 1, 2]);
      const start = randInt(1, Math.max(1, max - 2 * step));
      const mid = start + step, end = start + 2 * step;
      return numericQ(`Số còn thiếu: ${start}, ?, ${end}`, '', mid, 0, end + 2, `Dãy tăng đều ${step}: ${start}, ${mid}, ${end}. Số còn thiếu là ${mid}.`);
    }
    case 'match': {
      // Nối SỐ với NHÓM đồ vật có đúng số lượng (giống câu "tìm số lượng tương ứng").
      // Giới hạn ≤6 hình/nhóm để mỗi ô gọn 1 hàng, các ô bằng nhau (không bị lệch cao thấp).
      const count = age <= 5 ? pick([2, 3]) : 3;
      const maxN = cap(age <= 4 ? 4 : 5, 0.2, 3, 6);
      const ns = new Set<number>();
      while (ns.size < count) ns.add(randInt(1, maxN)); // số lượng phân biệt -> nối 1-1 không mơ hồ
      const uniqEmojis = shuffle(Array.from(new Set(emojis)));
      const pairs = Array.from(ns).map((num, i) => ({ n: num, emoji: uniqEmojis[i % uniqEmojis.length] }));
      return { type: 'match', prompt: 'Nối số với nhóm có đúng số lượng', visual: '', choices: [], answer: -1, pairs, explain: 'Đếm số hình trong mỗi nhóm rồi nối với đúng con số đó.' };
    }
    case 'compareSign': {
      const max = cap(age <= 5 ? 10 : 20, 1.4, 5, 50);
      const a = randInt(1, max);
      const b = randInt(1, max);
      const ans = a > b ? '>' : a < b ? '<' : '=';
      const choices = ['>', '<', '='];
      const word = a > b ? `${a} lớn hơn ${b}` : a < b ? `${a} nhỏ hơn ${b}` : `${a} bằng ${b}`;
      return withExplain({ prompt: `Chọn dấu đúng:  ${a} ? ${b}`, visual: `${a}   ${b}`, choices, answer: choices.indexOf(ans) }, `${word} nên dùng dấu ${ans}.`);
    }
    case 'beforeAfter': {
      const max = cap(age <= 5 ? 10 : 20, 1.2, 5, 50);
      if (pick([true, false])) {
        const n = randInt(2, max);
        return numericQ(`Số liền TRƯỚC của ${n} là số mấy?`, '', n - 1, 0, max, `Đếm lùi 1 từ ${n} là ${n - 1}.`);
      }
      const n = randInt(1, max - 1);
      return numericQ(`Số liền SAU của ${n} là số mấy?`, '', n + 1, 0, max + 1, `Đếm thêm 1 từ ${n} là ${n + 1}.`);
    }
    case 'shapeSides': {
      const s = pick(SHAPE_SIDES);
      const ex = s.sides === 0 ? `${s.name} tròn trịa, không có cạnh nào (0 cạnh).` : `${s.name} có ${s.sides} cạnh.`;
      return numericQ(`${s.name} có mấy cạnh?`, s.emoji, s.sides, 0, 6, ex);
    }
    case 'realShape': {
      const r = pick(REAL_SHAPES);
      const distract = shuffle(ALL_SHAPES.filter((x) => x !== r.shape)).slice(0, 2);
      const choices = shuffle([r.shape, ...distract]);
      return withExplain({ prompt: `${r.obj} ${r.emoji} có dạng hình gì?`, visual: '', choices, answer: choices.indexOf(r.shape) }, `${r.obj} có dạng ${SHAPE_NAME[r.shape]} ${r.shape}.`);
    }
    case 'oddOneOut': {
      const cats = Object.keys(ODD_CATEGORIES);
      const baseCat = pick(cats);
      let oddCat = pick(cats);
      while (oddCat === baseCat) oddCat = pick(cats);
      const base = shuffle(ODD_CATEGORIES[baseCat]).slice(0, 3);
      const odd = pick(ODD_CATEGORIES[oddCat]);
      const choices = shuffle([...base, odd]);
      return withExplain({ prompt: 'Hình nào KHÁC nhóm?', visual: '', choices, answer: choices.indexOf(odd) }, `${odd} là ${CAT_NAME[oddCat]}, còn 3 hình kia là ${CAT_NAME[baseCat]}.`);
    }
    case 'heavier': {
      let i = randInt(0, ANIMAL_WEIGHT.length - 1);
      let j = randInt(0, ANIMAL_WEIGHT.length - 1);
      while (j === i) j = randInt(0, ANIMAL_WEIGHT.length - 1);
      const heavier = i > j ? ANIMAL_WEIGHT[i] : ANIMAL_WEIGHT[j];
      const choices = shuffle([ANIMAL_WEIGHT[i], ANIMAL_WEIGHT[j]]);
      return withExplain({ prompt: 'Con nào NẶNG hơn?', visual: '', choices, answer: choices.indexOf(heavier) }, `${heavier} to con hơn nên nặng hơn.`);
    }
    case 'shareCandy': {
      const maxHalf = cap(age <= 5 ? 4 : 6, 0.3, 2, 9);
      const half = randInt(1, maxHalf);
      const total = half * 2;
      return numericQ(`Có ${total} 🍬 chia đều cho 2 bạn. Mỗi bạn được mấy cái?`, repeat('🍬', total), half, 0, total, `${total} chia đều cho 2 bạn: ${total} ÷ 2 = ${half} cái mỗi bạn.`);
    }
    case 'legsWheels': {
      const l = pick(LEGS);
      const count = randInt(2, age <= 5 ? 3 : 4);
      return numericQ(`Mỗi ${l.name} ${l.emoji} có ${l.per} ${l.part}. ${count} ${l.name} có mấy ${l.part}?`, repeat(l.emoji, count), l.per * count, 0, l.per * count + 3, `Mỗi ${l.name} ${l.per} ${l.part}, ${count} ${l.name} là ${count} × ${l.per} = ${l.per * count} ${l.part}.`);
    }
    case 'clock': {
      const h = randInt(1, 12);
      const q = numericQ('Đồng hồ chỉ mấy giờ?', '', h, 1, 12, `Kim ngắn chỉ số ${h}, kim dài chỉ 12 nên là ${h} giờ.`);
      q.clock = h; // client vẽ đồng hồ kim rõ ràng
      return q;
    }
    case 'dayShift': {
      const today = randInt(0, 6);
      const next = pick([true, false]);
      const ansIdx = next ? (today + 1) % 7 : (today + 6) % 7;
      const ans = DAYS[ansIdx];
      const others = shuffle(DAYS.filter((d) => d !== ans)).slice(0, 2);
      const choices = shuffle([ans, ...others]);
      return withExplain({ prompt: `Hôm nay là ${DAYS[today]}, vậy ${next ? 'ngày mai' : 'hôm qua'} là thứ mấy?`, visual: '', choices, answer: choices.indexOf(ans) }, `${next ? 'Ngay sau' : 'Ngay trước'} ${DAYS[today]} là ${ans}.`);
    }
    case 'balance': {
      // 1 [big] = k [small]. Hỏi bằng mấy (cả chiều nhân & chiều chia).
      const it = pick(BALANCE_ITEMS);
      const reverse = pick([false, true, true]); // ưu tiên chiều ngược (ví dụ 10 chanh = ? cam)
      let k: number, side: 'big' | 'small', qty: number, answer: number, targetEmoji: string, explain: string;
      if (reverse) {
        k = randInt(2, 3);
        const m = randInt(2, 4);
        qty = k * m; // số vật nhỏ cho trước (chia hết cho k)
        answer = m; // = mấy vật lớn
        side = 'small';
        targetEmoji = it.big;
        explain = `1 ${it.big} = ${k} ${it.small}, nên ${qty} ${it.small} = ${qty} ÷ ${k} = ${answer} ${it.big}.`;
      } else {
        k = randInt(2, age <= 5 ? 3 : 4);
        qty = randInt(2, 4); // số vật lớn cho trước
        answer = qty * k; // = mấy vật nhỏ
        side = 'big';
        targetEmoji = it.small;
        explain = `1 ${it.big} = ${k} ${it.small}, nên ${qty} ${it.big} = ${qty} × ${k} = ${answer} ${it.small}.`;
      }
      const q = numericQ(`⚖️ = mấy ${targetEmoji}?`, '', answer, 0, answer + 4, explain);
      q.balance = { big: it.big, small: it.small, k, side, qty };
      return q;
    }
    case 'transitive': {
      const trio = shuffle(PEOPLE).slice(0, 3); // A > B > C theo đặc điểm
      const [a, b, c] = trio;
      const t = pick([
        { rel: 'cao hơn', ask: 'cao nhất', top: true },
        { rel: 'cao hơn', ask: 'thấp nhất', top: false },
        { rel: 'chạy nhanh hơn', ask: 'chạy nhanh nhất', top: true },
        { rel: 'chạy nhanh hơn', ask: 'chạy chậm nhất', top: false },
      ]);
      const ans = t.top ? a : c;
      const choices = shuffle([a, b, c]);
      return withExplain({ prompt: `${a} ${t.rel} ${b}. ${b} ${t.rel} ${c}. Ai ${t.ask}?`, visual: '', choices, answer: choices.indexOf(ans) }, `${a} ${t.rel} ${b}, ${b} ${t.rel} ${c}, vậy ${ans} ${t.ask}.`);
    }
    default:
      return null;
  }
}

// Tạo câu trắc nghiệm số: 3 lựa chọn, đáp án đúng nằm trong đó (distractor gần & khác nhau).
function numericQ(prompt: string, visual: string, answerValue: number, min: number, max: number, explain?: string): KnightQuestion {
  const options = new Set<number>([answerValue]);
  const deltas = shuffle([-3, -2, -1, 1, 2, 3]);
  for (const d of deltas) {
    if (options.size >= 3) break;
    const cand = answerValue + d;
    if (cand >= min && cand <= max) options.add(cand);
  }
  // Bảo hiểm nếu vẫn thiếu (đáp án ở biên): nới ra.
  let extra = max + 1;
  while (options.size < 3 && extra <= max + 4) options.add(extra++);
  const arr = shuffle(Array.from(options));
  const q: KnightQuestion = { prompt, visual, choices: arr.map(String), answer: arr.indexOf(answerValue) };
  if (explain) q.explain = explain;
  return q;
}

// Gắn lời giải thích cho câu dạng object literal.
function withExplain(q: KnightQuestion, explain: string): KnightQuestion {
  q.explain = explain;
  return q;
}

// ---- Chủ đề hình theo ghi chú ----
const COUNT_EMOJIS = ['🍎', '🍌', '⭐', '🐤', '🎈', '🐟', '🍭', '🌸', '🚗', '🐞', '🐰', '🍓'];
const THEMES: Array<{ kw: RegExp; e: string[] }> = [
  { kw: /(khủng long|khung long|dinosaur|dino)/i, e: ['🦖', '🦕'] },
  { kw: /(mèo|meo|con mèo|cat)/i, e: ['🐱', '🐈'] },
  { kw: /(chó|cho|con chó|dog|cún|cun)/i, e: ['🐶', '🐕'] },
  { kw: /(cá|con cá|fish)/i, e: ['🐟', '🐠'] },
  { kw: /(hoa|flower|bông|bong)/i, e: ['🌸', '🌼', '🌺'] },
  { kw: /(xe|ô tô|o to|car)/i, e: ['🚗', '🚙'] },
  { kw: /(sao|star|ngôi sao|ngoi sao)/i, e: ['⭐', '🌟'] },
  { kw: /(kẹo|keo|bánh|banh|candy|cake)/i, e: ['🍭', '🍬', '🍰'] },
  { kw: /(bóng|bong|ball)/i, e: ['⚽', '🏀', '🎈'] },
  { kw: /(khủng|thỏ|tho|rabbit)/i, e: ['🐰'] },
];
function themeEmojis(notes: string): string[] {
  const hits: string[] = [];
  for (const t of THEMES) if (t.kw.test(notes)) hits.push(...t.e);
  // Trộn chủ đề riêng của bé với bộ mặc định để vừa quen vừa đa dạng.
  return hits.length ? Array.from(new Set([...hits, ...hits, ...COUNT_EMOJIS])) : COUNT_EMOJIS;
}

const SHAPES = ['🔺', '🟦', '🔵', '⭐', '❤️', '🟩'];
const SHAPE_OBJS = [
  { emoji: '🔺', name: 'tam giác' },
  { emoji: '🟦', name: 'hình vuông' },
  { emoji: '🔵', name: 'hình tròn' },
  { emoji: '⭐', name: 'ngôi sao' },
  { emoji: '❤️', name: 'trái tim' },
  { emoji: '🟩', name: 'hình vuông xanh' },
];

// ---- Dữ liệu cho các dạng mở rộng (ngân hàng 350 câu) ----
// Chỉ dùng 3 hình PHÂN BIỆT rõ (tránh 2 hình vuông đỏ/xanh gây rối).
const SHAPE_NAME: Record<string, string> = { '🔵': 'hình tròn', '🟦': 'hình vuông', '🔺': 'tam giác' };
const ALL_SHAPES = ['🔵', '🟦', '🔺'];
const SHAPE_SIDES = [
  { emoji: '🔺', name: 'Tam giác', sides: 3 },
  { emoji: '🟦', name: 'Hình vuông', sides: 4 },
  { emoji: '🔵', name: 'Hình tròn', sides: 0 },
];
const REAL_SHAPES = [
  { obj: 'Bánh xe đạp', emoji: '🚲', shape: '🔵' },
  { obj: 'Mặt đồng hồ', emoji: '🕐', shape: '🔵' },
  { obj: 'Quả bóng', emoji: '⚽', shape: '🔵' },
  { obj: 'Cái bánh pizza cắt miếng', emoji: '🍕', shape: '🔺' },
  { obj: 'Mái nhà', emoji: '🏠', shape: '🔺' },
  { obj: 'Cửa sổ lớp học', emoji: '🪟', shape: '🟦' },
  { obj: 'Cái tivi', emoji: '📺', shape: '🟦' },
];
const CAT_NAME: Record<string, string> = { animal: 'con vật', fruit: 'hoa quả', vehicle: 'xe cộ', school: 'đồ dùng học tập' };
const ODD_CATEGORIES: Record<string, string[]> = {
  animal: ['🐶', '🐱', '🐷', '🐰', '🐮', '🐔', '🐸', '🐵'],
  fruit: ['🍎', '🍌', '🍓', '🍉', '🍊', '🍇', '🍑', '🍐'],
  vehicle: ['🚗', '🚌', '✈️', '🚂', '🚲', '🚢', '🚚'],
  school: ['✏️', '📕', '📏', '🎒', '📐', '🖊️'],
};
// Nhẹ -> nặng dần (chỉ số càng lớn càng nặng).
const ANIMAL_WEIGHT = ['🐜', '🐭', '🐹', '🐰', '🐱', '🐶', '🐷', '🐺', '🐴', '🐻', '🦁', '🐘', '🦏', '🐋'];
const DAYS = ['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ Nhật'];
const LEGS = [
  { name: 'con chó', emoji: '🐶', per: 4, part: 'chân' },
  { name: 'con mèo', emoji: '🐱', per: 4, part: 'chân' },
  { name: 'con gà', emoji: '🐔', per: 2, part: 'chân' },
  { name: 'xe đạp', emoji: '🚲', per: 2, part: 'bánh' },
  { name: 'ô tô', emoji: '🚗', per: 4, part: 'bánh' },
];
const PEOPLE = ['An', 'Bi', 'Bo', 'Ken', 'Su', 'Ti', 'Na', 'Lu', 'Ni', 'Mi'];
// Cặp vật cho câu cân thăng bằng: 1 [big] = k [small].
const BALANCE_ITEMS = [
  { big: '🍉', small: '🍎' },
  { big: '🍊', small: '🍋' },
  { big: '🎂', small: '🍬' },
  { big: '🎁', small: '🔴' },
  { big: '🍈', small: '🍒' },
  { big: '🥥', small: '🥜' },
];

// Chữ ký để loại câu trùng trong cùng một ải.
function signature(q: KnightQuestion): string {
  if (q.type === 'match' && q.pairs) {
    return 'match|' + q.pairs.map((p) => p.n + ':' + p.emoji).slice().sort().join(',');
  }
  return q.prompt + '|' + q.visual + '|' + q.choices.slice().sort().join(',');
}

// ---- helpers ----
function repeat(s: string, n: number): string {
  return Array.from({ length: n }, () => s).join('');
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function shuffle<T>(arr: T[]): T[] {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n)));
}

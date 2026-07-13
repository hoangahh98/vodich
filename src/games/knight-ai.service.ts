import { Injectable } from '@nestjs/common';
import { Monster } from './knight.constants';

// Một câu hỏi trực quan cho trẻ: emoji minh hoạ + các thẻ đáp án bấm chọn (không gõ phím).
export interface KnightQuestion {
  prompt: string;
  visual: string; // chuỗi emoji minh hoạ (có thể rỗng)
  choices: string[]; // 2-4 lựa chọn hiển thị dạng thẻ
  answer: number; // chỉ số đáp án ĐÚNG trong choices
}

export interface GenerateParams {
  age: number; // 4..7
  notes: string; // ghi chú điểm mạnh/yếu -> cá nhân hoá dạng câu hỏi & hình
  monster: Monster; // độ khó theo loại quái
  count: number; // số câu cần sinh (không trùng nhau)
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
    const count = clamp(params.count, 3, 14);
    const age = clamp(params.age, 4, 7);
    const emojis = themeEmojis(params.notes || '');
    const pool = typePool(age, params.monster.type, params.notes || '');

    const out: KnightQuestion[] = [];
    const seen = new Set<string>();
    const maxAttempts = count * 60;
    let attempts = 0;
    while (out.length < count && attempts < maxAttempts) {
      attempts++;
      const type = pool[randInt(0, pool.length - 1)];
      const q = build(type, age, params.monster.type, emojis);
      if (!q) continue;
      const sig = signature(q);
      if (seen.has(sig)) continue; // không trùng nhau
      seen.add(sig);
      out.push(q);
    }
    return out;
  }
}

// ---- Cá nhân hoá loại câu hỏi theo tuổi + ghi chú ----
type QType = 'count' | 'addPic' | 'subPic' | 'add' | 'sub' | 'compareBig' | 'compareSmall' | 'pattern' | 'shape' | 'seq' | 'seqMissing';

function typePool(age: number, monster: Monster['type'], notes: string): QType[] {
  const n = notes.toLowerCase();
  let pool: QType[];
  if (age <= 4) pool = ['count', 'count', 'pattern', 'shape', 'addPic', 'compareBig'];
  else if (age === 5) pool = ['count', 'addPic', 'subPic', 'pattern', 'shape', 'compareBig', 'compareSmall', 'seqMissing'];
  else if (age === 6) pool = ['add', 'addPic', 'sub', 'subPic', 'compareBig', 'compareSmall', 'seq', 'seqMissing', 'count'];
  else pool = ['add', 'sub', 'compareBig', 'compareSmall', 'seq', 'seqMissing', 'addPic', 'subPic'];

  // Bám ghi chú của bố mẹ để luyện đúng điểm yếu (thêm trọng số).
  const boost = (t: QType, times = 2) => { for (let i = 0; i < times; i++) pool.push(t); };
  if (/(cộng|cong|phép cộng|\+)/.test(n)) { boost('add'); boost('addPic'); }
  if (/(trừ|tru|phép trừ)/.test(n)) { boost('sub'); boost('subPic'); }
  if (/(đếm|dem|số lượng|so luong)/.test(n)) { boost('count'); }
  if (/(so sánh|so sanh|lớn|nhỏ|lon hon|nho hon)/.test(n)) { boost('compareBig'); boost('compareSmall'); }
  if (/(hình|hinh|khối|khoi|quy luật|quy luat|pattern)/.test(n)) { boost('pattern'); boost('shape'); }

  // Boss/tinh anh: nhích khó hơn (ưu tiên tính & dãy số).
  if (monster === 'boss') { boost('add'); boost('sub'); boost('seq'); }
  return pool;
}

function build(type: QType, age: number, monster: Monster['type'], emojis: string[]): KnightQuestion | null {
  const hard = monster === 'boss' ? 2 : monster === 'elite' ? 1 : 0;
  const e = pick(emojis);
  switch (type) {
    case 'count': {
      const max = age <= 4 ? 6 : age === 5 ? 8 : 9;
      const n = randInt(1, max);
      return numericQ(`Đếm xem có tất cả mấy ${e}?`, repeat(e, n), n, 0, max + 2);
    }
    case 'addPic': {
      const maxSum = age <= 4 ? 5 : age === 5 ? 8 : 10;
      const a = randInt(1, maxSum - 1);
      const b = randInt(1, maxSum - a);
      return numericQ(`Có ${a} ${e}, thêm ${b} ${e} nữa. Tất cả mấy?`, `${repeat(e, a)} ➕ ${repeat(e, b)}`, a + b, 0, maxSum + 2);
    }
    case 'subPic': {
      const maxStart = age <= 5 ? 7 : 10;
      const a = randInt(2, maxStart);
      const b = randInt(1, a - 1);
      return numericQ(`Có ${a} ${e}, bớt đi ${b}. Còn lại mấy?`, repeat(e, a), a - b, 0, maxStart);
    }
    case 'add': {
      const maxSum = (age === 6 ? 15 : 20) + hard;
      const a = randInt(1, maxSum - 1);
      const b = randInt(1, maxSum - a);
      return numericQ(`${a} + ${b} = ?`, '', a + b, 0, maxSum + 3);
    }
    case 'sub': {
      const maxStart = (age === 6 ? 12 : 20) + hard;
      const a = randInt(2, maxStart);
      const b = randInt(1, a - 1);
      return numericQ(`${a} - ${b} = ?`, '', a - b, 0, maxStart);
    }
    case 'compareBig':
    case 'compareSmall': {
      const max = age <= 5 ? 10 : 20;
      const k = age <= 4 ? 2 : pick([2, 3, 3]); // giống "khoanh số lớn nhất" (2-3 số)
      const set = new Set<number>();
      while (set.size < k) set.add(randInt(1, max));
      const nums = shuffle(Array.from(set));
      const big = type === 'compareBig';
      const answerValue = big ? Math.max(...nums) : Math.min(...nums);
      const choices = nums.map(String);
      return { prompt: big ? 'Số nào LỚN nhất?' : 'Số nào NHỎ nhất?', visual: '', choices, answer: choices.indexOf(String(answerValue)) };
    }
    case 'pattern': {
      const a = pick(SHAPES);
      let b = pick(SHAPES);
      while (b === a) b = pick(SHAPES);
      let c = pick(SHAPES);
      while (c === a || c === b) c = pick(SHAPES);
      // Dãy lặp A B A B ? -> tiếp theo là A
      const choices = shuffle([a, b, c]);
      return { prompt: 'Hình nào tiếp theo trong dãy?', visual: `${a}${b}${a}${b}❓`, choices, answer: choices.indexOf(a) };
    }
    case 'shape': {
      const target = pick(SHAPE_OBJS);
      const pool = shuffle(SHAPE_OBJS.filter((s) => s.emoji !== target.emoji)).slice(0, 2);
      const choices = shuffle([target.emoji, ...pool.map((s) => s.emoji)]);
      return { prompt: `Đâu là ${target.name}?`, visual: '', choices, answer: choices.indexOf(target.emoji) };
    }
    case 'seq': {
      const max = age === 6 ? 15 : 22;
      const step = pick([1, 2, 2, 3]);
      const start = randInt(1, Math.max(1, max - step * 4));
      const s2 = start + step, s3 = start + 2 * step, next = start + 3 * step;
      return numericQ(`${start}, ${s2}, ${s3}, ?`, '', next, 0, next + step + 2);
    }
    case 'seqMissing': {
      // Điền số CÒN THIẾU ở giữa dãy (giống câu 3: 0, ?, 2).
      const max = age <= 5 ? 10 : age === 6 ? 15 : 22;
      const step = pick([1, 1, 2]);
      const start = randInt(1, Math.max(1, max - 2 * step));
      const mid = start + step, end = start + 2 * step;
      return numericQ(`Số còn thiếu: ${start}, ?, ${end}`, '', mid, 0, end + 2);
    }
    default:
      return null;
  }
}

// Tạo câu trắc nghiệm số: 3 lựa chọn, đáp án đúng nằm trong đó (distractor gần & khác nhau).
function numericQ(prompt: string, visual: string, answerValue: number, min: number, max: number): KnightQuestion {
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
  return { prompt, visual, choices: arr.map(String), answer: arr.indexOf(answerValue) };
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

// Chữ ký để loại câu trùng trong cùng một ải.
function signature(q: KnightQuestion): string {
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

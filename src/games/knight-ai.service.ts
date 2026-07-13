import { Injectable } from '@nestjs/common';
import { AiService } from '../common/ai.service';
import { Monster } from './knight.constants';

// Một câu hỏi trực quan cho trẻ: hiển thị emoji + các thẻ đáp án bấm chọn (không gõ phím).
export interface KnightQuestion {
  prompt: string; // câu hỏi tiếng Việt, ngắn gọn
  visual: string; // chuỗi emoji minh hoạ (có thể rỗng)
  choices: string[]; // 2-4 lựa chọn hiển thị dạng thẻ
  answer: number; // chỉ số đáp án đúng trong choices
}

export interface GenerateParams {
  age: number; // 4..7
  notes: string; // ghi chú điểm mạnh/yếu của bé
  monster: Monster; // để điều chỉnh độ khó theo loại quái
  count: number; // số câu cần sinh
}

@Injectable()
export class KnightAiService {
  constructor(private readonly ai: AiService) {}

  isConfigured() {
    return this.ai.isConfigured();
  }

  /**
   * Sinh bộ câu hỏi. Ưu tiên AI (Groq) đọc TUỔI + GHI CHÚ để cá nhân hoá; nếu chưa
   * cấu hình AI hoặc AI lỗi/JSON hỏng thì tự sinh câu hỏi tĩnh theo tuổi (luôn chơi được).
   */
  async generateQuestions(params: GenerateParams): Promise<KnightQuestion[]> {
    const count = clamp(params.count, 4, 12);
    if (this.ai.isConfigured()) {
      try {
        const prompt = buildPrompt({ ...params, count });
        const result = await this.ai.generateJson<{ questions?: unknown }>(prompt, { temperature: 0.9 });
        const cleaned = sanitizeQuestions(result?.questions, count);
        if (cleaned.length >= Math.min(3, count)) {
          // Bù cho đủ số câu bằng câu tĩnh nếu AI trả thiếu.
          return padTo(cleaned, count, params.age);
        }
      } catch {
        // rơi xuống fallback tĩnh bên dưới
      }
    }
    return fallbackQuestions(params.age, count);
  }
}

// ---- Prompt: cá nhân hoá theo Tuổi + Ghi chú (lấy cảm hứng POMath / Kumon / VioEdu) ----
function buildPrompt(p: GenerateParams): string {
  const age = clamp(p.age, 3, 8);
  const focus =
    age <= 5
      ? 'nhận diện HÌNH KHỐI (tròn, vuông, tam giác), QUY LUẬT/dãy hình lặp lại, ĐẾM SỐ LƯỢNG qua hình ảnh, so sánh nhiều/ít. Chưa dùng phép cộng trừ trừu tượng.'
      : 'phép CỘNG và TRỪ trong phạm vi 20, đếm, so sánh lớn/bé, và TOÁN ĐỐ LOGIC đơn giản (một bước).';
  const hard = p.monster.type === 'boss' ? 'khó hơn một chút (câu cuối là câu thử thách)' : p.monster.type === 'elite' ? 'vừa phải' : 'dễ, nhẹ nhàng';
  const notes = (p.notes || '').trim();
  return [
    `Bạn là "Quản Trò" của một game học Toán nhập vai cho trẻ mầm non/tiểu học Việt Nam.`,
    `Hãy soạn ${p.count} câu hỏi TOÁN bằng TIẾNG VIỆT cho một bé ${age} tuổi.`,
    `Trọng tâm theo lứa tuổi: ${focus}`,
    `Độ khó tổng thể: ${hard}.`,
    notes ? `Ghi chú riêng về bé (hãy bám sát để luyện đúng điểm yếu, tránh làm bé nản): "${notes.slice(0, 300)}".` : `Bé chưa có ghi chú riêng, hãy ra đề cân bằng.`,
    `Quy tắc BẮT BUỘC:`,
    `- Mỗi câu là một object: {"prompt": string, "visual": string, "choices": string[], "answer": number}.`,
    `- "prompt": câu hỏi ngắn, thân thiện, KHÔNG quá 90 ký tự.`,
    `- "visual": chuỗi EMOJI minh hoạ (vd "🍎🍎🍎" hoặc "🔺🟦🔺🟦❓"); để "" nếu không cần. TUYỆT ĐỐI không dùng chữ trong visual.`,
    `- "choices": 2 đến 4 lựa chọn NGẮN (số như "3", hoặc 1 emoji). Đáp án sai phải hợp lý, gần đúng.`,
    `- "answer": chỉ số (bắt đầu từ 0) của đáp án ĐÚNG trong "choices". Phải chính xác tuyệt đối về mặt toán học.`,
    `- Không giải thích, không thêm chữ ngoài JSON.`,
    `Trả về DUY NHẤT JSON: {"questions": [ ... ${p.count} câu ... ]}. Chỉ JSON.`,
  ].join('\n');
}

// ---- Làm sạch & kiểm chứng dữ liệu AI (không tin tưởng mù quáng) ----
function sanitizeQuestions(raw: unknown, max: number): KnightQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: KnightQuestion[] = [];
  for (const item of raw) {
    if (out.length >= max) break;
    if (!item || typeof item !== 'object') continue;
    const q = item as Record<string, unknown>;
    const prompt = String(q.prompt ?? '').trim().slice(0, 120);
    const visual = String(q.visual ?? '').trim().slice(0, 60);
    const choicesRaw = Array.isArray(q.choices) ? q.choices : [];
    const choices = choicesRaw.map((c) => String(c ?? '').trim().slice(0, 24)).filter((c) => c.length > 0);
    const answer = Number(q.answer);
    if (!prompt) continue;
    if (choices.length < 2 || choices.length > 4) continue;
    if (!Number.isInteger(answer) || answer < 0 || answer >= choices.length) continue;
    out.push({ prompt, visual, choices, answer });
  }
  return out;
}

function padTo(questions: KnightQuestion[], count: number, age: number): KnightQuestion[] {
  if (questions.length >= count) return questions.slice(0, count);
  const extra = fallbackQuestions(age, count - questions.length);
  return questions.concat(extra).slice(0, count);
}

// ---- Fallback tĩnh: luôn tạo được đề hợp lệ theo tuổi (không cần API) ----
const COUNT_EMOJIS = ['🍎', '🍌', '⭐', '🐤', '🎈', '🐟', '🍭', '🌸', '🚗', '🐞'];
const SHAPES: Array<{ emoji: string; name: string }> = [
  { emoji: '🔺', name: 'tam giác' },
  { emoji: '🟦', name: 'hình vuông' },
  { emoji: '🔵', name: 'hình tròn' },
  { emoji: '⭐', name: 'ngôi sao' },
];

function fallbackQuestions(age: number, count: number): KnightQuestion[] {
  const list: KnightQuestion[] = [];
  for (let i = 0; i < count; i++) {
    list.push(age <= 5 ? youngQuestion(i) : olderQuestion(i));
  }
  return list;
}

// 4-5 tuổi: đếm số lượng, quy luật hình, nhận diện hình khối.
function youngQuestion(seed: number): KnightQuestion {
  const kind = seed % 3;
  if (kind === 0) {
    const emoji = pick(COUNT_EMOJIS);
    const n = randInt(1, 5);
    return numberChoiceQuestion(`Đếm xem có tất cả mấy ${emoji}?`, emoji.repeat(n), n, 1, 5);
  }
  if (kind === 1) {
    const a = pick(SHAPES);
    let b = pick(SHAPES);
    while (b.emoji === a.emoji) b = pick(SHAPES);
    const visual = `${a.emoji}${b.emoji}${a.emoji}${b.emoji}❓`;
    const choices = shuffleWithAnswer([a.emoji, b.emoji, pick(SHAPES).emoji], a.emoji);
    return { prompt: 'Hình nào tiếp theo trong dãy?', visual, choices: choices.list, answer: choices.answer };
  }
  const target = pick(SHAPES);
  const others = SHAPES.filter((s) => s.emoji !== target.emoji);
  const choices = shuffleWithAnswer([target.emoji, others[0].emoji, others[1].emoji], target.emoji);
  return { prompt: `Đâu là ${target.name}?`, visual: '', choices: choices.list, answer: choices.answer };
}

// 6-7 tuổi: cộng/trừ phạm vi 20, so sánh.
function olderQuestion(seed: number): KnightQuestion {
  const kind = seed % 3;
  if (kind === 0) {
    const a = randInt(1, 9);
    const b = randInt(1, 9);
    return numberChoiceQuestion(`${a} + ${b} = ?`, '', a + b, 0, 20);
  }
  if (kind === 1) {
    const a = randInt(3, 12);
    const b = randInt(1, a);
    return numberChoiceQuestion(`${a} - ${b} = ?`, '', a - b, 0, 20);
  }
  const a = randInt(1, 15);
  let b = randInt(1, 15);
  while (b === a) b = randInt(1, 15);
  const bigger = Math.max(a, b);
  const choices = shuffleWithAnswer([String(a), String(b)], String(bigger));
  return { prompt: `Số nào LỚN hơn: ${a} hay ${b}?`, visual: '', choices: choices.list, answer: choices.answer };
}

function numberChoiceQuestion(prompt: string, visual: string, answerValue: number, min: number, max: number): KnightQuestion {
  const options = new Set<number>([answerValue]);
  let guard = 0;
  while (options.size < 3 && guard++ < 30) {
    const delta = pick([-2, -1, 1, 2]);
    const cand = answerValue + delta;
    if (cand >= min && cand <= max) options.add(cand);
  }
  const arr = shuffle(Array.from(options));
  return { prompt, visual, choices: arr.map(String), answer: arr.indexOf(answerValue) };
}

// ---- helpers ----
function shuffleWithAnswer(pool: string[], answerValue: string): { list: string[]; answer: number } {
  const unique = Array.from(new Set(pool));
  const list = shuffle(unique);
  return { list, answer: list.indexOf(answerValue) };
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
  return Math.max(min, Math.min(max, Math.round(n)));
}

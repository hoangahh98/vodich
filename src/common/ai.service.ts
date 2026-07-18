import { Injectable } from '@nestjs/common';

/**
 * Client gọi AI qua Groq (chuẩn OpenAI, không cần thẻ). Cần env GROQ_API_KEY.
 * - Model text mặc định: llama-3.3-70b-versatile (đổi qua GROQ_MODEL).
 * - Model đọc ảnh mặc định: qwen/qwen3.6-27b (đổi qua GROQ_VISION_MODEL) — dùng cho đơn thuốc.
 *   Lưu ý: llama-4-scout đã bị Groq gỡ (lỗi 404 model_not_found), đừng dùng lại.
 */
export interface AiImage {
  mimeType: string;
  data: string; // base64 (không có tiền tố data:)
}

export interface AiOptions {
  json?: boolean;
  images?: AiImage[];
  model?: string;
  temperature?: number;
}

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
// Chặn treo: huỷ request nếu Groq không phản hồi trong thời gian này (đổi qua AI_TIMEOUT_MS).
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 20000;
// Model suy luận (qwen...) chèn phần "think" vào câu trả lời làm hỏng JSON.
// Với những model này phải gửi reasoning_format=hidden; model thường sẽ báo lỗi 400 nếu gửi.
const REASONING_MODELS = /qwen|deepseek|gpt-oss/i;

@Injectable()
export class AiService {
  isConfigured(): boolean {
    return Boolean((process.env.GROQ_API_KEY || '').trim());
  }

  private textModel() {
    return process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
  }

  private visionModel() {
    return process.env.GROQ_VISION_MODEL || 'qwen/qwen3.6-27b';
  }

  async generate(prompt: string, options: AiOptions = {}): Promise<string> {
    const key = (process.env.GROQ_API_KEY || '').trim();
    if (!key) throw new Error('Chưa cấu hình GROQ_API_KEY. Hãy đặt biến môi trường này để dùng tính năng AI.');

    const hasImages = Boolean(options.images && options.images.length);
    const model = options.model || (hasImages ? this.visionModel() : this.textModel());

    const content: unknown = hasImages
      ? [
          { type: 'text', text: prompt },
          ...options.images!.map((image) => ({ type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.data}` } })),
        ]
      : prompt;

    const body: Record<string, unknown> = {
      model,
      messages: [{ role: 'user', content }],
      temperature: options.temperature ?? 0.7,
      ...(options.json ? { response_format: { type: 'json_object' } } : {}),
      ...(REASONING_MODELS.test(model) ? { reasoning_format: 'hidden' } : {}),
    };

    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let response: Response;
      try {
        response = await fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(AI_TIMEOUT_MS),
        });
      } catch (error) {
        // Timeout (AbortError) hoặc lỗi mạng: thử lại, hết lượt thì báo thân thiện.
        if (attempt < maxAttempts) {
          await sleep(attempt * 1200);
          continue;
        }
        const isTimeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
        throw new Error(isTimeout ? 'AI phản hồi quá lâu, thử lại sau chút nhé.' : 'Không kết nối được tới AI, thử lại sau nhé.');
      }

      if (response.ok) {
        const payload = (await response.json()) as GroqResponse;
        const text = payload.choices?.[0]?.message?.content || '';
        if (!text) throw new Error('AI không trả về nội dung.');
        return text;
      }

      const detail = await response.text().catch(() => '');
      if ((response.status === 429 || response.status === 503) && attempt < maxAttempts) {
        await sleep(attempt * 1200);
        continue;
      }
      throw new Error(friendlyError(response.status, detail));
    }
    throw new Error(friendlyError(429, ''));
  }

  async generateJson<T>(prompt: string, options: AiOptions = {}): Promise<T> {
    const raw = await this.generate(prompt, { ...options, json: true });
    try {
      return JSON.parse(stripCodeFence(raw)) as T;
    } catch {
      throw new Error('Không đọc được JSON từ AI.');
    }
  }
}

interface GroqResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function friendlyError(status: number, detail: string): string {
  if (status === 429) return 'AI đang bận (hết lượt tạm thời). Thử lại sau ít phút nhé.';
  if (status === 503) return 'AI đang quá tải, thử lại sau chút nhé.';
  if (status === 401 || (status === 400 && /api key|invalid/i.test(detail))) return 'GROQ_API_KEY không hợp lệ.';
  return `AI lỗi ${status}: ${detail.slice(0, 200)}`;
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('```')) {
    return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  }
  // Lấy đoạn JSON đầu tiên nếu model chèn text quanh nó.
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first > 0 && last > first) return trimmed.slice(first, last + 1);
  return trimmed;
}

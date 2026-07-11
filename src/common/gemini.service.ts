import { Injectable } from '@nestjs/common';

/**
 * Client mỏng gọi Google Gemini REST (không cần SDK — Node 20 có fetch sẵn).
 * Cần biến môi trường GEMINI_API_KEY. Model mặc định gemini-2.0-flash (nhanh, rẻ,
 * hỗ trợ cả ảnh cho phân tích đơn thuốc).
 */
export interface GeminiImage {
  mimeType: string;
  data: string; // base64 (không có tiền tố data:)
}

export interface GeminiOptions {
  json?: boolean;
  images?: GeminiImage[];
  model?: string;
  temperature?: number;
  systemInstruction?: string;
}

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

@Injectable()
export class GeminiService {
  isConfigured(): boolean {
    return Boolean((process.env.GEMINI_API_KEY || '').trim());
  }

  async generate(prompt: string, options: GeminiOptions = {}): Promise<string> {
    const key = (process.env.GEMINI_API_KEY || '').trim();
    if (!key) throw new Error('Chưa cấu hình GEMINI_API_KEY. Hãy đặt biến môi trường này để dùng tính năng AI.');

    const model = options.model || process.env.GEMINI_MODEL || 'gemini-2.0-flash';
    const parts: unknown[] = [{ text: prompt }];
    for (const image of options.images || []) {
      parts.push({ inline_data: { mime_type: image.mimeType, data: image.data } });
    }

    const body: Record<string, unknown> = {
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: options.temperature ?? 0.7,
        ...(options.json ? { responseMimeType: 'application/json' } : {}),
      },
    };
    if (options.systemInstruction) {
      body.systemInstruction = { parts: [{ text: options.systemInstruction }] };
    }

    const url = `${ENDPOINT}/${model}:generateContent?key=${encodeURIComponent(key)}`;
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        const payload = (await response.json()) as GeminiResponse;
        const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '';
        if (!text) throw new Error('Gemini không trả về nội dung.');
        return text;
      }

      const detail = await response.text().catch(() => '');
      // 429 (hết hạn mức) / 503 (quá tải): thử lại vài lần với backoff nếu là giới hạn tạm thời.
      if ((response.status === 429 || response.status === 503) && attempt < maxAttempts) {
        const wait = retryDelayMs(detail, attempt);
        if (wait <= 8000) {
          await sleep(wait);
          continue;
        }
      }
      throw new Error(friendlyError(response.status, detail));
    }
    throw new Error(friendlyError(429, ''));
  }

  /** Gọi Gemini yêu cầu JSON và parse; ném lỗi nếu không parse được. */
  async generateJson<T>(prompt: string, options: GeminiOptions = {}): Promise<T> {
    const raw = await this.generate(prompt, { ...options, json: true });
    try {
      return JSON.parse(stripCodeFence(raw)) as T;
    } catch {
      throw new Error('Không đọc được JSON từ Gemini.');
    }
  }
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Lấy thời gian chờ từ RetryInfo của Gemini nếu có, ngược lại backoff tăng dần. */
function retryDelayMs(detail: string, attempt: number): number {
  const match = detail.match(/"retryDelay"\s*:\s*"(\d+)(?:\.\d+)?s"/);
  if (match) return Math.min(Number(match[1]) * 1000 + 500, 60000);
  return attempt * 1500;
}

function friendlyError(status: number, detail: string): string {
  if (status === 429) {
    return 'AI đang hết lượt miễn phí (giới hạn Gemini). Thử lại sau ít phút, hoặc bật thanh toán/đổi model để tăng hạn mức.';
  }
  if (status === 503) return 'AI đang quá tải, thử lại sau chút nhé.';
  if (status === 400 && /API key/i.test(detail)) return 'GEMINI_API_KEY không hợp lệ.';
  return `Gemini lỗi ${status}: ${detail.slice(0, 200)}`;
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('```')) {
    return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  }
  return trimmed;
}

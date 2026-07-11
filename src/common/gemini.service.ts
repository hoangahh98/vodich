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

    const model = options.model || 'gemini-2.0-flash';
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

    const response = await fetch(`${ENDPOINT}/${model}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Gemini lỗi ${response.status}: ${detail.slice(0, 300)}`);
    }
    const payload = (await response.json()) as GeminiResponse;
    const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '';
    if (!text) throw new Error('Gemini không trả về nội dung.');
    return text;
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

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('```')) {
    return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  }
  return trimmed;
}

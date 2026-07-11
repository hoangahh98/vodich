import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { requireUser } from '../common/controller-utils';
import { GeminiService } from '../common/gemini.service';
import { render } from '../common/view';

interface ChatTurn {
  role: 'user' | 'ai';
  text: string;
}

@Controller()
export class GamesController {
  constructor(private readonly gemini: GeminiService) {}

  @Get('/games')
  hub(@Req() req: Request, @Res() res: Response) {
    if (!requireUser(req, res)) return;
    return render(res, 'games/index');
  }

  @Get('/games/toan')
  math(@Req() req: Request, @Res() res: Response) {
    if (!requireUser(req, res)) return;
    return render(res, 'games/math');
  }

  @Get('/games/tieng-anh')
  english(@Req() req: Request, @Res() res: Response) {
    if (!requireUser(req, res)) return;
    return render(res, 'games/english');
  }

  @Get('/games/hoi-thoai')
  chatPage(@Req() req: Request, @Res() res: Response) {
    if (!requireUser(req, res)) return;
    return render(res, 'games/chat', { aiConfigured: this.gemini.isConfigured() });
  }

  @Post('/games/chat')
  async chat(@Req() req: Request, @Res() res: Response, @Body() body: { messages?: ChatTurn[] }) {
    if (!req.session.user) return res.status(401).json({ error: 'Cần đăng nhập' });
    if (!this.gemini.isConfigured()) return res.status(503).json({ error: 'Chưa cấu hình AI trên server.' });
    const history = Array.isArray(body.messages) ? body.messages.slice(-12) : [];
    const transcript = history.map((turn) => `${turn.role === 'user' ? 'Bé' : 'Emma'}: ${String(turn.text || '').slice(0, 500)}`).join('\n');
    const prompt = [
      'Bạn là Emma — một người bạn nước ngoài thân thiện, đang giúp một em nhỏ người Việt luyện NÓI tiếng Anh.',
      'Quy tắc trả lời:',
      '- Trả lời bằng tiếng Anh ĐƠN GIẢN, ngắn (1-2 câu), giọng vui vẻ, khích lệ.',
      '- Luôn kết thúc bằng MỘT câu hỏi dễ để bé nói tiếp.',
      '- Nếu câu của bé sai ngữ pháp/từ, sửa nhẹ nhàng bằng cách nhắc lại câu đúng, đừng chê.',
      '- Chủ đề an toàn, phù hợp trẻ em (gia đình, con vật, đồ ăn, trường lớp, sở thích).',
      'Trả về JSON: { "reply": "câu tiếng Anh của Emma", "tip": "gợi ý/nhận xét RẤT ngắn bằng tiếng Việt cho bé (tùy chọn, có thể rỗng)" }.',
      transcript ? `Hội thoại đến giờ:\n${transcript}` : 'Bé vừa mở cuộc trò chuyện, hãy chào và hỏi tên bé.',
    ].join('\n');
    try {
      const result = await this.gemini.generateJson<{ reply: string; tip?: string }>(prompt, { temperature: 0.8 });
      return res.json({ reply: String(result.reply || '').trim() || 'Hi there!', tip: String(result.tip || '').trim() });
    } catch (error) {
      return res.status(502).json({ error: error instanceof Error ? error.message : 'AI lỗi' });
    }
  }
}

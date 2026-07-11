import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { requireUser } from '../common/controller-utils';
import { AiService } from '../common/ai.service';
import { render } from '../common/view';

interface ChatTurn {
  role: 'user' | 'ai';
  text: string;
}

const SCENARIOS: Record<string, string> = {
  free: 'trò chuyện tự do, thân thiện về đời sống hằng ngày',
  interview: 'phỏng vấn xin việc (bạn là nhà tuyển dụng)',
  restaurant: 'ở nhà hàng gọi món (bạn là nhân viên phục vụ)',
  travel: 'ở sân bay/khách sạn khi đi du lịch (bạn là nhân viên)',
  shopping: 'đi mua sắm (bạn là người bán hàng)',
  doctor: 'đi khám bệnh (bạn là bác sĩ)',
  discussion: 'thảo luận một chủ đề (công nghệ, phim ảnh, du lịch...) như hai người bạn',
};

const LEVELS: Record<string, { desc: string; guide: string }> = {
  beginner: { desc: 'Cơ bản (mới học)', guide: 'câu ngắn, từ vựng đơn giản, nói chậm rõ ràng' },
  intermediate: { desc: 'Trung cấp', guide: 'câu dài vừa phải, từ vựng thông dụng, tốc độ tự nhiên' },
  advanced: { desc: 'Nâng cao', guide: 'từ vựng và cấu trúc phong phú, thành ngữ, tốc độ tự nhiên như người bản xứ' },
};

@Controller()
export class GamesController {
  constructor(private readonly ai: AiService) {}

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

  @Get('/games/bong-bong')
  bubbles(@Req() req: Request, @Res() res: Response) {
    if (!requireUser(req, res)) return;
    return render(res, 'games/bubbles');
  }

  @Get('/games/u-oa')
  matchGame(@Req() req: Request, @Res() res: Response) {
    if (!requireUser(req, res)) return;
    return render(res, 'games/match');
  }

  @Get('/games/hoa-si')
  scratch(@Req() req: Request, @Res() res: Response) {
    if (!requireUser(req, res)) return;
    return render(res, 'games/scratch');
  }

  @Get('/games/hoi-thoai')
  chatPage(@Req() req: Request, @Res() res: Response) {
    if (!requireUser(req, res)) return;
    return render(res, 'games/chat', { aiConfigured: this.ai.isConfigured() });
  }

  @Get('/games/tieng-anh-nang-cao')
  advancedPage(@Req() req: Request, @Res() res: Response) {
    if (!requireUser(req, res)) return;
    return render(res, 'games/advanced', { aiConfigured: this.ai.isConfigured() });
  }

  @Post('/games/advanced-chat')
  async advancedChat(@Req() req: Request, @Res() res: Response, @Body() body: { messages?: ChatTurn[]; scenario?: string; level?: string }) {
    if (!req.session.user) return res.status(401).json({ error: 'Cần đăng nhập' });
    if (!this.ai.isConfigured()) return res.status(503).json({ error: 'Chưa cấu hình AI trên server.' });
    const scenario = SCENARIOS[String(body.scenario || '')] || SCENARIOS.free;
    const level = LEVELS[String(body.level || '')] || LEVELS.intermediate;
    const history = Array.isArray(body.messages) ? body.messages.slice(-14) : [];
    const transcript = history.map((turn) => `${turn.role === 'user' ? 'Learner' : 'Tutor'}: ${String(turn.text || '').slice(0, 700)}`).join('\n');
    const prompt = [
      `Bạn là gia sư tiếng Anh chuyên nghiệp, đang luyện NÓI cho người học qua hội thoại.`,
      `Tình huống đóng vai: ${scenario}.`,
      `Trình độ người học: ${level.desc}`,
      `Quy tắc:`,
      `- Trả lời bằng tiếng Anh ĐÚNG trình độ (${level.guide}).`,
      `- Giữ đúng vai/tình huống, luôn kết thúc bằng MỘT câu hỏi để người học nói tiếp.`,
      `- Người học KHÔNG giỏi tiếng Anh, nên luôn kèm bản dịch và gợi ý câu trả lời.`,
      `Trả về JSON đúng schema:`,
      `{`,
      `  "reply": "câu tiếng Anh của gia sư",`,
      `  "vi": "bản dịch tiếng Việt của câu reply",`,
      `  "suggest": "MỘT câu tiếng Anh đơn giản mà người học có thể dùng để trả lời câu hỏi vừa rồi",`,
      `  "suggestVi": "nghĩa tiếng Việt của câu suggest",`,
      `  "tip": "sửa lỗi/nhận xét RẤT ngắn bằng tiếng Việt cho câu trước của người học (có thể rỗng)"`,
      `}. Chỉ trả JSON.`,
      transcript ? `Hội thoại đến giờ:\n${transcript}` : `Người học vừa bắt đầu. Hãy mở đầu tình huống một cách tự nhiên.`,
    ].join('\n');
    try {
      const result = await this.ai.generateJson<{ reply: string; vi?: string; suggest?: string; suggestVi?: string; tip?: string }>(prompt, { temperature: 0.8 });
      return res.json({
        reply: String(result.reply || '').trim() || '...',
        vi: String(result.vi || '').trim(),
        suggest: String(result.suggest || '').trim(),
        suggestVi: String(result.suggestVi || '').trim(),
        tip: String(result.tip || '').trim(),
      });
    } catch (error) {
      return res.status(502).json({ error: error instanceof Error ? error.message : 'AI lỗi' });
    }
  }

  @Post('/games/chat')
  async chat(@Req() req: Request, @Res() res: Response, @Body() body: { messages?: ChatTurn[]; profile?: { name?: string; age?: string; gender?: string; partner?: string } }) {
    if (!req.session.user) return res.status(401).json({ error: 'Cần đăng nhập' });
    if (!this.ai.isConfigured()) return res.status(503).json({ error: 'Chưa cấu hình AI trên server.' });
    const profile = body.profile || {};
    const partner = String(profile.partner || '').trim() || 'Emma';
    const learnerName = String(profile.name || '').trim();
    const learnerAge = String(profile.age || '').trim();
    const learnerGender = String(profile.gender || '').trim();
    const learnerDesc = [learnerName && `tên ${learnerName}`, learnerAge && `${learnerAge} tuổi`, learnerGender && learnerGender].filter(Boolean).join(', ');
    const history = Array.isArray(body.messages) ? body.messages.slice(-12) : [];
    const transcript = history.map((turn) => `${turn.role === 'user' ? 'Người học' : partner}: ${String(turn.text || '').slice(0, 500)}`).join('\n');
    const prompt = [
      `Bạn là ${partner} — một người bạn nước ngoài thân thiện, đang giúp một người Việt luyện NÓI tiếng Anh.`,
      learnerDesc ? `Người học: ${learnerDesc}. Xưng hô thân thiện, dùng tên nếu có, điều chỉnh độ khó/chủ đề phù hợp tuổi.` : 'Chưa rõ thông tin người học; hãy hỏi tên và tuổi một cách thân thiện.',
      'Quy tắc trả lời:',
      '- Trả lời bằng tiếng Anh ĐƠN GIẢN, ngắn (1-2 câu), giọng vui vẻ, khích lệ.',
      '- Luôn kết thúc bằng MỘT câu hỏi dễ để người học nói tiếp.',
      '- Nếu câu người học sai ngữ pháp/từ, sửa nhẹ nhàng bằng cách nhắc lại câu đúng, đừng chê.',
      '- Chủ đề an toàn, phù hợp lứa tuổi (gia đình, con vật, đồ ăn, trường lớp, công việc, sở thích).',
      `Trả về JSON: { "reply": "câu tiếng Anh của ${partner}", "tip": "gợi ý/nhận xét RẤT ngắn bằng tiếng Việt (tùy chọn, có thể rỗng)" }.`,
      transcript ? `Hội thoại đến giờ:\n${transcript}` : `Người học vừa mở cuộc trò chuyện, hãy chào${learnerName ? ' ' + learnerName : ''} và bắt đầu.`,
    ].join('\n');
    try {
      const result = await this.ai.generateJson<{ reply: string; tip?: string }>(prompt, { temperature: 0.8 });
      return res.json({ reply: String(result.reply || '').trim() || 'Hi there!', tip: String(result.tip || '').trim() });
    } catch (error) {
      return res.status(502).json({ error: error instanceof Error ? error.message : 'AI lỗi' });
    }
  }
}

import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { parseBigId, requireUser } from '../common/controller-utils';
import { RateLimitService } from '../common/rate-limit.service';
import { render } from '../common/view';
import { KnightService } from './knight.service';
import { KnightAiService } from './knight-ai.service';
import { BOSS_HP, getStage, MAX_HP, MAX_STAGE, STAGES, WAVE_SIZE } from './knight.constants';

interface WaveMonster {
  name: string;
  emoji: string;
  type: string;
  hp: number;
}

@Controller()
export class KnightController {
  constructor(
    private readonly knight: KnightService,
    private readonly knightAi: KnightAiService,
    private readonly rateLimit: RateLimitService,
  ) {}

  // Trang game: liệt kê nhân vật (chơi tiếp / tạo mới) + bản đồ ải.
  @Get('/games/hiep-si')
  async page(@Req() req: Request, @Res() res: Response) {
    if (!requireUser(req, res)) return;
    const characters = await this.knight.listCharacters(req.session.user!);
    return render(res, 'games/knight', {
      characters,
      stages: STAGES,
      maxHp: MAX_HP,
      maxStage: MAX_STAGE,
      aiConfigured: this.knightAi.isConfigured(),
    });
  }

  @Post('/games/hiep-si/character')
  async createCharacter(@Req() req: Request, @Res() res: Response, @Body() body: { name?: string; gender?: string; age?: unknown; notes?: string }) {
    if (!req.session.user) return res.status(401).json({ error: 'Cần đăng nhập' });
    const character = await this.knight.createCharacter(req.session.user, body || {});
    return res.json({ character });
  }

  @Post('/games/hiep-si/character/delete')
  async deleteCharacter(@Req() req: Request, @Res() res: Response, @Body() body: { characterId?: string }) {
    if (!req.session.user) return res.status(401).json({ error: 'Cần đăng nhập' });
    const id = parseBigId(body?.characterId);
    if (!id) return res.status(400).json({ error: 'Thiếu nhân vật' });
    const ok = await this.knight.deleteCharacter(req.session.user, id);
    if (!ok) return res.status(404).json({ error: 'Không tìm thấy nhân vật' });
    return res.json({ ok: true });
  }

  // Sinh đề cho một ải: trả về cấu hình quái + bộ câu hỏi (AI cá nhân hoá theo tuổi/ghi chú).
  @Post('/games/hiep-si/quiz')
  async quiz(@Req() req: Request, @Res() res: Response, @Body() body: { characterId?: string; stage?: unknown; level?: string }) {
    if (!req.session.user) return res.status(401).json({ error: 'Cần đăng nhập' });
    const id = parseBigId(body?.characterId);
    if (!id) return res.status(400).json({ error: 'Thiếu nhân vật' });
    const character = await this.knight.getOwned(req.session.user, id);
    if (!character) return res.status(404).json({ error: 'Không tìm thấy nhân vật' });

    const stageNumber = clampStage(Number(body?.stage) || character.currentStage);
    const stage = getStage(stageNumber);
    if (!stage) return res.status(400).json({ error: 'Ải không hợp lệ' });

    // Sinh đề dùng AI -> chống spam bằng rate-limit theo IP.
    const limit = this.rateLimit.consume(`ai:knight:${req.ip || 'unknown'}`, { max: 20, windowMs: 60_000 });
    if (!limit.allowed) return res.status(429).json({ error: `Chờ chút nhé, thử lại sau ${limit.retryAfterSeconds}s.` });

    const level = body?.level === 'easy' || body?.level === 'hard' ? body.level : 'medium';

    // Một đợt: 10 quái thường (mỗi con 1-3 máu) + boss (nếu ải 5/10).
    const wave: WaveMonster[] = [];
    for (let i = 0; i < WAVE_SIZE; i++) {
      wave.push({ name: stage.monster.name, emoji: stage.monster.emoji, type: 'normal', hp: 1 + Math.floor(Math.random() * 3) });
    }
    if (stage.boss) wave.push({ name: stage.boss.name, emoji: stage.boss.emoji, type: 'boss', hp: BOSS_HP });
    const totalHp = wave.reduce((sum, m) => sum + m.hp, 0);
    // Đủ câu DUY NHẤT cho cả trường hợp xấu nhất: hạ hết đợt (totalHp câu đúng)
    // + tối đa MAX_HP-1 câu sai trước khi hết máu -> không bao giờ phải lặp lại câu.
    const count = Math.min(50, totalHp + MAX_HP);

    try {
      const questions = await this.knightAi.generateQuestions({ age: character.age, notes: character.notes, monster: stage.monster, count, level, stage: stage.stage });
      return res.json({ stage: { stage: stage.stage, title: stage.title, scene: stage.scene }, wave, questions });
    } catch (error) {
      return res.status(502).json({ error: error instanceof Error ? error.message : 'Không tạo được câu hỏi' });
    }
  }

  @Post('/games/hiep-si/progress')
  async progress(@Req() req: Request, @Res() res: Response, @Body() body: { characterId?: string; stage?: unknown; hp?: unknown; status?: unknown; cleared?: unknown; stars?: unknown }) {
    if (!req.session.user) return res.status(401).json({ error: 'Cần đăng nhập' });
    const id = parseBigId(body?.characterId);
    if (!id) return res.status(400).json({ error: 'Thiếu nhân vật' });
    const character = await this.knight.saveProgress(req.session.user, id, body || {});
    if (!character) return res.status(404).json({ error: 'Không tìm thấy nhân vật' });
    return res.json({ character });
  }
}

function clampStage(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(MAX_STAGE, Math.round(n)));
}

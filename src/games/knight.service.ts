import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { CurrentUser } from '../types';
import { MAX_HP, MAX_STAGE } from './knight.constants';

export interface CharacterDto {
  id: string;
  name: string;
  gender: string;
  age: number;
  notes: string;
  currentStage: number;
  mobIndex: number; // đã đánh tới con quái thứ mấy của ải hiện tại
  hp: number;
  status: string;
  clearedStages: number[]; // các ải đã qua
  stars: Record<number, number>; // số sao mỗi ải
}

@Injectable()
export class KnightService {
  constructor(private readonly prisma: PrismaService) {}

  /** Danh sách nhân vật của người chơi (kèm tiến trình) để chọn chơi tiếp / tạo mới. */
  async listCharacters(user: CurrentUser): Promise<CharacterDto[]> {
    const rows = await this.prisma.knightCharacter.findMany({
      where: { ownerUserId: BigInt(user.id) },
      orderBy: { updatedAt: 'desc' },
      include: { progress: true },
    });
    return rows.map(toDto);
  }

  async createCharacter(user: CurrentUser, body: { name?: string; gender?: string; age?: unknown; notes?: string }): Promise<CharacterDto> {
    const name = String(body.name ?? '').trim().slice(0, 60) || 'Hiệp sĩ nhí';
    const gender = body.gender === 'girl' ? 'girl' : 'boy';
    const age = clampAge(Number(body.age));
    const notes = String(body.notes ?? '').trim().slice(0, 300);
    const row = await this.prisma.knightCharacter.create({
      data: { ownerUserId: BigInt(user.id), name, gender, age, notes, currentStage: 1, hp: MAX_HP, status: 'ACTIVE' },
      include: { progress: true },
    });
    return toDto(row);
  }

  /** Lấy nhân vật thuộc sở hữu của user; null nếu không tồn tại hoặc không phải của user (chống IDOR). */
  async getOwned(user: CurrentUser, characterId: bigint): Promise<CharacterDto | null> {
    const row = await this.prisma.knightCharacter.findUnique({ where: { id: characterId }, include: { progress: true } });
    if (!row || row.ownerUserId !== BigInt(user.id)) return null;
    return toDto(row);
  }

  async deleteCharacter(user: CurrentUser, characterId: bigint): Promise<boolean> {
    const row = await this.prisma.knightCharacter.findUnique({ where: { id: characterId } });
    if (!row || row.ownerUserId !== BigInt(user.id)) return false;
    await this.prisma.knightCharacter.delete({ where: { id: characterId } });
    return true;
  }

  /**
   * Lưu tiến trình sau mỗi màn. Cập nhật máu/trạng thái/màn hiện tại của nhân vật,
   * và ghi lịch sử ải nếu vừa vượt qua (upsert theo khoá chính xác [character, stage]).
   */
  async saveProgress(
    user: CurrentUser,
    characterId: bigint,
    input: { stage?: unknown; hp?: unknown; status?: unknown; cleared?: unknown; stars?: unknown; mobIndex?: unknown },
  ): Promise<CharacterDto | null> {
    const existing = await this.prisma.knightCharacter.findUnique({ where: { id: characterId } });
    if (!existing || existing.ownerUserId !== BigInt(user.id)) return null;

    const stage = clampStage(Number(input.stage));
    const hp = clampHp(Number(input.hp));
    const cleared = input.cleared === true || input.cleared === 'true';
    const stars = clampStars(Number(input.stars));

    // Trạng thái: hết máu -> nghỉ ngơi; qua ải cuối -> chiến thắng; còn lại -> đang chơi.
    // mobIndex: đã đánh tới con quái thứ mấy (qua ải/nghỉ -> về 0; đang chơi -> lưu vị trí).
    let status: string;
    let currentStage: number;
    let mobIndex: number;
    if (cleared && stage >= MAX_STAGE) {
      status = 'VICTORY';
      currentStage = MAX_STAGE;
      mobIndex = 0;
    } else if (cleared) {
      status = 'ACTIVE';
      currentStage = stage + 1;
      mobIndex = 0;
    } else if (hp <= 0) {
      status = 'RESTING';
      currentStage = stage; // chơi lại đúng màn hiện tại từ con quái đầu
      mobIndex = 0;
    } else {
      status = String(input.status) === 'RESTING' ? 'RESTING' : 'ACTIVE';
      currentStage = stage;
      mobIndex = clampMob(Number(input.mobIndex));
    }

    const updates: Prisma.PrismaPromise<unknown>[] = [
      this.prisma.knightCharacter.update({
        where: { id: characterId },
        data: { hp, status, currentStage, mobIndex },
      }),
    ];
    if (cleared) {
      updates.push(
        this.prisma.knightProgress.upsert({
          where: { characterId_stageNumber: { characterId, stageNumber: stage } },
          create: { characterId, stageNumber: stage, status: 'CLEARED', stars, attempts: 1 },
          update: { status: 'CLEARED', stars: { set: stars }, attempts: { increment: 1 } },
        }),
      );
    }
    await this.prisma.$transaction(updates);
    return this.getOwned(user, characterId);
  }
}

// prisma trả về mảng progress; row có kiểu suy ra nên dùng any-lite cục bộ.
function toDto(row: {
  id: bigint;
  name: string;
  gender: string;
  age: number;
  notes: string;
  currentStage: number;
  mobIndex: number;
  hp: number;
  status: string;
  progress: Array<{ stageNumber: number; stars: number; status: string }>;
}): CharacterDto {
  const clearedStages = row.progress.filter((p) => p.status === 'CLEARED').map((p) => p.stageNumber).sort((a, b) => a - b);
  const stars: Record<number, number> = {};
  for (const p of row.progress) stars[p.stageNumber] = p.stars;
  return {
    id: String(row.id),
    name: row.name,
    gender: row.gender,
    age: row.age,
    notes: row.notes,
    currentStage: row.currentStage,
    mobIndex: row.mobIndex,
    hp: row.hp,
    status: row.status,
    clearedStages,
    stars,
  };
}

function clampAge(n: number): number {
  if (!Number.isFinite(n)) return 5;
  return Math.max(4, Math.min(7, Math.round(n)));
}
function clampStage(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(MAX_STAGE, Math.round(n)));
}
function clampHp(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(MAX_HP, Math.round(n)));
}
function clampStars(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(3, Math.round(n)));
}
function clampMob(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(20, Math.round(n)));
}

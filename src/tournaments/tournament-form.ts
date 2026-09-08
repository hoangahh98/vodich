import { normalizePairingRule, oneOf, PLAY_TYPES, TOURNAMENT_FORMATS } from '../common/enums';
import { parseMoney } from '../common/money';

/** Phần "Thông tin giải": form tạo giải chỉ có đúng chừng này; mọi thứ khác sửa ở Cài đặt sau khi tạo. */
export function buildTournamentInfo(form: Record<string, unknown>) {
  return {
    name: String(form.name || '').trim(),
    venue: String(form.venue || '').trim(),
    startTime: form.startTime ? new Date(String(form.startTime)) : null,
    endTime: form.endTime ? new Date(String(form.endTime)) : null,
    courtCount: Math.max(1, Number(form.courtCount || 1)),
    expectedPlayers: Math.max(1, Number(form.expectedPlayers || 1)),
    externalRegistrationEnabled: form.externalRegistrationEnabled === 'on',
  };
}

/** Phần "Cấu hình" ở Cài đặt: thể thức, điểm, lệ phí + chi phí, giải thưởng. */
export function buildTournamentConfig(form: Record<string, unknown>, prizes: number[], expectedPlayers: number) {
  const format = oneOf(form.format, TOURNAMENT_FORMATS, 'ROUND_ROBIN');
  // Đôi xoay vòng luôn là đánh ĐÔI: mỗi trận 4 người và cả thể thức xoay quanh việc đổi bạn
  // đánh cặp. Để lọt "đánh đơn" vào đây là dựng ra một giải không sinh nổi lịch đúng, nên ép
  // ngay từ lúc lưu thay vì đi kiểm tra rải rác về sau.
  const playType = format === 'AMERICANO' ? 'DOUBLES' : oneOf(form.playType, PLAY_TYPES, 'SINGLES');
  return {
    playType,
    format,
    pairingRule: normalizePairingRule(form.pairingRule),
    knockoutQualifierCount: normalizeQualifierCount(Number(form.knockoutQualifierCount || 2), Math.max(1, expectedPlayers), playType),
    touchScore: Math.max(1, Number(form.touchScore || 11)),
    maxScore: Math.max(1, Number(form.maxScore || 15)),
    knockoutTouchScore: Math.max(1, Number(form.knockoutTouchScore || 15)),
    knockoutMaxScore: Math.max(1, Number(form.knockoutMaxScore || 19)),
    feePerPlayer: parseMoney(form.feePerPlayer),
    courtCost: parseMoney(form.courtCost),
    foodCost: parseMoney(form.foodCost),
    prizeCost: parseMoney(form.prizeCost),
    otherCost: parseMoney(form.otherCost),
    prizeRate1: prizes[0],
    prizeRate2: prizes[1],
    prizeRate3: prizes[2],
  };
}

/** Cả hai phần gộp lại — dùng lúc TẠO giải (form tạo chỉ gửi thông tin, phần còn lại lấy mặc định). */
export function buildTournamentData(form: Record<string, unknown>, prizes: number[]) {
  const info = buildTournamentInfo(form);
  return { ...info, ...buildTournamentConfig(form, prizes, info.expectedPlayers) };
}

/**
 * Vòng trong cần tối thiểu bao nhiêu đội: bán kết cần 2 bảng (6 đội = 2 bảng 3, hoặc 3 + 4),
 * tứ kết cần 4 bảng (12 đội). Trước đây đòi 8 / 16 đội nên giải 6–7 đội không chọn được bán kết
 * dù chia hai bảng là hợp lý — chủ app đã yêu cầu nới (9/2026). Khớp `data-min-teams` ở form.
 */
export const KNOCKOUT_MIN_TEAMS = { semi: 6, quarter: 12 } as const;

export function normalizeQualifierCount(value: number, expectedPlayers = 16, playType = 'SINGLES') {
  const estimatedTeams = playType === 'DOUBLES' ? Math.floor(expectedPlayers / 2) : expectedPlayers;
  if (value >= 8 && estimatedTeams >= KNOCKOUT_MIN_TEAMS.quarter) return 8;
  if (value >= 4 && estimatedTeams >= KNOCKOUT_MIN_TEAMS.semi) return 4;
  return 2;
}

/**
 * Tiền thưởng thủ công KHÔNG bị chặn theo quỹ thưởng hiện có. Lúc tạo giải chưa ai đóng phí nên
 * quỹ luôn là 0đ — chặn ở đây là không thể tạo giải với mức thưởng dự kiến (chủ app nhập 200.000đ
 * là bị từ chối ngay). Quỹ tăng dần theo đóng phí; màn hình quỹ và form sửa vẫn hiện cảnh báo
 * "còn lại" âm để ban tổ chức tự cân đối.
 */
export function normalizePrizes(form: Record<string, unknown>) {
  const values = [prizeValue(form.prizeRate1, 50), prizeValue(form.prizeRate2, 30), prizeValue(form.prizeRate3, 20)];
  if (String(form.prizeMode || 'percent') === 'manual') {
    return values.map((value) => Math.max(0, value));
  }
  let remaining = 100;
  return values.map((value) => {
    const next = Math.min(Math.max(0, value), remaining);
    remaining -= next;
    return next;
  });
}

export function operatingCostFromForm(form: Record<string, unknown>) {
  return parseMoney(form.courtCost) + parseMoney(form.foodCost) + parseMoney(form.otherCost);
}

function prizeValue(value: unknown, fallback: number) {
  if (value === null || value === undefined || String(value).trim() === '') return fallback;
  return parseMoney(value) || 0;
}

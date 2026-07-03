import { parseMoney } from '../common/money';

export function buildTournamentData(form: Record<string, unknown>, prizes: number[]) {
  return {
    name: String(form.name || '').trim(),
    venue: String(form.venue || '').trim(),
    startTime: form.startTime ? new Date(String(form.startTime)) : null,
    endTime: form.endTime ? new Date(String(form.endTime)) : null,
    courtCount: Math.max(1, Number(form.courtCount || 1)),
    expectedPlayers: Math.max(1, Number(form.expectedPlayers || 1)),
    playType: String(form.playType || 'SINGLES'),
    format: String(form.format || 'ROUND_ROBIN'),
    knockoutQualifierCount: normalizeQualifierCount(Number(form.knockoutQualifierCount || 2), Math.max(1, Number(form.expectedPlayers || 1)), String(form.playType || 'SINGLES')),
    touchScore: Math.max(1, Number(form.touchScore || 11)),
    maxScore: Math.max(1, Number(form.maxScore || 15)),
    knockoutTouchScore: Math.max(1, Number(form.knockoutTouchScore || 15)),
    knockoutMaxScore: Math.max(1, Number(form.knockoutMaxScore || 19)),
    courtCost: parseMoney(form.courtCost),
    foodCost: parseMoney(form.foodCost),
    prizeCost: parseMoney(form.prizeCost),
    otherCost: parseMoney(form.otherCost),
    prizeRate1: prizes[0],
    prizeRate2: prizes[1],
    prizeRate3: prizes[2],
    externalRegistrationEnabled: form.externalRegistrationEnabled === 'on',
  };
}

export function normalizeQualifierCount(value: number, expectedPlayers = 16, playType = 'SINGLES') {
  const estimatedTeams = playType === 'DOUBLES' ? Math.floor(expectedPlayers / 2) : expectedPlayers;
  if (value >= 8 && estimatedTeams >= 16) return 8;
  if (value >= 4 && estimatedTeams >= 8) return 4;
  return 2;
}

export function normalizePrizes(form: Record<string, unknown>, availablePrizeFund: number) {
  const values = [prizeValue(form.prizeRate1, 50), prizeValue(form.prizeRate2, 30), prizeValue(form.prizeRate3, 20)];
  if (String(form.prizeMode || 'percent') === 'manual') {
    const total = values.reduce((sum, value) => sum + value, 0);
    if (total > availablePrizeFund) {
      throw new Error(`Tổng tiền thưởng thủ công không được vượt quá quỹ thưởng hiện có (${availablePrizeFund.toLocaleString('en-US')}đ).`);
    }
    return values;
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

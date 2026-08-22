import { MatchGame, Tournament, TournamentRegistration } from '@prisma/client';
import { PairingRule, normalizePairingRule } from '../common/enums';
import { RankingGroup, compareRankingRows } from './tournament-ranking';
import { WAITING_PARTNER, formatTeamName, splitTeamName } from './team-name';

export type MatchCreate = {
  tournamentId: bigint;
  teamA: string;
  teamB: string;
  courtNumber: number;
  roundNumber: number;
  stage: string;
  groupName?: string | null;
};

type RegisteredPlayer = TournamentRegistration & { player: { displayName: string } | null };

/** Tên vòng của thể thức Đôi xoay vòng (Americano). */
export const AMERICANO_STAGE = 'Xoay vòng';

/** Mọi vòng đấu tính vào bảng xếp hạng (khác với các vòng loại trực tiếp phía sau). */
export const RANKED_STAGES = ['Vòng bảng', 'Vòng tròn', AMERICANO_STAGE];

/**
 * Trận này có thuộc vòng loại trực tiếp không (tứ kết/bán kết/chung kết)?
 *
 * Suy ra từ `RANKED_STAGES` chứ không liệt kê tay từng tên vòng: trước đây ba chỗ (gateway ghi
 * điểm và hai view lịch) đều tự viết `stage !== 'Vòng bảng' && stage !== 'Vòng tròn'`, nên
 * thêm một thể thức mới là cả ba lặng lẽ coi nó là vòng trong rồi chấm điểm sai luật.
 */
export function isKnockoutStage(stage: string): boolean {
  return !RANKED_STAGES.includes(stage);
}

export class TournamentScheduleBuilder {
  fromRegistrations(tournament: Tournament, registrations: RegisteredPlayer[]): MatchCreate[] {
    const rule = normalizePairingRule(tournament.pairingRule);
    // Americano tự lo toàn bộ lịch: đội đổi sau mỗi vòng nên không đi qua đường "dựng đội một
    // lần rồi đấu vòng tròn" như hai thể thức kia.
    if (tournament.format === 'AMERICANO') return buildAmericanoMatches(tournament, registrations, rule);
    // Đơn: mỗi người một "đội", chỉ cần xáo thứ tự. Đôi: ghép theo `rule` rồi mới xáo thứ tự
    // đội để rải sân/vòng.
    const teams =
      tournament.playType === 'DOUBLES'
        ? shuffle(buildDoublesTeams(registrations, rule))
        : shuffle(registrations.map(displayRegistrationName));
    return this.fromTeams(tournament, teams);
  }

  fromManualPairs(tournament: Tournament, pairNames: string[]): MatchCreate[] {
    return this.fromTeams(
      tournament,
      pairNames.map((name) => name.trim()).filter(Boolean),
    );
  }

  private fromTeams(tournament: Tournament, teams: string[]): MatchCreate[] {
    const groupMatches = buildGroupMatches(tournament, teams);
    const knockout = tournament.format === 'GROUP_KNOCKOUT' ? buildKnockout(tournament) : [];
    return [...groupMatches, ...knockout];
  }
}

export function knockoutSeeds(qualifierCount: number, rankingGroups: RankingGroup[]) {
  const byGroup = new Map(rankingGroups.map((group) => [group.groupName, group.rows]));
  if (qualifierCount >= 8) {
    return [
      byGroup.get('A')?.[0]?.teamName,
      byGroup.get('B')?.[1]?.teamName,
      byGroup.get('B')?.[0]?.teamName,
      byGroup.get('A')?.[1]?.teamName,
      byGroup.get('C')?.[0]?.teamName,
      byGroup.get('D')?.[1]?.teamName,
      byGroup.get('D')?.[0]?.teamName,
      byGroup.get('C')?.[1]?.teamName,
    ].filter(Boolean) as string[];
  }
  if (qualifierCount >= 4) {
    return [
      byGroup.get('A')?.[0]?.teamName,
      byGroup.get('B')?.[1]?.teamName,
      byGroup.get('B')?.[0]?.teamName,
      byGroup.get('A')?.[1]?.teamName,
    ].filter(Boolean) as string[];
  }
  return rankingGroups.flatMap((group) => group.rows).sort(compareRankingRows).slice(0, 2).map((row) => row.teamName);
}

export function finishedStageWinners(matches: MatchGame[], stage: string): string[] | null {
  const stageMatches = matches.filter((match) => match.stage === stage).sort((a, b) => a.courtNumber - b.courtNumber || Number(a.id - b.id));
  if (!stageMatches.length || stageMatches.some((match) => match.status !== 'FINISHED')) return null;
  return stageMatches.map((match) => (match.scoreA > match.scoreB ? match.teamA : match.teamB));
}

function displayRegistrationName(reg: RegisteredPlayer) {
  return reg.player?.displayName || reg.externalName || reg.externalEmail || 'Chưa đặt tên';
}

/**
 * Ghép đội THỦ CÔNG cố định mấy đội, còn lại để máy ghép nốt theo `pairingRule` của giải.
 *
 * Ban tổ chức thường chỉ muốn chốt cứng vài cặp (hai vợ chồng, hai người đi cùng xe...) rồi
 * để phần còn lại chia theo trình. Trước đây ai không được chọn thì bị BỎ HẲN khỏi lịch, còn
 * ô nào chỉ chọn một người thì thành "đội" một người đi đánh đôi — cả hai đều là lỗi.
 *
 * Quy ước: chỉ đội chọn ĐỦ HAI người mới là đội cố định. Ô lẻ (mới chọn một người) coi như
 * chưa ghép, người đó rơi vào rổ ghép tự động — cần cố định thì chọn nốt người thứ hai.
 *
 * Đối chiếu theo TÊN HIỂN THỊ vì màn ghép thủ công gửi lên tên chứ không gửi id.
 */
export function completeManualTeams(manualTeams: string[], registrations: RegisteredPlayer[], rule: PairingRule): string[] {
  const fixed = manualTeams.filter((team) => splitTeamName(team).length >= 2);
  const taken = new Set(fixed.flatMap((team) => splitTeamName(team)));
  // Người bị bỏ ra khỏi mọi đội cố định — kể cả người đứng lẻ trong một ô ghép dở.
  const loose = registrations.filter((reg) => !taken.has(displayRegistrationName(reg)));
  return [...fixed, ...buildDoublesTeams(loose, rule)];
}

/**
 * Ghép đội đôi theo quy tắc của giải. Một cửa vào duy nhất để nơi gọi không phải tự nhớ
 * `rule` nào ứng với hàm nào.
 */
export function buildDoublesTeams(registrations: RegisteredPlayer[], rule: PairingRule): string[] {
  return rule === 'RANDOM' ? buildRandomDoublesTeams(registrations) : buildBalancedDoublesTeams(registrations);
}

/** Ghép đội đôi KHÔNG phân trình: xáo thuần rồi bắt cặp liền kề. */
export function buildRandomDoublesTeams(registrations: RegisteredPlayer[]): string[] {
  const teams: string[] = [];
  const leftover = pairWithin(registrations, teams);
  if (leftover.length) teams.push(formatTeamName(displayRegistrationName(leftover[0]), WAITING_PARTNER));
  return teams;
}

/**
 * Ghép đội đôi CÂN BẰNG theo trình. Gom người theo trình, sắp các mức trình mạnh→yếu rồi
 * "gấp đôi" hai đầu vào nhau: mức mạnh nhất đấu chung đội với mức yếu nhất, cứ thế vào giữa.
 *
 *   1 mức trình         -> ghép random trong mức đó (ví dụ chỉ có C).
 *   2 mức (vd C, D)      -> C ghép D (cao ghép thấp).
 *   3 mức (vd A, B, C)   -> A(cao nhất) ghép C(thấp nhất), B(giữa) ghép với nhau.
 *   4 mức (A, B, C, D)   -> A ghép D, B ghép C.
 *
 * Trình rỗng/không rõ gom thành một mức, xếp yếu nhất. Số người trong hai mức ghép chéo lệch
 * nhau, hoặc mức giữa lẻ người, thì phần dư được GẤP LẠI TỪ ĐẦU theo đúng quy tắc trên chứ
 * không đổ chung một rổ bốc bừa: rổ chung khiến mấy người mạnh dư ra tự ghép với nhau thành
 * một đội vượt trội — đúng thứ mà "phân trình" sinh ra để tránh (5A + 3B + 1D từng ra một đội
 * A/A trong khi bên B vẫn còn người để ghép). Lẻ đúng 1 người cả giải thì để "Chờ thành viên".
 */
export function buildBalancedDoublesTeams(registrations: RegisteredPlayer[]): string[] {
  const teams: string[] = [];
  let pool: RegisteredPlayer[] = registrations;
  while (pool.length > 1) {
    const rest = foldByLevel(pool, teams);
    // Mỗi lượt gấp luôn bốc được ít nhất một đội nên vòng lặp chắc chắn dừng; điều kiện này chỉ
    // là chốt chặn để một thay đổi sau này không lặng lẽ biến nó thành vòng lặp vô tận.
    if (rest.length >= pool.length) return finishWithWaiting(rest, teams);
    pool = rest;
  }
  return finishWithWaiting(pool, teams);
}

/** Người lẻ cuối cùng của cả giải (nếu có) giữ chỗ "Chờ thành viên" thay vì bị bỏ rơi. */
function finishWithWaiting(pool: RegisteredPlayer[], teams: string[]): string[] {
  if (pool.length) teams.push(formatTeamName(displayRegistrationName(pool[0]), WAITING_PARTNER));
  return teams;
}

/** Một lượt gấp: gom theo trình, ghép mức mạnh nhất với mức yếu nhất rồi tiến dần vào giữa. */
function foldByLevel(players: RegisteredPlayer[], teams: string[]): RegisteredPlayer[] {
  const byLevel = new Map<string, RegisteredPlayer[]>();
  for (const reg of players) {
    const level = normalizeSkill(reg.skillLevel);
    const bucket = byLevel.get(level);
    if (bucket) bucket.push(reg);
    else byLevel.set(level, [reg]);
  }
  const levels = [...byLevel.keys()].sort((a, b) => skillRank(a) - skillRank(b) || a.localeCompare(b));
  const leftovers: RegisteredPlayer[] = [];
  let lo = 0;
  let hi = levels.length - 1;
  while (lo < hi) {
    leftovers.push(...pairAcross(byLevel.get(levels[lo]) || [], byLevel.get(levels[hi]) || [], teams));
    lo++;
    hi--;
  }
  // Số mức lẻ -> còn mức GIỮA đứng một mình (cũng là trường hợp "chỉ 1 mức trình"): ghép random
  // trong mức đó.
  if (lo === hi) leftovers.push(...pairWithin(byLevel.get(levels[lo]) || [], teams));
  return leftovers;
}

/** Ghép chéo hai mức trình: mỗi đội một người mức mạnh + một người mức yếu. Trả người dư. */
function pairAcross(strong: RegisteredPlayer[], weak: RegisteredPlayer[], teams: string[]): RegisteredPlayer[] {
  const s = shuffle(strong);
  const w = shuffle(weak);
  const paired = Math.min(s.length, w.length);
  for (let i = 0; i < paired; i++) teams.push(formatTeamName(displayRegistrationName(s[i]), displayRegistrationName(w[i])));
  return [...s.slice(paired), ...w.slice(paired)];
}

/** Ghép random trong cùng một nhóm (mức trình giữa, hoặc gom người lẻ). Trả người lẻ cuối. */
function pairWithin(list: RegisteredPlayer[], teams: string[]): RegisteredPlayer[] {
  const s = shuffle(list);
  for (let i = 0; i + 1 < s.length; i += 2) teams.push(formatTeamName(displayRegistrationName(s[i]), displayRegistrationName(s[i + 1])));
  return s.length % 2 ? [s[s.length - 1]] : [];
}

/** Trình chuẩn hoá về chữ hoa; rỗng/không rõ gom về '?'. */
function normalizeSkill(raw: string | null): string {
  return String(raw || '').trim().toUpperCase() || '?';
}

/** Thứ tự mạnh→yếu: A<B<C<D; trình lạ/không rõ xếp yếu nhất. */
function skillRank(level: string): number {
  const index = 'ABCD'.indexOf(level);
  return index >= 0 ? index : 100;
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

type AmericanoPlayer = { index: number; name: string; skill: number };
type AmericanoPair = { first: AmericanoPlayer; second: AmericanoPlayer; strength: number };

/**
 * Số trận của một giải ĐÔI đánh vòng tròn thường: n người ghép thành `n/2` đội cố định, mỗi
 * đội gặp nhau một lần. Đây là mốc để giải Americano dài bằng đúng một buổi như mọi khi.
 */
export function roundRobinDoublesMatchCount(playerCount: number): number {
  const teams = Math.floor(playerCount / 2);
  return teams < 2 ? 0 : (teams * (teams - 1)) / 2;
}

/**
 * Số người tối đa mà MỘT VĐV được đánh chung đội trong giải Americano.
 *
 * Không để mọi người ghép với tất cả: 10 người mà ghép hết thì ra 45 cặp ≈ 22 trận, đánh cả
 * ngày không hết. Chặn ở `(n-2)/2` để tổng số trận bằng đúng giải vòng tròn thường — 10 người
 * thì mỗi người ghép tối đa 4 người, ra 10 trận, y như 5 đội cố định đấu vòng tròn.
 *
 * Suy ra từ đâu: mỗi người ghép k người → tổng `n*k/2` cặp → `n*k/4` trận. Cho bằng số trận
 * vòng tròn `n(n-2)/8` thì k = (n-2)/2.
 */
export function americanoPartnerLimit(playerCount: number): number {
  return Math.max(1, Math.floor((playerCount - 2) / 2));
}

/**
 * Thể thức "Đôi xoay vòng (Americano)": mỗi VĐV lần lượt đánh CHUNG ĐỘI với những người khác
 * nhau, thay vì cố định đội từ đầu giải.
 *
 * Cách làm: dùng vòng quay của `roundRobinRounds` để mỗi vòng ai cũng có đúng một người đánh
 * chung, rồi ghép hai cặp thành một trận. Chỉ lấy `americanoPartnerLimit()` vòng đầu, và cắt
 * tổng số trận về đúng bằng một giải vòng tròn thường (xem hai hàm ngay trên).
 *
 * Phần dư: số cặp trong một vòng có thể là số lẻ (10 người -> 5 cặp), cặp lẻ ấy được dồn sang
 * các vòng phụ cuối giải chứ không mất.
 */
export function buildAmericanoMatches(tournament: Tournament, registrations: RegisteredPlayer[], rule: PairingRule): MatchCreate[] {
  const players: AmericanoPlayer[] = registrations.map((reg, index) => ({
    index,
    name: displayRegistrationName(reg),
    skill: skillRank(normalizeSkill(reg.skillLevel)),
  }));
  // Dưới 4 người thì không có nổi một trận đôi nào, trả lịch rỗng thay vì dựng trận nửa vời.
  if (players.length < 4) return [];

  const matches: MatchCreate[] = [];
  const targetMatchCount = roundRobinDoublesMatchCount(players.length);
  let court = 1;
  americanoRounds(players, rule).forEach((round, roundIndex) => {
    for (const [teamA, teamB] of round) {
      if (matches.length >= targetMatchCount) return;
      matches.push({
        tournamentId: tournament.id,
        teamA: pairName(teamA),
        teamB: pairName(teamB),
        courtNumber: court,
        roundNumber: roundIndex + 1,
        stage: AMERICANO_STAGE,
        groupName: null,
      });
      court = court >= tournament.courtCount ? 1 : court + 1;
    }
  });
  return matches;
}

/** Số cách xếp chỗ thử trước khi chọn cách cân nhất. 200 lượt chạy dưới 1ms, đủ để hơn hẳn. */
const AMERICANO_SEATING_TRIES = 200;

/**
 * Các vòng ghép cặp tính theo CHỈ SỐ GHẾ (chưa biết ai ngồi ghế nào).
 *
 * Tách riêng để chấm điểm một cách xếp chỗ mà không phải dựng lại vòng quay mỗi lần thử.
 * Lẻ người thì `roundRobinRounds` tự chèn chỗ trống và bỏ qua cặp dính chỗ trống đó.
 */
function seatPairRounds(playerCount: number): [number, number][][] {
  return roundRobinRounds(Array.from({ length: playerCount }, (_, index) => String(index)))
    .slice(0, americanoPartnerLimit(playerCount))
    .map((round) => round.map(([first, second]) => [Number(first), Number(second)] as [number, number]));
}

/**
 * Ai ngồi ghế nào — chính là chỗ `pairingRule` có tác dụng trong thể thức Americano.
 *
 * Vòng quay `seatPairRounds` cố định theo CHỈ SỐ ghế, nên thứ duy nhất còn quyết định "ai đánh
 * chung đội với ai" là hoán vị người vào ghế. Trước đây cả hai rule đều dùng nguyên thứ tự đăng
 * ký, kéo theo hai lỗi cùng lúc: "phân trình" chẳng ảnh hưởng gì tới việc ghép cặp, và bấm
 * "Chia trận" mười lần ra y hệt nhau mười lần (nhìn cứ như nút bị hỏng).
 *
 *  - `RANDOM`   — xáo thuần, mỗi lần chia là một kèo khác.
 *  - `BY_SKILL` — bốc thử `AMERICANO_SEATING_TRIES` cách xếp rồi giữ cách cho các cặp cân sức
 *                 nhất. Vẫn ngẫu nhiên (nhiều cách xếp cùng điểm) nên chia lại vẫn ra kèo khác,
 *                 mà phương sai tổng trình mỗi cặp giảm khoảng một nửa so với xếp theo thứ tự.
 */
function americanoSeating(players: AmericanoPlayer[], rule: PairingRule, rounds: [number, number][][]): AmericanoPlayer[] {
  let best = shuffle(players);
  if (rule !== 'BY_SKILL') return best;
  let bestScore = seatingImbalance(best, rounds);
  for (let attempt = 1; attempt < AMERICANO_SEATING_TRIES && bestScore > 0; attempt++) {
    const candidate = shuffle(players);
    const score = seatingImbalance(candidate, rounds);
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

/** Phương sai tổng trình của mọi cặp mà cách xếp chỗ này sinh ra — càng nhỏ thì kèo càng cân. */
function seatingImbalance(seats: AmericanoPlayer[], rounds: [number, number][][]): number {
  const totals: number[] = [];
  for (const round of rounds) for (const [first, second] of round) totals.push(seats[first].skill + seats[second].skill);
  if (!totals.length) return 0;
  const mean = totals.reduce((sum, value) => sum + value, 0) / totals.length;
  return totals.reduce((sum, value) => sum + (value - mean) ** 2, 0) / totals.length;
}

/**
 * Chia toàn bộ cặp có thể thành từng vòng, mỗi vòng là danh sách trận (hai cặp một trận).
 *
 * Dùng ĐÚNG thuật toán vòng tròn của `roundRobinRounds`, chỉ khác cách đọc kết quả: ở giải
 * thường mỗi kết quả `[x, y]` là "x ĐẤU VỚI y", ở đây là "x ĐÁNH CHUNG ĐỘI với y". Nhờ vậy mỗi
 * vòng chắc chắn dùng hết mọi người đúng một lần và sau n-1 vòng thì mọi cặp đều đã xuất hiện.
 *
 * KHÔNG dùng cách tham lam "bốc dần từ rổ mọi cặp": nó không đảm bảo mỗi vòng phủ hết người,
 * nên có lần 8 người chỉ ra 13 trận thay vì 14 — đã bị test bắt tại chỗ.
 *
 * Ghép trên CHỈ SỐ chứ không trên tên: hai VĐV trùng tên hiển thị vẫn phải là hai người.
 */
function americanoRounds(players: AmericanoPlayer[], rule: PairingRule): [AmericanoPair, AmericanoPair][][] {
  const rounds: [AmericanoPair, AmericanoPair][][] = [];
  // Cặp bị lẻ ra ở mỗi vòng (số cặp trong vòng là số lẻ) — dồn lại đấu ở các vòng phụ cuối giải.
  const spillover: AmericanoPair[] = [];
  // Mỗi vòng cho mỗi người thêm ĐÚNG một người đánh chung, nên số vòng chính là số người tối đa
  // được ghép cặp. Cắt ở đây thay vì cắt trận ở cuối để không ai bị ghép quá hạn mức.
  const partnerRounds = seatPairRounds(players.length);
  const seats = americanoSeating(players, rule, partnerRounds);

  for (const [roundIndex, roundPairs] of partnerRounds.entries()) {
    const pairs = roundPairs.map(([first, second]) => makePair(seats[first], seats[second]));
    // Lẻ một cặp thì phải hoãn một cặp sang vòng phụ. CHỌN cặp không dùng chung người với những
    // cặp đã hoãn trước đó: các cặp hoãn mà rời nhau thì vòng phụ ghép được thành trận, còn dồn
    // toàn cặp chung người thì chúng kẹt lại và giải bị hụt trận.
    if (pairs.length % 2) {
      const held = new Set(spillover.flatMap((pair) => [pair.first.index, pair.second.index]));
      const free = pairs.findIndex((pair) => !held.has(pair.first.index) && !held.has(pair.second.index));
      spillover.push(...pairs.splice(free >= 0 ? free : roundIndex % pairs.length, 1));
    }
    const round = toMatches(pairs, rule);
    if (round.length) rounds.push(round);
  }

  rounds.push(...spilloverRounds(spillover, rule));
  return rounds;
}

/**
 * Xếp nốt các cặp bị hoãn: mỗi vòng phụ bốc ra những cặp không dùng chung người rồi ghép thành
 * trận. Dừng khi không còn bốc nổi hai cặp rời nhau — phần dư cuối cùng là giới hạn số học của
 * thể thức (xem ghi chú ở buildAmericanoMatches), không phải lỗi.
 */
function spilloverRounds(pairs: AmericanoPair[], rule: PairingRule): [AmericanoPair, AmericanoPair][][] {
  const rounds: [AmericanoPair, AmericanoPair][][] = [];
  let pool = pairs;

  while (pool.length > 1) {
    const used = new Set<number>();
    const picked: AmericanoPair[] = [];
    const rest: AmericanoPair[] = [];
    for (const pair of pool) {
      if (used.has(pair.first.index) || used.has(pair.second.index)) {
        rest.push(pair);
        continue;
      }
      used.add(pair.first.index);
      used.add(pair.second.index);
      picked.push(pair);
    }
    if (picked.length < 2) break;
    if (picked.length % 2) rest.push(picked.pop() as AmericanoPair);
    rounds.push(toMatches(picked, rule));
    pool = rest;
  }

  return rounds;
}

/**
 * Ghép các cặp của một vòng thành trận. `BY_SKILL` sắp theo tổng trình rồi ghép hai cặp liền
 * kề, tức là hai cặp cân sức nhất gặp nhau; `RANDOM` bốc ngẫu nhiên.
 */
function toMatches(pairs: AmericanoPair[], rule: PairingRule): [AmericanoPair, AmericanoPair][] {
  const ordered = rule === 'BY_SKILL' ? [...pairs].sort((a, b) => a.strength - b.strength) : shuffle(pairs);
  const matches: [AmericanoPair, AmericanoPair][] = [];
  for (let index = 0; index + 1 < ordered.length; index += 2) matches.push([ordered[index], ordered[index + 1]]);
  return matches;
}

/** `strength` = tổng trình của hai người, dùng để cho hai cặp cân sức gặp nhau. */
function makePair(first: AmericanoPlayer, second: AmericanoPlayer): AmericanoPair {
  return { first, second, strength: first.skill + second.skill };
}

function pairName(pair: AmericanoPair): string {
  return formatTeamName(pair.first.name, pair.second.name);
}

function buildGroupMatches(tournament: Tournament, teams: string[]): MatchCreate[] {
  const stage = tournament.format === 'GROUP_KNOCKOUT' ? 'Vòng bảng' : 'Vòng tròn';
  const groups = tournament.format === 'GROUP_KNOCKOUT' ? splitGroups(teams, groupCountFor(tournament, teams.length)) : [teams];
  const matches: MatchCreate[] = [];
  const groupRounds = groups.map((groupTeams, groupIndex) => {
    const groupName = String.fromCharCode('A'.charCodeAt(0) + groupIndex);
    return roundRobinRounds(groupTeams).map((roundMatches) =>
      roundMatches.map(([teamA, teamB]) => ({ tournamentId: tournament.id, teamA, teamB, stage, groupName })),
    );
  });
  const maxRound = groupRounds.reduce((max, rounds) => Math.max(max, rounds.length), 0);
  for (let roundIndex = 0; roundIndex < maxRound; roundIndex++) {
    let court = 1;
    for (const rounds of groupRounds) {
      const roundMatches = rounds[roundIndex] || [];
      for (const match of roundMatches) {
        matches.push({ ...match, courtNumber: court, roundNumber: roundIndex + 1 });
        court = court >= tournament.courtCount ? 1 : court + 1;
      }
    }
  }
  return matches;
}

function roundRobinRounds(teams: string[]): [string, string][][] {
  const rotated = teams.filter(Boolean);
  if (rotated.length < 2) return [];
  if (rotated.length % 2 === 1) rotated.push('');
  const rounds: [string, string][][] = [];
  const count = rotated.length;
  for (let round = 0; round < count - 1; round++) {
    const matches: [string, string][] = [];
    for (let index = 0; index < count / 2; index++) {
      const teamA = rotated[index];
      const teamB = rotated[count - 1 - index];
      if (teamA && teamB) matches.push(round % 2 === 0 ? [teamA, teamB] : [teamB, teamA]);
    }
    rounds.push(matches);
    rotated.splice(1, 0, rotated.pop() || '');
  }
  return rounds;
}

function buildKnockout(tournament: Tournament): MatchCreate[] {
  const matches: MatchCreate[] = [];
  let previous = '';
  if (tournament.knockoutQualifierCount >= 8) {
    matches.push(...stageMatches(tournament, 'Tứ kết', 100, ['Nhất A', 'Nhì B', 'Nhất B', 'Nhì A', 'Nhất C', 'Nhì D', 'Nhất D', 'Nhì C']));
    previous = 'Tứ kết';
  }
  if (tournament.knockoutQualifierCount >= 4) {
    matches.push(...stageMatches(tournament, 'Bán kết', 101, previous ? winners(previous, 4) : ['Nhất A', 'Nhì B', 'Nhất B', 'Nhì A']));
    previous = 'Bán kết';
  }
  matches.push(...stageMatches(tournament, 'Chung kết', 102, previous ? winners(previous, 2) : ['Nhất A', 'Nhất B']));
  return matches;
}

function stageMatches(tournament: Tournament, stage: string, round: number, teams: string[]): MatchCreate[] {
  const matches: MatchCreate[] = [];
  let court = 1;
  for (let i = 0; i < teams.length; i += 2) {
    matches.push({ tournamentId: tournament.id, teamA: teams[i], teamB: teams[i + 1] || 'Chờ đối thủ', courtNumber: court, roundNumber: round, stage, groupName: null });
    court = court >= tournament.courtCount ? 1 : court + 1;
  }
  return matches;
}

function groupCountFor(tournament: Tournament, teamCount: number) {
  if (tournament.format !== 'GROUP_KNOCKOUT') return 1;
  return Math.min(Math.max(1, Math.ceil(tournament.knockoutQualifierCount / 2)), Math.max(1, Math.floor(teamCount / 2)));
}

function splitGroups(teams: string[], groupCount: number) {
  const groups = Array.from({ length: groupCount }, () => [] as string[]);
  teams.forEach((team, index) => groups[index % groupCount].push(team));
  return groups;
}

function winners(stage: string, count: number) {
  return Array.from({ length: count }, (_, index) => `Thắng ${stage} ${index + 1}`);
}

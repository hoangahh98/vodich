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

/**
 * Một đội do ban tổ chức chốt tay: tên đội (đôi là `"An / Bình"`, đơn là tên người) và bảng
 * muốn xếp vào (chữ cái `A`, `B`, ... — rỗng/null là để máy tự rải). Bảng chỉ có nghĩa với thể
 * thức đánh bảng; hai thể thức kia bỏ qua.
 */
export type ManualTeam = { name: string; group?: string | null };

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
    return this.fromTeams(
      tournament,
      teams.map((name) => ({ name })),
    );
  }

  /** Đội đã chốt tay (có thể kèm bảng). Vẫn nhận mảng tên trơn cho nơi gọi cũ. */
  fromManualPairs(tournament: Tournament, teams: (string | ManualTeam)[]): MatchCreate[] {
    return this.fromTeams(
      tournament,
      teams
        .map((team) => (typeof team === 'string' ? { name: team.trim() } : { name: team.name.trim(), group: team.group || null }))
        .filter((team) => team.name),
    );
  }

  private fromTeams(tournament: Tournament, teams: ManualTeam[]): MatchCreate[] {
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
 * Giải ĐƠN chọn đội thủ công: mỗi "đội" là một người, ban tổ chức chỉ chốt những ai muốn cố
 * định (thứ tự, hoặc bảng nếu đánh bảng), người chưa được chọn xếp nốt phía sau theo thứ tự
 * ngẫu nhiên — không ai biến mất khỏi lịch. Tên lạ (không có trong danh sách đăng ký) bị bỏ.
 */
export function completeManualSingles(manualNames: string[], registrations: RegisteredPlayer[]): string[] {
  const everyone = registrations.map(displayRegistrationName);
  const known = new Set(everyone);
  const chosen: string[] = [];
  for (const name of manualNames) {
    if (known.has(name) && !chosen.includes(name)) chosen.push(name);
  }
  const taken = new Set(chosen);
  return [...chosen, ...shuffle(everyone.filter((name) => !taken.has(name)))];
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

/** Số vòng của giải Đôi xoay vòng = số người mỗi bên (10 người → 5 vòng, 9 người → 5 vòng). */
export function americanoRoundCount(playerCount: number): number {
  return Math.ceil(playerCount / 2);
}

/**
 * Thể thức "Đôi xoay vòng (Americano)" — luật chủ app chốt 9/2026: chia người làm HAI BÊN,
 * mỗi người bên này lần lượt đánh CHUNG ĐỘI với từng người bên kia, không bao giờ ghép với
 * người cùng bên.
 *
 *  - `BY_SKILL` — bên mạnh / bên yếu (sắp theo trình rồi cắt đôi): mỗi cặp luôn là một mạnh
 *                 + một yếu, người mạnh thứ i lần lượt đi với người yếu thứ i, i+1, ...
 *  - `RANDOM`   — xáo rồi cắt đôi: mỗi người có n/2 bạn đánh chung ngẫu nhiên.
 *
 * MỘT VÒNG = n/2 cặp, mỗi người đúng MỘT cặp, và AI CŨNG ĐÁNH ĐÚNG BẰNG NHAU (chủ app chốt
 * 9/2026). Số cặp chẵn (12, 16 người) thì vòng nào cũng đủ mặt: mỗi người đánh n/2 trận. Số cặp
 * lẻ (10, 14 người) thì mỗi vòng một CẶP NGHỈ, chọn sao cho ai cũng nghỉ đúng một lần: mỗi người
 * đánh n/2 − 1 trận. 14 người → 7 vòng × 3 trận = 21 trận, mỗi người 6 trận; 12 người → 6 vòng
 * × 3 = 18 trận, mỗi người 6; 16 người → 8 vòng × 4 = 32 trận, mỗi người 8. Đừng cho cặp nghỉ đánh
 * bù với cặp nghỉ vòng sau: kiểu đó 12 người được 7 trận còn 2 người chỉ 6 — chủ app đã bác.
 * Lẻ người thì bên yếu có một chỗ trống, người mạnh rơi vào chỗ trống ấy nghỉ vòng đó.
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
  let court = 1;
  americanoRounds(players, rule).forEach((round, roundIndex) => {
    for (const [teamA, teamB] of round) {
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

/**
 * Chia hai bên. Luôn xáo trước để bấm "Chia trận" lần sau ra kèo khác (người cùng trình đổi
 * chỗ cho nhau); `BY_SKILL` sắp mạnh → yếu (sort ổn định nên thứ tự xáo giữ lại trong cùng trình)
 * rồi cắt đôi, bên mạnh lấy phần dư khi lẻ người.
 */
function americanoSides(players: AmericanoPlayer[], rule: PairingRule): [AmericanoPlayer[], AmericanoPlayer[]] {
  const shuffled = shuffle(players);
  const ordered = rule === 'BY_SKILL' ? [...shuffled].sort((a, b) => a.skill - b.skill) : shuffled;
  const half = Math.ceil(ordered.length / 2);
  return [ordered.slice(0, half), ordered.slice(half)];
}

/**
 * Vòng r: người mạnh thứ i đi với người yếu thứ (i + r) mod n/2 — sau n/2 vòng mỗi người đã đi
 * với đủ mọi người bên kia đúng một lần. Ghép trên CHỈ SỐ chứ không trên tên: hai VĐV trùng
 * tên hiển thị vẫn phải là hai người.
 *
 * Số cặp trong vòng lẻ thì một cặp NGHỈ: chọn cặp có tổng số lần nghỉ ít nhất, nhờ thế với số
 * cặp lẻ (n/2 lẻ) mỗi người nghỉ đúng một lần và cả giải ai cũng đánh n/2 − 1 trận. Cặp nghỉ
 * KHÔNG đánh bù ở vòng khác — đánh bù là có người hơn người khác một trận.
 *
 * Lẻ người thì bên mạnh dư một người, và mỗi người bên mạnh sẽ đúng một lần rơi vào chỗ trống
 * (không có bạn) — tính sẵn lần nghỉ ấy vào sổ NGAY TỪ ĐẦU, kẻo chọn cặp nghỉ theo sổ mới đếm
 * tới đâu tính tới đó thì có người vừa nghỉ vì không bạn vừa bị bốc nghỉ cặp hai lần (11 người
 * từng ra một người 3 trận trong khi người khác 5).
 */
function americanoRounds(players: AmericanoPlayer[], rule: PairingRule): [AmericanoPair, AmericanoPair][][] {
  const [strong, weak] = americanoSides(players, rule);
  const size = strong.length;
  const rests = new Map<number, number>(players.map((player) => [player.index, 0]));
  const rest = (player: AmericanoPlayer) => rests.set(player.index, (rests.get(player.index) || 0) + 1);
  if (weak.length < size) strong.forEach(rest);
  const rounds: [AmericanoPair, AmericanoPair][][] = [];

  for (let roundIndex = 0; roundIndex < size; roundIndex++) {
    const pairs: AmericanoPair[] = [];
    strong.forEach((first, index) => {
      const second = weak[(index + roundIndex) % size];
      if (second) pairs.push(makePair(first, second));
    });
    if (pairs.length % 2) {
      let restingIndex = 0;
      let fewest = Number.POSITIVE_INFINITY;
      pairs.forEach((pair, index) => {
        const score = (rests.get(pair.first.index) || 0) + (rests.get(pair.second.index) || 0);
        if (score < fewest) {
          fewest = score;
          restingIndex = index;
        }
      });
      const [resting] = pairs.splice(restingIndex, 1);
      rest(resting.first);
      rest(resting.second);
    }
    const round = toMatches(pairs, rule);
    if (round.length) rounds.push(round);
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

function buildGroupMatches(tournament: Tournament, teams: ManualTeam[]): MatchCreate[] {
  const stage = tournament.format === 'GROUP_KNOCKOUT' ? 'Vòng bảng' : 'Vòng tròn';
  const groups =
    tournament.format === 'GROUP_KNOCKOUT' ? splitGroups(teams, groupCountFor(tournament, teams.length)) : [teams.map((team) => team.name)];
  const matches: MatchCreate[] = [];
  const groupRounds = groups.map((groupTeams, groupIndex) => {
    const groupName = groupLetter(groupIndex);
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

/** Tên bảng theo thứ tự: 0 → A, 1 → B, ... Dùng chung cho lịch, form ghép tay và vòng quay. */
export function groupLetter(index: number): string {
  return String.fromCharCode('A'.charCodeAt(0) + index);
}

/** Ngược lại của `groupLetter`: 'A' → 0, 'b' → 1; chữ rỗng/lạ → -1. */
export function groupIndexOf(letter: string | null | undefined): number {
  const normalized = String(letter || '').trim().toUpperCase();
  return /^[A-Z]$/.test(normalized) ? normalized.charCodeAt(0) - 'A'.charCodeAt(0) : -1;
}

/**
 * Số bảng của thể thức đánh bảng: đủ để chọn ra số đội vào vòng trong (2 đội/bảng), nhưng không
 * quá nửa số đội (mỗi bảng ít nhất 2 đội). Form ghép tay và vòng quay cũng dùng hàm này để
 * vẽ đúng số bảng mà "Chia trận" sẽ tạo.
 */
export function groupCountFor(tournament: Pick<Tournament, 'format' | 'knockoutQualifierCount'>, teamCount: number) {
  if (tournament.format !== 'GROUP_KNOCKOUT') return 1;
  return Math.min(Math.max(1, Math.ceil(tournament.knockoutQualifierCount / 2)), Math.max(1, Math.floor(teamCount / 2)));
}

/**
 * Chia đội vào bảng. Đội đã CHỌN BẢNG (ghép tay / vòng quay) vào đúng bảng ấy; đội để máy xếp
 * thì lần lượt rơi vào bảng đang ít đội nhất (bằng nhau thì bảng đứng trước) — không chọn gì
 * cả thì ra đúng kiểu rải A, B, A, B như trước. Bảng vượt quá số bảng hiện có coi như chưa chọn.
 */
function splitGroups(teams: ManualTeam[], groupCount: number): string[][] {
  const groups = Array.from({ length: groupCount }, () => [] as string[]);
  const loose: string[] = [];
  for (const team of teams) {
    const index = groupIndexOf(team.group);
    if (index >= 0 && index < groupCount) groups[index].push(team.name);
    else loose.push(team.name);
  }
  for (const name of loose) {
    let target = 0;
    groups.forEach((group, index) => {
      if (group.length < groups[target].length) target = index;
    });
    groups[target].push(name);
  }
  return groups;
}

function winners(stage: string, count: number) {
  return Array.from({ length: count }, (_, index) => `Thắng ${stage} ${index + 1}`);
}

/**
 * Quy tắc bốc cặp cho vòng quay chia trận — THUẦN LOGIC, không đụng DOM, để test được.
 *
 * Phải trùng với `buildBalancedDoublesTeams` ở server (src/tournaments/tournament-schedule.ts),
 * nếu không thì quay ra một đằng mà server chia trận ra một nẻo. Rule là "hai đầu ghép vào
 * giữa" chứ KHÔNG phải "A ghép D":
 *
 *   - Gom người theo trình, sắp các mức MẠNH -> YẾU. Trình bỏ trống hay ghi lạ gom về '?' và
 *     xếp yếu nhất.
 *   - Ghép chéo hai đầu: mức mạnh nhất với mức yếu nhất, rồi tiến dần vào trong.
 *     4 mức B/C/D/? -> B với ?, C với D. 3 mức A/C/D -> A với D, C với chính nó. 1 mức -> ghép
 *     trong mức đó. Chữ cái cụ thể không quan trọng, chỉ thứ hạng mới quan trọng.
 *   - Ai dư ra do hai mức lệch số lượng thì dồn lại ghép với nhau ở cuối.
 *   - Lẻ đúng một người cả giải thì để trống chỗ bạn đánh cặp.
 *
 * Rule 'RANDOM' bỏ qua toàn bộ phần trên: một rổ duy nhất, bốc lần lượt từng cặp.
 */
(() => {
  const WAITING_PARTNER = 'Chờ thành viên';
  const UNKNOWN_LEVEL = '?';

  const normalizeSkill = (raw) => String(raw || '').trim().toUpperCase() || UNKNOWN_LEVEL;

  /** Thứ tự mạnh→yếu: A<B<C<D; trình lạ/không rõ xếp yếu nhất. Giống skillRank ở server. */
  const skillRank = (level) => {
    const index = 'ABCD'.indexOf(level);
    return index >= 0 ? index : 100;
  };

  const levelLabel = (level) => (level === UNKNOWN_LEVEL ? 'Chưa rõ trình' : 'Trình ' + level);

  function buildSteps(players, rule) {
    const pool = players.map((player) => ({ name: player.name, level: normalizeSkill(player.skill) }));
    if (rule === 'RANDOM') return [{ kind: 'within', players: pool, label: 'Tất cả' }];

    const byLevel = new Map();
    for (const player of pool) {
      const bucket = byLevel.get(player.level);
      if (bucket) bucket.push(player);
      else byLevel.set(player.level, [player]);
    }
    const levels = [...byLevel.keys()].sort((a, b) => skillRank(a) - skillRank(b) || a.localeCompare(b));

    const steps = [];
    let lo = 0;
    let hi = levels.length - 1;
    while (lo < hi) {
      steps.push({
        kind: 'across',
        left: byLevel.get(levels[lo]),
        leftLabel: levelLabel(levels[lo]),
        right: byLevel.get(levels[hi]),
        rightLabel: levelLabel(levels[hi]),
      });
      lo++;
      hi--;
    }
    // Số mức lẻ -> mức đứng GIỮA ghép trong chính nó (cũng là ca "cả giải chỉ một mức trình").
    if (lo === hi) steps.push({ kind: 'within', players: byLevel.get(levels[lo]), label: levelLabel(levels[lo]) });
    return steps;
  }

  /**
   * Tạo một lượt bốc. `pickIndex` cho phép test bơm bộ chọn tất định thay cho ngẫu nhiên.
   */
  function createDraw(players, rule, pickIndex) {
    const steps = buildSteps(players || [], rule === 'RANDOM' ? 'RANDOM' : 'BY_SKILL');
    const leftovers = [];
    const choose = typeof pickIndex === 'function' ? pickIndex : (size) => Math.floor(Math.random() * size);
    let stepIndex = 0;

    const take = (list) => list.splice(choose(list.length), 1)[0];

    /** Bước còn bốc được; bước nào cạn thì đẩy phần dư sang rổ "còn lại" rồi đi tiếp. */
    function currentStep() {
      while (stepIndex < steps.length) {
        const step = steps[stepIndex];
        if (step.kind === 'across') {
          if (step.left.length && step.right.length) return step;
          leftovers.push(...step.left.splice(0), ...step.right.splice(0));
        } else {
          if (step.players.length >= 2) return step;
          leftovers.push(...step.players.splice(0));
        }
        stepIndex++;
      }
      if (leftovers.length >= 2) return { kind: 'within', players: leftovers, label: 'Còn lại' };
      return null;
    }

    return {
      /** Bốc một đội. Trả null khi không còn bốc được cặp nào nữa. */
      next() {
        const step = currentStep();
        if (!step) return null;
        const acrossStep = step.kind === 'across';
        const labels = acrossStep ? [step.leftLabel, step.rightLabel] : [step.label, step.label];
        const sources = acrossStep
          ? [step.left.map((player) => player.name), step.right.map((player) => player.name)]
          : [step.players.map((player) => player.name), step.players.map((player) => player.name)];
        const first = acrossStep ? take(step.left) : take(step.players);
        const second = acrossStep ? take(step.right) : take(step.players);
        return { labels, sources, team: [first.name, second ? second.name : ''] };
      },

      /** Người lẻ cuối cùng của cả giải, nếu có. Gọi sau khi `next()` đã trả null. */
      leftoverName() {
        for (const step of steps) {
          if (step.kind === 'across') leftovers.push(...step.left.splice(0), ...step.right.splice(0));
          else leftovers.push(...step.players.splice(0));
        }
        return leftovers.length === 1 ? leftovers.splice(0, 1)[0].name : '';
      },

      /** Bốc hết một lượt, trả về danh sách đội. Dùng cho test và cho nút "Quay hết". */
      drawAll() {
        const teams = [];
        for (let team = this.next(); team; team = this.next()) teams.push(team.team);
        const remaining = this.leftoverName();
        if (remaining) teams.push([remaining, '']);
        return teams;
      },
    };
  }

  const api = { WAITING_PARTNER, createDraw };
  if (typeof window !== 'undefined') window.VodichSpinPairing = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();

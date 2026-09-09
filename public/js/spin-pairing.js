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
 *   - Ai dư ra do hai mức lệch số lượng thì GẤP LẠI TỪ ĐẦU theo đúng quy tắc trên, chứ không
 *     đổ chung một rổ bốc bừa — nếu không thì mấy người mạnh dư ra tự ghép với nhau.
 *   - Lẻ đúng một người cả giải thì để trống chỗ bạn đánh cặp.
 *
 * Rule 'RANDOM' bỏ qua toàn bộ phần trên: một rổ duy nhất, bốc lần lượt từng cặp.
 *
 * Giải ĐƠN (`createSinglesDraw`) không có chuyện ghép: mỗi lượt quay bốc đúng một người, thứ tự
 * bốc là thứ tự đội (đánh bảng thì đội 1 vào A, đội 2 vào B, ... như `splitGroups` ở server).
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

  /** Một lượt "gấp": sinh các bước bốc từ một rổ người, khớp `foldByLevel` ở server. */
  function buildSteps(pool) {
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
    const bySkill = rule !== 'RANDOM';
    const pool = (players || []).map((player) => ({ name: player.name, level: normalizeSkill(player.skill) }));
    let steps = bySkill ? buildSteps(pool) : [{ kind: 'within', players: pool, label: 'Tất cả' }];
    let stepIndex = 0;
    let leftovers = [];
    const choose = typeof pickIndex === 'function' ? pickIndex : (size) => Math.floor(Math.random() * size);

    const take = (list) => list.splice(choose(list.length), 1)[0];
    const drainStep = (step) => (step.kind === 'across' ? [...step.left.splice(0), ...step.right.splice(0)] : step.players.splice(0));

    /**
     * Bước còn bốc được. Bước nào cạn thì đẩy phần dư sang rổ "còn lại"; hết sạch bước thì GẤP
     * LẠI rổ ấy đúng như vòng lặp trong `buildBalancedDoublesTeams` ở server.
     */
    function currentStep() {
      for (;;) {
        while (stepIndex < steps.length) {
          const step = steps[stepIndex];
          if (step.kind === 'across' ? step.left.length && step.right.length : step.players.length >= 2) return step;
          leftovers.push(...drainStep(step));
          stepIndex++;
        }
        if (!bySkill || leftovers.length < 2) return null;
        const folded = leftovers;
        leftovers = [];
        steps = buildSteps(folded);
        stepIndex = 0;
        // Rổ từ 2 người trở lên luôn sinh ít nhất một bước bốc được nên vòng lặp có tiến triển;
        // nhánh này chỉ là chốt chặn để đổi quy tắc sau này không treo trình duyệt.
        if (!steps.length) {
          leftovers = folded;
          return null;
        }
      }
    }

    return {
      /** Bốc một đội. Trả null khi không còn bốc được cặp nào nữa. */
      next() {
        const step = currentStep();
        if (!step) return null;
        const acrossStep = step.kind === 'across';
        const labels = acrossStep ? [step.leftLabel, step.rightLabel] : [step.label, step.label];
        const firstPool = acrossStep ? step.left : step.players;
        const secondPool = acrossStep ? step.right : step.players;
        // Chụp danh sách nguồn NGAY TRƯỚC mỗi lần bốc: ô quay thứ hai của bước "cùng một mức"
        // không được còn tên người vừa trúng ô thứ nhất.
        const firstNames = firstPool.map((player) => player.name);
        const first = take(firstPool);
        const secondNames = secondPool.map((player) => player.name);
        const second = take(secondPool);
        return { labels, sources: [firstNames, secondNames], team: [first.name, second ? second.name : ''] };
      },

      /**
       * Nguồn của lượt bốc SẮP tới mà chưa bốc ai — để vẽ sẵn vòng quay đúng nhóm người ngay
       * khi mở khung, thay vì vẽ đại danh sách rồi nhảy sang nhóm khác lúc bấm quay.
       */
      preview() {
        const step = currentStep();
        if (!step) return null;
        const acrossStep = step.kind === 'across';
        const names = (list) => list.map((player) => player.name);
        return {
          labels: acrossStep ? [step.leftLabel, step.rightLabel] : [step.label, step.label],
          sources: acrossStep ? [names(step.left), names(step.right)] : [names(step.players), names(step.players)],
        };
      },

      /** Người lẻ cuối cùng của cả giải, nếu có. Gọi sau khi `next()` đã trả null. */
      leftoverName() {
        for (const step of steps) leftovers.push(...drainStep(step));
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

  /**
   * Lượt bốc cho giải ĐƠN: cùng giao diện next/preview/leftoverName/drawAll với `createDraw`
   * để spin-draw.js dùng chung, nhưng mỗi lượt chỉ có MỘT ô quay và `team` chỉ có một tên.
   */
  function createSinglesDraw(players, pickIndex) {
    const pool = (players || []).map((player) => player.name);
    const choose = typeof pickIndex === 'function' ? pickIndex : (size) => Math.floor(Math.random() * size);
    const label = () => (pool.length ? 'Còn ' + pool.length + ' người' : 'Đã bốc xong');
    return {
      next() {
        if (!pool.length) return null;
        const names = [...pool];
        const labels = [label()];
        const name = pool.splice(choose(pool.length), 1)[0];
        return { labels, sources: [names], team: [name] };
      },
      preview() {
        return pool.length ? { labels: [label()], sources: [[...pool]] } : null;
      },
      /** Đơn thì không có ai "lẻ": mỗi người là một đội trọn vẹn. */
      leftoverName() {
        return '';
      },
      drawAll() {
        const teams = [];
        for (let team = this.next(); team; team = this.next()) teams.push(team.team);
        return teams;
      },
    };
  }

  const api = { WAITING_PARTNER, createDraw, createSinglesDraw };
  if (typeof window !== 'undefined') window.VodichSpinPairing = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();

(() => {
  const { clearActionLoading, getTournamentSocket, setActionLoading, socketEvents = {} } = window.Vodich || {};
  const rules = window.VodichScoreRules || {};
  const speech = window.VodichScoreSpeech || {};
  const dom = window.VodichScoreboardDom || {};
  const list = document.getElementById('matchList');
  if (!list || typeof getTournamentSocket !== 'function') return;

  const tournamentId = list.dataset.tournamentId;
  const socket = getTournamentSocket(tournamentId);
  if (!socket) return;
  // Đánh ĐƠN (luật: https://irace.vn/luat-choi-pickleball-danh-don/): điểm chỉ hai số (giao – nhận),
  // mỗi bên một người, chỉ một lần giao — thua bóng là đối thủ giao ngay (không có tay 2), người
  // giao đứng bên phải khi điểm mình chẵn, bên trái khi lẻ; người nhận đứng chéo sân.
  const singles = list.dataset.playType === 'SINGLES';

  const config = {
    group: {
      touchScore: Number.parseInt(list.dataset.touchScore || '11', 10) || 11,
      maxScore: Number.parseInt(list.dataset.maxScore || '15', 10) || 15,
    },
    knockout: {
      touchScore: Number.parseInt(list.dataset.knockoutTouchScore || '15', 10) || 15,
      maxScore: Number.parseInt(list.dataset.knockoutMaxScore || '19', 10) || 19,
    },
  };

  const modal = document.getElementById('scoreModal');
  const setupStep = document.getElementById('scoreSetupStep');
  const playStep = document.getElementById('scorePlayStep');
  const setupContinue = document.getElementById('scoreSetupContinue');
  const backToSetup = document.getElementById('scoreBackToSetup');
  const swapCourt = document.getElementById('scoreSwapCourt');
  const scoreTeamA = document.getElementById('scoreTeamA');
  const scoreTeamB = document.getElementById('scoreTeamB');
  const scoreValueA = document.getElementById('scoreInputA');
  const scoreValueB = document.getElementById('scoreInputB');
  const scoreSideA = document.getElementById('scoreSideA');
  const scoreSideB = document.getElementById('scoreSideB');
  const saveStatus = document.getElementById('scoreSaveStatus');
  const playerRefs = {
    A: {
      title: document.getElementById('matchTeamAPlayerTitle'),
      first: document.getElementById('matchAPlayer1'),
      second: document.getElementById('matchAPlayer2'),
    },
    B: {
      title: document.getElementById('matchTeamBPlayerTitle'),
      first: document.getElementById('matchBPlayer1'),
      second: document.getElementById('matchBPlayer2'),
    },
  };
  const courtSlots = {
    A1: document.querySelector('[data-match-court-slot="A1"]'),
    A2: document.querySelector('[data-match-court-slot="A2"]'),
    B1: document.querySelector('[data-match-court-slot="B1"]'),
    B2: document.querySelector('[data-match-court-slot="B2"]'),
  };

  const applySinglesLayout = () => {
    if (!singles) return;
    document.querySelectorAll('[data-doubles-only]').forEach((el) => el.classList.add('hidden'));
    document.querySelectorAll('[data-serving-label]').forEach((el) => { el.textContent = el.dataset.servingLabel === 'setup' ? 'Người giao trước' : 'Người đang giao'; });
    if (backToSetup) backToSetup.textContent = 'Đổi người giao trước';
  };
  applySinglesLayout();

  let activeRow = null;
  let state = { scoreA: 0, scoreB: 0, servingTeam: 'A', servingPlayer: '1', firstServerActive: true, scoreHistory: [], scoreOrder: 2, sidesSwapped: false, positions: { A: { 1: '1', 2: '2' }, B: { 1: '1', 2: '2' } } };
  let lastWinnerKey = '';
  let saveTimer = null;
  let speakTimer = null;

  const canEditSetup = () => state.scoreA === 0 && state.scoreB === 0;
  const isInitialServeState = () => state.scoreA === 0 && state.scoreB === 0 && !(state.scoreHistory || []).length;

  const updateSetupButton = () => {
    if (!backToSetup) return;
    const setupVisible = setupStep && !setupStep.classList.contains('hidden');
    backToSetup.classList.toggle('hidden', !canEditSetup() || setupVisible);
    backToSetup.disabled = !canEditSetup();
  };

  const showSetupStep = () => {
    if (!canEditSetup()) {
      showPlayStep();
      setStatus('Chỉ đổi tay khi điểm đang là 0-0.', 'text-danger');
      return;
    }
    setupStep?.classList.remove('hidden');
    playStep?.classList.add('hidden');
    updateSetupButton();
  };

  const showPlayStep = () => {
    setupStep?.classList.add('hidden');
    playStep?.classList.remove('hidden');
    updateSetupButton();
  };

  const activeRules = () => (activeRow?.dataset.knockout === 'true' ? config.knockout : config.group);

  const setStatus = (text, className = 'muted') => {
    if (!saveStatus) return;
    saveStatus.className = `score-save-status ${className}`;
    saveStatus.textContent = text;
  };

  const renderTeamLabels = () => {
    if (scoreTeamA) scoreTeamA.textContent = dom.formatTeam?.(teamDisplayName(teamOnSide('A'))) || teamDisplayName(teamOnSide('A'));
    if (scoreTeamB) scoreTeamB.textContent = dom.formatTeam?.(teamDisplayName(teamOnSide('B'))) || teamDisplayName(teamOnSide('B'));
    // Đánh đơn: nút chọn người giao ghi thẳng tên người thay vì "Đội A/B".
    if (singles) {
      document.querySelectorAll('[data-serving-select]').forEach((button) => {
        button.textContent = teamDisplayName(teamOnSide(button.dataset.servingSelect === 'B' ? 'B' : 'A'));
      });
    }
  };

  const renderModal = () => {
    if (!scoreValueA || !scoreValueB) return;
    scoreValueA.textContent = String(teamScore(teamOnSide('A')));
    scoreValueB.textContent = String(teamScore(teamOnSide('B')));
    scoreSideA?.classList.toggle('serving-team', state.servingTeam === teamOnSide('A'));
    scoreSideB?.classList.toggle('serving-team', state.servingTeam === teamOnSide('B'));
    renderTeamLabels();
    dom.bindOptionState?.(state);
    renderCourt();
    if (!canEditSetup() && setupStep && !setupStep.classList.contains('hidden')) showPlayStep();
    updateSetupButton();
  };

  const setupKey = () => activeRow ? `vodichMatchScoreSetup:${tournamentId}:${activeRow.dataset.matchId}` : '';

  const teamNames = (teamText) => {
    const names = String(teamText || '').split(/\s*\/\s*/).map((name) => name.trim()).filter(Boolean);
    if (names.length >= 2) return names.slice(0, 2);
    return [names[0] || 'Người chơi 1', 'Người chơi 2'];
  };

  const defaultSetup = (row) => ({
    players: { A: teamNames(row.dataset.teamA), B: teamNames(row.dataset.teamB) },
    positions: { A: { 1: '1', 2: '2' }, B: { 1: '1', 2: '2' } },
    sidesSwapped: false,
  });

  const loadSetup = (row) => {
    try {
      return { ...defaultSetup(row), ...JSON.parse(window.localStorage.getItem(`vodichMatchScoreSetup:${tournamentId}:${row.dataset.matchId}`) || '{}') };
    } catch (_) {
      return defaultSetup(row);
    }
  };

  const saveSetup = () => {
    const key = setupKey();
    if (!key) return;
    window.localStorage.setItem(key, JSON.stringify({ players: state.players, positions: state.positions, sidesSwapped: state.sidesSwapped }));
  };

  const playerName = (team, playerNumber) => state.players?.[team]?.[Number(playerNumber) - 1] || `Tay ${playerNumber}`;
  const playerAtSlot = (team, slot) => state.positions?.[team]?.[slot] || '1';
  const otherPlayer = (playerNumber) => String(playerNumber) === '1' ? '2' : '1';

  // Ánh xạ giữa vị trí hiển thị trên màn (ô bên trái = 'A', bên phải = 'B') và đội thật.
  // Khi "đổi sân" thì hai đội tráo vị trí hiển thị, còn điểm/người giao/ô1-ô2 giữ nguyên.
  const teamOnSide = (side) => (state.sidesSwapped ? (side === 'A' ? 'B' : 'A') : side);
  const teamScore = (team) => (team === 'A' ? state.scoreA : state.scoreB);
  const teamDisplayName = (team) => (team === 'A' ? (activeRow?.dataset.teamA || 'Đội A') : (activeRow?.dataset.teamB || 'Đội B'));
  // Người giao đứng ô 1 khi là người phát đầu tiên (0-0-2) hoặc trận CHƯA có điểm; ngoài ra theo thứ tự đánh.
  // Trước 28/9/2026 chỉ xét cờ firstServerActive — cờ ấy bị tắt oan khi bấm lại đúng đội đang chọn ở
  // bước chọn đội giao trước, thế là đổi người xong người giao nhảy sang ô 2 (chủ app báo).
  const serverSlot = () => (state.firstServerActive || isInitialServeState() ? 1 : state.scoreOrder);
  const syncServingPlayer = () => { state.servingPlayer = playerAtSlot(state.servingTeam, serverSlot()); };

  const renderCourt = () => {
    if (singles) {
      // Chẵn phải, lẻ trái theo điểm của NGƯỜI GIAO; ô 1 là ô bên phải, người nhận đứng chéo (cùng số ô).
      const slot = teamScore(state.servingTeam) % 2 === 0 ? 1 : 2;
      ['A', 'B'].forEach((side) => {
        const team = teamOnSide(side);
        [1, 2].forEach((candidate) => {
          const marker = courtSlots[`${side}${candidate}`];
          if (!marker) return;
          const shown = candidate === slot;
          marker.classList.toggle('hidden', !shown);
          if (!shown) return;
          marker.textContent = playerName(team, '1');
          marker.classList.toggle('serving', state.servingTeam === team);
        });
      });
      return;
    }
    ['A', 'B'].forEach((side) => {
      const team = teamOnSide(side);
      [1, 2].forEach((slot) => {
        const marker = courtSlots[`${side}${slot}`];
        if (!marker) return;
        const playerNumber = playerAtSlot(team, slot);
        marker.textContent = playerName(team, playerNumber);
        marker.classList.toggle('serving', state.servingTeam === team && String(state.servingPlayer) === playerNumber);
      });
    });
  };

  const fillSelect = (select, names, value) => {
    if (!select) return;
    select.innerHTML = '';
    names.forEach((name, index) => {
      const option = document.createElement('option');
      option.value = String(index + 1);
      option.textContent = name;
      option.selected = String(value) === option.value;
      select.appendChild(option);
    });
  };

  const renderPlayerSettings = () => {
    ['A', 'B'].forEach((side) => {
      const team = teamOnSide(side);
      const refs = playerRefs[side];
      if (refs.title) refs.title.textContent = teamDisplayName(team);
      fillSelect(refs.first, state.players[team], playerAtSlot(team, 1));
      fillSelect(refs.second, state.players[team], playerAtSlot(team, 2));
    });
  };

  const normalizePositionAfterChange = (team, changedSlot) => {
    const otherSlot = String(changedSlot) === '1' ? '2' : '1';
    if (state.positions[team][changedSlot] === state.positions[team][otherSlot]) {
      state.positions[team][otherSlot] = otherPlayer(state.positions[team][changedSlot]);
    }
  };

  const snapshot = () => ({
    scoreA: state.scoreA,
    scoreB: state.scoreB,
    servingTeam: state.servingTeam,
    servingPlayer: state.servingPlayer,
    firstServerActive: state.firstServerActive,
    scoreOrder: state.scoreOrder,
    positions: {
      A: { 1: state.positions.A[1], 2: state.positions.A[2] },
      B: { 1: state.positions.B[1], 2: state.positions.B[2] },
    },
  });

  const swapServingSide = (team) => {
    const first = state.positions[team][1];
    state.positions[team][1] = state.positions[team][2];
    state.positions[team][2] = first;
  };

  const optimisticRow = () => {
    if (!activeRow) return;
    dom.applyRow?.(activeRow, {
      scoreA: state.scoreA,
      scoreB: state.scoreB,
      scoreOrder: state.scoreOrder,
      servingTeam: state.servingTeam,
      status: rules.statusFor?.(state.scoreA, state.scoreB, activeRules()) || 'PLAYING',
    });
  };

  const winnerName = () => {
    if (!activeRow || state.scoreA === state.scoreB) return '';
    if ((rules.statusFor?.(state.scoreA, state.scoreB, activeRules()) || 'PLAYING') !== 'FINISHED') return '';
    return speech.teamSpeechName?.(state.scoreA > state.scoreB ? activeRow.dataset.teamA : activeRow.dataset.teamB) || '';
  };

  const speakCurrentScore = () => {
    const read = speech.readVietnameseNumber || ((value) => String(value));
    // Đọc "điểm giao - điểm nhận" trước, ngắt một nhịp rồi mới đọc số thứ tự đánh (tay).
    const scorePair = state.servingTeam === 'B'
      ? `${read(state.scoreB)} ${read(state.scoreA)}`
      : `${read(state.scoreA)} ${read(state.scoreB)}`;
    // Đánh đơn chỉ đọc hai số; đánh đôi đọc thêm số thứ tự đánh (tay).
    const orderText = singles ? '' : read(state.scoreOrder);
    const speakParts = speech.speakSequence || ((parts) => speech.speak?.(parts.join(' ')));
    const winner = winnerName();
    const winnerKey = activeRow ? `${activeRow.dataset.matchId}:${winner}:${state.scoreA}-${state.scoreB}` : '';
    if (winner && winnerKey !== lastWinnerKey) {
      lastWinnerKey = winnerKey;
      const prefix = winner.includes(' và ') ? 'đội ' : '';
      speakParts([scorePair, `${orderText ? `${orderText}. ` : ''}Chúc mừng ${prefix}${winner} giành chiến thắng`]);
      return;
    }
    speakParts(orderText ? [scorePair, orderText] : [scorePair]);
  };

  const scheduleSpeak = (delay = 220) => {
    window.clearTimeout(speakTimer);
    if (delay <= 0) {
      speakCurrentScore();
      return;
    }
    speakTimer = window.setTimeout(speakCurrentScore, delay);
  };

  // ── Lưu điểm CÓ XÁC NHẬN (chủ app 28/9/2026) ──────────────────────────────────────────────
  // Trước đây: socket.emit rồi hiện "Đã gửi điểm" ngay. Server lỗi DB, hay socket đang đứt lúc Render
  // ngủ, là điểm rơi im lặng — 11-5 hết trận mà refresh máy nào cũng không thấy. Nay:
  //   1. Mỗi lần lưu là một `seq` tăng dần; `pending` giữ lần lưu GẦN NHẤT chưa được xác nhận.
  //   2. emit kèm callback ack + timeout: có ack ok mới hiện "Đã lưu".
  //   3. Không ack, hoặc server báo lỗi tạm → đi đường HTTP dự phòng (fetch keepalive).
  //   4. Vẫn không được → thử lại lùi dần, và gửi lại ngay khi socket nối lại / máy có mạng lại.
  //   5. Đóng tab khi còn pending → sendBeacon nốt.
  let seq = 0;
  let pending = null;
  let retryTimer = null;
  let retryCount = 0;
  const ACK_TIMEOUT_MS = 4000;

  const scoreUrl = (payload) => `/tournaments/${encodeURIComponent(payload.tournamentId)}/matches/${encodeURIComponent(payload.matchId)}/score`;

  const markSaved = (payloadSeq, via) => {
    if (pending && pending.seq === payloadSeq) {
      pending = null;
      retryCount = 0;
      window.clearTimeout(retryTimer);
    }
    if (!pending) setStatus(via === 'http' ? 'Đã lưu (đường dự phòng)' : 'Đã lưu', 'text-success');
  };

  const scheduleRetry = (payload) => {
    window.clearTimeout(retryTimer);
    retryCount += 1;
    const wait = Math.min(20000, 1500 * 2 ** Math.min(retryCount, 4));
    setStatus(`Chưa lưu được — thử lại sau ${Math.round(wait / 1000)}s`, 'text-danger');
    retryTimer = window.setTimeout(() => flush(payload, true), wait);
  };

  const httpFallback = async (payload) => {
    if (!pending || pending.seq !== payload.seq) return;
    try {
      const response = await fetch(scoreUrl(payload), {
        method: 'POST',
        credentials: 'same-origin',
        keepalive: true,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Requested-With': 'fetch' },
        body: JSON.stringify({ ...payload, origin: socket.id || '' }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok && body.ok) {
        if (body.match && activeRow && String(body.match.id) === String(activeRow.dataset.matchId)) dom.applyRow?.(activeRow, body.match);
        markSaved(payload.seq, 'http');
        return;
      }
      if (body.retryable === false) {
        pending = null;
        setStatus(body.message || 'Không lưu được điểm', 'text-danger');
        return;
      }
      scheduleRetry(payload);
    } catch (_) {
      scheduleRetry(payload);
    }
  };

  const flush = (payload = pending?.payload, viaRetry = false) => {
    if (!payload || !pending || pending.seq !== payload.seq) return;
    if (viaRetry && retryCount >= 8) {
      setStatus('Chưa lưu được — kiểm tra mạng rồi bấm lại điểm', 'text-danger');
      return;
    }
    setStatus(viaRetry ? 'Đang thử lưu lại…' : 'Đang lưu…', 'text-primary');
    if (!socket.connected || typeof socket.timeout !== 'function') {
      httpFallback(payload);
      return;
    }
    payload.origin = socket.id || '';
    socket.timeout(ACK_TIMEOUT_MS).emit(socketEvents.SCORE || 'score', payload, (error, result) => {
      if (!pending || pending.seq !== payload.seq) return;
      if (!error && result && result.ok) {
        // Thẻ trận lấy ngay số server đã lưu — không đợi tiếng vọng phát lại cho cả phòng.
        const row = result.match && list.querySelector(`[data-match-id="${result.match.id}"]`);
        if (row) dom.applyRow?.(row, result.match);
        markSaved(payload.seq, 'socket');
        return;
      }
      if (!error && result && result.ok === false && result.retryable === false) {
        pending = null;
        setStatus(result.message || 'Không lưu được điểm', 'text-danger');
        return;
      }
      httpFallback(payload);
    });
  };

  const saveScore = () => {
    if (!activeRow) return;
    seq += 1;
    const payload = {
      tournamentId,
      matchId: activeRow.dataset.matchId,
      scoreA: state.scoreA,
      scoreB: state.scoreB,
      servingTeam: state.servingTeam,
      scoreOrder: state.scoreOrder,
      seq,
    };
    pending = { seq, payload };
    retryCount = 0;
    window.clearTimeout(retryTimer);
    window.clearTimeout(saveTimer);
    setStatus('Đang lưu…', 'text-primary');
    saveTimer = window.setTimeout(() => {
      saveTimer = null;
      flush(payload);
    }, 350);
  };

  // Socket nối lại (Render ngủ dậy, đổi mạng) hay máy có mạng lại: gửi nốt cái đang treo.
  socket.on('connect', () => { if (pending) flush(); });
  window.addEventListener('online', () => { if (pending) flush(); });
  // Đóng tab / chuyển app khi còn pending: bắn nốt bằng sendBeacon (dạng form, server nhận cả hai kiểu).
  window.addEventListener('pagehide', () => {
    if (!pending || !navigator.sendBeacon) return;
    const form = new URLSearchParams();
    Object.entries({ ...pending.payload, origin: socket.id || '' }).forEach(([key, value]) => form.append(key, String(value)));
    navigator.sendBeacon(scoreUrl(pending.payload), form);
  });

  const openModal = (row) => {
    if (!modal || !scoreTeamA || !scoreTeamB) return;
    activeRow = row;
    state = {
      scoreA: Number.parseInt(row.dataset.scoreA || '0', 10) || 0,
      scoreB: Number.parseInt(row.dataset.scoreB || '0', 10) || 0,
      scoreOrder: Number.parseInt(row.dataset.scoreOrder || '2', 10) === 1 ? 1 : 2,
      servingTeam: row.dataset.servingTeam === 'B' ? 'B' : 'A',
      servingPlayer: '1',
      firstServerActive: (Number.parseInt(row.dataset.scoreA || '0', 10) || 0) === 0 && (Number.parseInt(row.dataset.scoreB || '0', 10) || 0) === 0 && (Number.parseInt(row.dataset.scoreOrder || '2', 10) !== 1),
      scoreHistory: [],
      ...loadSetup(row),
    };
    syncServingPlayer();
    setStatus(pending && pending.payload.matchId === row.dataset.matchId ? 'Đang lưu…' : 'Chưa thay đổi', pending ? 'text-primary' : 'muted');
    renderPlayerSettings();
    renderModal();
    if (canEditSetup()) showSetupStep();
    else showPlayStep();
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
  };

  const closeModal = () => {
    // Đóng khi chưa hết 350ms chờ gộp: gửi luôn, đừng để lần lưu cuối phụ thuộc vào một timer sau khi đóng.
    if (saveTimer) {
      window.clearTimeout(saveTimer);
      saveTimer = null;
      flush();
    }
    modal?.classList.add('hidden');
    modal?.setAttribute('aria-hidden', 'true');
    if (typeof clearActionLoading === 'function') document.querySelectorAll('[data-score-close].loading').forEach(clearActionLoading);
    activeRow = null;
  };

  const stepScore = (displaySide, delta) => {
    if (!activeRow) return;
    const side = teamOnSide(displaySide);
    if (side !== state.servingTeam) {
      setStatus(singles ? 'Chỉ người đang giao được ghi điểm. Thua bóng thì bấm tên người kia để đổi giao.' : 'Chỉ đội đang giao được ghi điểm. Muốn đổi đội giao phải ở tay 2.', 'text-danger');
      return;
    }
    const next = { ...state };
    if (delta > 0) next.scoreHistory = [...(state.scoreHistory || []), snapshot()].slice(-30);
    if (delta < 0) {
      const last = state.scoreHistory?.[state.scoreHistory.length - 1];
      if (last) {
        state.scoreHistory.pop();
        state = { ...state, ...last };
        optimisticRow();
        renderPlayerSettings();
        renderModal();
        scheduleSpeak(0);
        saveSetup();
        saveScore();
        return;
      }
    }
    if (side === 'A') next.scoreA = Math.max(0, next.scoreA + delta);
    if (side === 'B') next.scoreB = Math.max(0, next.scoreB + delta);
    [next.scoreA, next.scoreB] = rules.clampScores?.(next.scoreA, next.scoreB, activeRules()) || [next.scoreA, next.scoreB];
    state = next;
    if (delta > 0 && !singles) swapServingSide(side);
    optimisticRow();
    renderPlayerSettings();
    renderModal();
    scheduleSpeak(0);
    saveSetup();
    saveScore();
  };

  // Điểm mới từ server. Ba trường hợp, và TIẾNG VỌNG của chính mình là cái hay gây lỗi nhất: server phát
  // cho cả phòng kể cả máy vừa gửi, mà trước đây máy gửi lấy nó ghi đè state — bấm +1 rồi 300ms sau đổi
  // đội giao là tiếng vọng lần trước về sau kéo người giao ngược lại (chủ app báo 28/9/2026).
  socket.on(socketEvents.SCORE_UPDATED || 'scoreUpdated', (match) => {
    const row = list.querySelector(`[data-match-id="${match.id}"]`);
    if (!row) return;
    const ownEcho = match.origin && match.origin === socket.id;
    if (ownEcho) {
      // Của mình: chỉ lần lưu MỚI NHẤT mới đáng tin; tiếng vọng của lần cũ hơn bỏ hẳn — kể cả với thẻ
      // trận, không thì thẻ tụt về đội giao cũ trong lúc modal đã đúng.
      if (Number(match.seq) !== (pending ? pending.seq : seq)) return;
      dom.applyRow?.(row, match);
      markSaved(Number(match.seq), 'socket');
      return;
    }
    dom.applyRow?.(row, match);
    if (activeRow !== row) return;
    // Đang có lần lưu chưa xác nhận: state cục bộ mới hơn, lần lưu ấy sẽ đè lên sau — không nhận đè ngược.
    if (pending) return;
    const servingChanged = (match.servingTeam === 'B' ? 'B' : 'A') !== state.servingTeam || (Number(match.scoreOrder) === 1 ? 1 : 2) !== state.scoreOrder;
    state = {
      ...state,
      scoreA: Number(match.scoreA) || 0,
      scoreB: Number(match.scoreB) || 0,
      scoreOrder: Number(match.scoreOrder) === 1 ? 1 : 2,
      servingTeam: match.servingTeam === 'B' ? 'B' : 'A',
      scoreHistory: [],
    };
    // Máy khác đổi đội / đổi tay thì người giao phải tính lại, không giữ nguyên người cũ như trước.
    if (servingChanged) {
      state.firstServerActive = state.scoreA === 0 && state.scoreB === 0 && state.scoreOrder !== 1;
      syncServingPlayer();
    }
    renderModal();
    setStatus('Máy khác vừa cập nhật', 'text-primary');
  });

  socket.on(socketEvents.SCORE_REJECTED || 'scoreRejected', (payload) => {
    if (payload && payload.retryable === false) {
      pending = null;
      window.clearTimeout(retryTimer);
    }
    setStatus(payload?.message || 'Không lưu được điểm', 'text-danger');
  });

  list.addEventListener('click', (event) => {
    const row = event.target.closest('[data-match-id]');
    if (row) openModal(row);
  });

  list.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const row = event.target.closest('[data-match-id]');
    if (!row) return;
    event.preventDefault();
    openModal(row);
  });

  document.querySelectorAll('[data-score-close]').forEach((item) => item.addEventListener('click', () => {
    if (item instanceof HTMLButtonElement && typeof setActionLoading === 'function') setActionLoading(item, 'Đang đóng...');
    window.setTimeout(closeModal, 60);
  }));

  document.querySelectorAll('[data-serving-select], [data-serving-side]').forEach((item) => {
    item.addEventListener('click', (event) => {
      const clicked = event.target instanceof Element ? event.target : null;
      if (clicked?.closest('[data-score-target]')) return;
      const displaySide = item.dataset.servingSelect || item.dataset.servingSide;
      if (!displaySide || !activeRow) return;
      const side = teamOnSide(displaySide);
      const selectingFirstServer = Boolean(setupStep?.contains(item));
      // Bước chọn đội giao trước, trận chưa có điểm: bấm đội nào cũng là "chọn người giao đầu" — KỂ CẢ bấm
      // lại đúng đội đang chọn sẵn. Trước 28/9/2026 ca ấy rơi xuống nhánh đổi đội giữa trận, tắt
      // firstServerActive, người giao thành tay 2 = ô 2 (chủ app báo "đổi người xong đứng ô 2").
      if (selectingFirstServer && isInitialServeState()) {
        const nextServingTeam = side === 'B' ? 'B' : 'A';
        const changed = nextServingTeam !== state.servingTeam || state.scoreOrder !== 2 || !state.firstServerActive;
        state = {
          ...state,
          servingTeam: nextServingTeam,
          scoreOrder: 2,
          servingPlayer: playerAtSlot(nextServingTeam, 1),
          firstServerActive: true,
          scoreHistory: [],
        };
        optimisticRow();
        renderModal();
        scheduleSpeak(0);
        if (changed) saveScore();
        return;
      }
      // Đánh đôi: chỉ mất giao khi cả hai tay đã giao. Đánh đơn: thua bóng là đổi giao ngay.
      if (!singles && side !== state.servingTeam && state.scoreOrder !== 2) {
        setStatus('Chỉ đổi đội giao khi đang ở tay 2', 'text-danger');
        scheduleSpeak(0);
        return;
      }
      const changedServingTeam = side !== state.servingTeam;
      state = {
        ...state,
        servingTeam: side === 'B' ? 'B' : 'A',
        scoreOrder: singles ? 2 : changedServingTeam ? 1 : state.scoreOrder,
        firstServerActive: false,
        scoreHistory: [],
      };
      if (changedServingTeam) state.servingPlayer = playerAtSlot(state.servingTeam, 1);
      optimisticRow();
      renderModal();
      scheduleSpeak(0);
      saveScore();
    });
  });

  document.querySelectorAll('[data-score-order-select]').forEach((button) => {
    button.addEventListener('click', () => {
      const nextOrder = Number(button.dataset.scoreOrderSelect) === 1 ? 1 : 2;
      const previousOrder = state.scoreOrder;
      state = { ...state, scoreOrder: nextOrder, firstServerActive: nextOrder === 1 ? false : state.firstServerActive, scoreHistory: [] };
      if (nextOrder === 2 && isInitialServeState()) {
        state.firstServerActive = true;
        state.servingPlayer = playerAtSlot(state.servingTeam, 1);
      } else if (nextOrder === 1) {
        state.servingPlayer = playerAtSlot(state.servingTeam, 1);
        state.firstServerActive = false;
      } else if (!state.firstServerActive && previousOrder === 1) {
        state.servingPlayer = otherPlayer(state.servingPlayer);
      } else if (!state.firstServerActive) {
        state.servingPlayer = otherPlayer(playerAtSlot(state.servingTeam, 1));
      } else {
        state.servingPlayer = playerAtSlot(state.servingTeam, 1);
      }
      optimisticRow();
      renderModal();
      scheduleSpeak(0);
      saveScore();
    });
  });

  document.querySelectorAll('[data-score-target]').forEach((button) => {
    button.addEventListener('click', () => {
      stepScore(button.dataset.scoreTarget, Number.parseInt(button.dataset.scoreDelta || '0', 10) || 0);
    });
  });

  setupContinue?.addEventListener('click', () => {
    saveSetup();
    renderModal();
    showPlayStep();
    scheduleSpeak(120);
  });

  backToSetup?.addEventListener('click', () => {
    if (!canEditSetup()) {
      setStatus('Chỉ đổi tay khi điểm đang là 0-0.', 'text-danger');
      return;
    }
    showSetupStep();
  });

  swapCourt?.addEventListener('click', () => {
    if (!activeRow) return;
    // Chỉ tráo vị trí hiển thị hai đội trên sân; điểm, người giao và ô1/ô2 giữ nguyên.
    state.sidesSwapped = !state.sidesSwapped;
    renderPlayerSettings();
    renderModal();
    saveSetup();
    setStatus('Đã đổi sân hiển thị', 'text-primary');
  });

  ['A', 'B'].forEach((side) => {
    const refs = playerRefs[side];
    refs.first?.addEventListener('change', () => {
      const team = teamOnSide(side);
      state.positions[team][1] = refs.first.value;
      normalizePositionAfterChange(team, '1');
      if (state.servingTeam === team) syncServingPlayer();
      renderPlayerSettings();
      renderModal();
      saveSetup();
    });
    refs.second?.addEventListener('change', () => {
      const team = teamOnSide(side);
      state.positions[team][2] = refs.second.value;
      normalizePositionAfterChange(team, '2');
      if (state.servingTeam === team) syncServingPlayer();
      renderPlayerSettings();
      renderModal();
      saveSetup();
    });
  });
})();

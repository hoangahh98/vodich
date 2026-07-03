const parseMoneyValue = (value) => Number(String(value || '0').replace(/[^\d.-]/g, '')) || 0;
const formatMoneyValue = (value) => Math.max(0, Number(value) || 0).toLocaleString('en-US');
const currentPrizeFund = (form) => {
  const totalPaid = parseMoneyValue(form?.dataset.prizeTotalPaid || '0');
  if (!form) return 0;
  const operatingCost = ['courtCost', 'foodCost', 'otherCost'].reduce((sum, name) => sum + parseMoneyValue(form.querySelector(`[name="${name}"]`)?.value), 0);
  return Math.max(0, totalPaid - operatingCost);
};
const manualPrizeTotal = (form) => ['prizeRate1', 'prizeRate2', 'prizeRate3'].reduce((sum, name) => sum + parseMoneyValue(form?.querySelector(`[name="${name}"]`)?.value), 0);
const prizeSuggestion = (prizeFund) => {
  const first = Math.floor(prizeFund * 0.5);
  const second = Math.floor(prizeFund * 0.3);
  return [first, second, Math.max(0, prizeFund - first - second)];
};
const setActionLoading = (button, fallback = 'Đang xử lý...') => {
  if (!button || button.classList.contains('loading')) return;
  button.dataset.originalText = button.textContent || '';
  button.textContent = button.getAttribute('data-loading-text') || fallback;
  button.classList.add('loading');
  button.setAttribute('aria-busy', 'true');
};
const clearActionLoading = (item) => {
  item.classList.remove('loading');
  item.removeAttribute('aria-busy');
  if (item.dataset.originalText) item.textContent = item.dataset.originalText;
};
let pageBusyTimer = null;
const showPageBusy = (text = 'Đang xử lý...', delay = 120) => {
  window.clearTimeout(pageBusyTimer);
  pageBusyTimer = window.setTimeout(() => {
  let toast = document.querySelector('.page-busy-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'page-busy-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = text;
  document.body.classList.add('page-busy');
  }, delay);
};
const clearPageBusy = () => {
  window.clearTimeout(pageBusyTimer);
  document.body.classList.remove('page-busy');
  document.querySelectorAll('.loading[aria-busy="true"]').forEach((item) => {
    clearActionLoading(item);
  });
};
window.addEventListener('pageshow', clearPageBusy);
window.addEventListener('pagehide', () => document.body.classList.remove('page-busy'));

document.addEventListener('submit', (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  if (form.dataset.submitting === 'true') {
    event.preventDefault();
    return;
  }
  const requiredCheckedName = form.dataset.requireChecked;
  if (requiredCheckedName && !form.querySelector(`input[name="${requiredCheckedName}"]:checked`)) {
    event.preventDefault();
    alert('Chưa chọn thành viên nào.');
    return;
  }
  const confirmMessage = form.dataset.confirm;
  if (confirmMessage && !window.confirm(confirmMessage)) {
    event.preventDefault();
    return;
  }
  const prizeMode = form.querySelector('input[name="prizeMode"]:checked');
  if (prizeMode?.value === 'percent') {
    const total = ['prizeRate1', 'prizeRate2', 'prizeRate3'].reduce((sum, name) => {
      const input = form.querySelector(`[name="${name}"]`);
      return sum + parseMoneyValue(input?.value);
    }, 0);
    if (total > 100) {
      event.preventDefault();
      alert('Tổng tỷ lệ giải thưởng không được vượt quá 100%.');
      return;
    }
  } else if (prizeMode?.value === 'manual') {
    const prizeFund = currentPrizeFund(form);
    const total = manualPrizeTotal(form);
    if (total > prizeFund) {
      event.preventDefault();
      alert(`Tổng tiền thưởng thủ công không được vượt quá quỹ thưởng hiện có (${formatMoneyValue(prizeFund)}đ).`);
      return;
    }
  }
  const button = event.submitter instanceof HTMLButtonElement ? event.submitter : form.querySelector('button[type="submit"], button:not([type])');
  form.dataset.submitting = 'true';
  form.setAttribute('aria-busy', 'true');
  showPageBusy(button?.getAttribute('data-loading-text') || 'Đang xử lý...', 0);
  if (!button) return;
  setActionLoading(button);
  form.querySelectorAll('button').forEach((item) => {
    if (item !== button) item.disabled = true;
  });
});

document.addEventListener('click', (event) => {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
  const target = event.target instanceof Element ? event.target : null;
  const link = target?.closest('a[href]');
  if (!(link instanceof HTMLAnchorElement)) return;
  const href = link.getAttribute('href') || '';
  if (link.target || link.hasAttribute('download') || href.startsWith('#') || href.startsWith('javascript:')) return;
  const url = new URL(link.href, window.location.href);
  if (url.origin !== window.location.origin) return;
  event.preventDefault();
  showPageBusy(link.getAttribute('data-loading-text') || 'Đang mở...', 0);
  if (link.classList.contains('btn')) setActionLoading(link, 'Đang mở...');
  window.setTimeout(() => window.location.assign(url.href), 70);
});

document.addEventListener('input', (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || !input.classList.contains('money-input')) return;
  const digits = input.value.replace(/[^\d]/g, '');
  input.value = digits ? Number(digits).toLocaleString('en-US') : '';
});

const getAppSocket = () => {
  if (typeof io === 'undefined') return null;
  if (!window.vodichSocket) window.vodichSocket = io();
  return window.vodichSocket;
};

const getTournamentSocket = (tournamentId) => {
  const socket = getAppSocket();
  if (!socket || !tournamentId) return null;
  if (window.joinedTournamentId !== String(tournamentId)) {
    socket.emit('joinTournament', String(tournamentId));
    window.joinedTournamentId = String(tournamentId);
  }
  return socket;
};

const getTeamSocket = (teamId) => {
  const socket = getAppSocket();
  if (!socket || !teamId) return null;
  if (window.joinedTeamId !== String(teamId)) {
    socket.emit('joinTeam', String(teamId));
    window.joinedTeamId = String(teamId);
  }
  return socket;
};

(() => {
  const formatSelect = document.querySelector('select[name="format"]');
  const formatRadios = [...document.querySelectorAll('input[name="format"]')];
  const qualifierField = document.getElementById('knockoutQualifierField');
  const qualifierInput = document.getElementById('knockoutQualifierCount');
  const finalBox = document.getElementById('knockoutFinal');
  const semiBox = document.getElementById('knockoutSemi');
  const quarterBox = document.getElementById('knockoutQuarter');
  const expectedPlayersInput = document.querySelector('input[name="expectedPlayers"]');
  const playTypeSelect = document.querySelector('select[name="playType"]');
  if ((!formatSelect && !formatRadios.length) || !qualifierField) return;
  const currentFormat = () => formatSelect?.value || formatRadios.find((radio) => radio.checked)?.value;
  const estimatedTeamCount = () => {
    const players = Number.parseInt(expectedPlayersInput?.value || '0', 10) || 0;
    return playTypeSelect?.value === 'DOUBLES' ? Math.floor(players / 2) : players;
  };
  const syncKnockout = () => {
    if (!qualifierInput || !finalBox || !semiBox || !quarterBox) return;
    const teamCount = estimatedTeamCount();
    [finalBox, semiBox, quarterBox].forEach((box) => {
      const enoughTeams = teamCount >= (Number.parseInt(box.dataset.minTeams || '0', 10) || 0);
      box.disabled = !enoughTeams;
      if (!enoughTeams) box.checked = false;
    });
    if (finalBox.disabled) {
      qualifierInput.value = '2';
      return;
    }
    if (semiBox.disabled || !finalBox.checked) semiBox.checked = false;
    if (quarterBox.disabled || !semiBox.checked) quarterBox.checked = false;
    if (quarterBox.checked) {
      semiBox.checked = true;
      finalBox.checked = true;
      qualifierInput.value = '8';
      return;
    }
    if (semiBox.checked) {
      finalBox.checked = true;
      qualifierInput.value = '4';
      return;
    }
    finalBox.checked = true;
    qualifierInput.value = '2';
  };
  const sync = () => {
    qualifierField.classList.toggle('hidden', currentFormat() !== 'GROUP_KNOCKOUT');
    syncKnockout();
  };
  formatSelect?.addEventListener('change', sync);
  formatRadios.forEach((radio) => radio.addEventListener('change', sync));
  [finalBox, semiBox, quarterBox].forEach((box) => box?.addEventListener('change', syncKnockout));
  [expectedPlayersInput, playTypeSelect].forEach((item) => item?.addEventListener('input', sync));
  [expectedPlayersInput, playTypeSelect].forEach((item) => item?.addEventListener('change', sync));
  sync();
})();

(() => {
  const prizeRadios = [...document.querySelectorAll('input[name="prizeMode"]')];
  if (!prizeRadios.length) return;
  const form = prizeRadios[0].closest('form');
  const sync = () => {
    const manual = prizeRadios.find((radio) => radio.checked)?.value === 'manual';
    const prizeFund = currentPrizeFund(form);
    const total = manualPrizeTotal(form);
    const left = prizeFund - total;
    document.querySelectorAll('[data-prize-label]').forEach((label) => {
      label.textContent = `Giải ${label.dataset.prizeLabel} ${manual ? '(đ)' : '(%)'}`;
    });
    document.querySelector('[data-manual-prize-summary]')?.classList.toggle('hidden', !manual);
    const fundEl = document.querySelector('[data-prize-fund]');
    const totalEl = document.querySelector('[data-manual-prize-total]');
    const leftEl = document.querySelector('[data-manual-prize-left]');
    if (fundEl) fundEl.textContent = `${formatMoneyValue(prizeFund)}đ`;
    if (totalEl) totalEl.textContent = `${formatMoneyValue(total)}đ`;
    if (leftEl) {
      leftEl.textContent = `${formatMoneyValue(left)}đ`;
      leftEl.classList.toggle('text-danger', manual && left < 0);
    }
    prizeSuggestion(prizeFund).forEach((value, index) => {
      const el = document.querySelector(`[data-prize-suggest="${index + 1}"]`);
      if (el) el.textContent = `${formatMoneyValue(value)}đ`;
    });
    document.querySelector('[data-prize-fund-box]')?.classList.toggle('warn', manual && left < 0);
  };
  prizeRadios.forEach((radio) => radio.addEventListener('change', sync));
  ['courtCost', 'foodCost', 'otherCost', 'prizeRate1', 'prizeRate2', 'prizeRate3'].forEach((name) => {
    form?.querySelector(`[name="${name}"]`)?.addEventListener('input', sync);
  });
  document.querySelector('[data-fill-prize-suggestion]')?.addEventListener('click', () => {
    prizeSuggestion(currentPrizeFund(form)).forEach((value, index) => {
      const input = form?.querySelector(`[name="prizeRate${index + 1}"]`);
      if (input) input.value = formatMoneyValue(value);
    });
    const manualRadio = form?.querySelector('input[name="prizeMode"][value="manual"]');
    if (manualRadio) manualRadio.checked = true;
    sync();
  });
  sync();
})();

(() => {
  document.querySelectorAll('[data-menu-toggle]').forEach((button) => {
    const menu = button.closest('.bottom-menu');
    let closeTimer = null;
    let dragState = null;
    const closeMenu = () => menu?.classList.remove('open');
    const storageKey = 'vodichBottomMenuPosition';
    const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
    const applyPosition = (left, top) => {
      if (!menu) return;
      const rect = menu.getBoundingClientRect();
      const nextLeft = clamp(left, 8, window.innerWidth - rect.width - 8);
      const nextTop = clamp(top, 8, window.innerHeight - rect.height - 8);
      menu.style.left = `${nextLeft}px`;
      menu.style.top = `${nextTop}px`;
      menu.style.right = 'auto';
      menu.style.bottom = 'auto';
    };
    const keepInViewport = () => {
      if (!menu) return;
      const rect = menu.getBoundingClientRect();
      applyPosition(rect.left, rect.top);
      const nextRect = menu.getBoundingClientRect();
      window.localStorage.setItem(storageKey, JSON.stringify({ left: nextRect.left, top: nextRect.top }));
    };
    try {
      const saved = JSON.parse(window.localStorage.getItem(storageKey) || 'null');
      if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) applyPosition(saved.left, saved.top);
    } catch (_) {}
    window.addEventListener('resize', keepInViewport);
    window.addEventListener('orientationchange', () => window.setTimeout(keepInViewport, 120));
    button.addEventListener('pointerdown', (event) => {
      if (!menu || event.button !== 0) return;
      const rect = menu.getBoundingClientRect();
      dragState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        left: rect.left,
        top: rect.top,
        moved: false,
      };
      button.setPointerCapture?.(event.pointerId);
    });
    button.addEventListener('pointermove', (event) => {
      if (!menu || !dragState || dragState.pointerId !== event.pointerId) return;
      const dx = event.clientX - dragState.startX;
      const dy = event.clientY - dragState.startY;
      if (Math.abs(dx) + Math.abs(dy) < 8) return;
      event.preventDefault();
      dragState.moved = true;
      menu.classList.add('is-dragging');
      closeMenu();
      applyPosition(dragState.left + dx, dragState.top + dy);
    });
    button.addEventListener('pointerup', (event) => {
      if (!menu || !dragState || dragState.pointerId !== event.pointerId) return;
      const moved = dragState.moved;
      dragState = null;
      menu.classList.remove('is-dragging');
      const rect = menu.getBoundingClientRect();
      window.localStorage.setItem(storageKey, JSON.stringify({ left: rect.left, top: rect.top }));
      if (moved) {
        event.preventDefault();
        event.stopPropagation();
        button.dataset.justDragged = 'true';
        window.setTimeout(() => delete button.dataset.justDragged, 0);
      }
    });
    button.addEventListener('pointercancel', () => {
      dragState = null;
      menu?.classList.remove('is-dragging');
    });
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      if (button.dataset.justDragged === 'true') return;
      const menu = button.closest('.bottom-menu');
      menu?.classList.toggle('open');
    });
    menu?.addEventListener('mouseenter', () => window.clearTimeout(closeTimer));
    menu?.addEventListener('mouseleave', () => {
      window.clearTimeout(closeTimer);
      closeTimer = window.setTimeout(closeMenu, 250);
    });
    document.addEventListener('click', (event) => {
      if (!menu?.contains(event.target)) closeMenu();
    });
  });
})();

(() => {
  const selects = [...document.querySelectorAll('[data-manual-pair-select]')];
  if (!selects.length) return;
  selects.forEach((select) => {
    select.dataset.options = JSON.stringify([...select.options].map((option) => ({ value: option.value, text: option.textContent || '' })));
  });
  const sync = () => {
    const selected = new Set(selects.map((select) => select.value).filter(Boolean));
    selects.forEach((select) => {
      const currentValue = select.value;
      const options = JSON.parse(select.dataset.options || '[]');
      select.replaceChildren();
      options.forEach((option) => {
        if (option.value && option.value !== currentValue && selected.has(option.value)) return;
        select.add(new Option(option.text, option.value, false, option.value === currentValue));
      });
    });
  };
  selects.forEach((select) => select.addEventListener('change', sync));
  sync();
})();

(() => {
  const picker = document.querySelector('[data-team-member-picker]');
  if (!picker) return;
  const checkboxes = [...picker.querySelectorAll('input[type="checkbox"][name="playerIds"]')];
  const counter = document.querySelector('[data-team-member-count]');
  const sync = () => {
    const count = checkboxes.filter((checkbox) => checkbox.checked).length;
    if (!counter) return;
    counter.textContent = `Đã chọn ${count} thành viên`;
    counter.classList.toggle('text-danger', count === 0);
    counter.classList.toggle('text-primary', count > 0);
  };
  checkboxes.forEach((checkbox) => checkbox.addEventListener('change', sync));
  sync();
})();

(() => {
  const shell = document.querySelector('[data-tournament-id]');
  let ranking = document.querySelector('.ranking-live');
  if (!shell || !ranking) return;
  const socket = getTournamentSocket(shell.dataset.tournamentId);
  if (!socket) return;
  let refreshTimer = null;
  const refreshRanking = () => {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(async () => {
      const response = await fetch(`${window.location.pathname}?realtime=${Date.now()}`, { headers: { 'X-Requested-With': 'fetch' } });
      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const fresh = doc.querySelector('.ranking-live');
      if (fresh && ranking) {
        ranking.replaceWith(fresh);
        ranking = fresh;
      }
    }, 250);
  };
  socket.on('scoreUpdated', refreshRanking);
})();

(() => {
  const shell = document.querySelector('[data-tournament-id]');
  if (!shell) return;
  const socket = getTournamentSocket(shell.dataset.tournamentId);
  if (!socket) return;
  let reloadTimer = null;
  socket.on('tournamentUpdated', () => {
    window.clearTimeout(reloadTimer);
    reloadTimer = window.setTimeout(() => window.location.reload(), 300);
  });
})();

(() => {
  const shell = document.querySelector('[data-team-id]');
  if (!shell) return;
  const socket = getTeamSocket(shell.dataset.teamId);
  if (!socket) return;
  let reloadTimer = null;
  socket.on('teamUpdated', (payload) => {
    if (String(payload?.teamId || '') !== String(shell.dataset.teamId)) return;
    window.clearTimeout(reloadTimer);
    reloadTimer = window.setTimeout(() => window.location.reload(), 300);
  });
})();

(() => {
  const shell = document.querySelector('[data-teams-index]');
  if (!shell) return;
  const socket = getAppSocket();
  if (!socket) return;
  let reloadTimer = null;
  socket.on('teamsUpdated', () => {
    window.clearTimeout(reloadTimer);
    reloadTimer = window.setTimeout(() => window.location.reload(), 300);
  });
})();

(() => {
  document.querySelectorAll('[data-open-modal]').forEach((button) => {
    button.addEventListener('click', () => {
      const modal = document.getElementById(button.dataset.openModal || '');
      modal?.classList.remove('hidden');
      modal?.setAttribute('aria-hidden', 'false');
    });
  });
  document.querySelectorAll('[data-close-modal]').forEach((button) => {
    button.addEventListener('click', () => {
      const modal = document.getElementById(button.dataset.closeModal || '');
      modal?.classList.add('hidden');
      modal?.setAttribute('aria-hidden', 'true');
    });
  });
  document.querySelectorAll('[data-copy-target]').forEach((button) => {
    button.addEventListener('click', async () => {
      const target = document.getElementById(button.dataset.copyTarget || '');
      const text = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ? target.value : target?.textContent || '';
      if (!text.trim()) return;
      try {
        await navigator.clipboard.writeText(text);
        const original = button.textContent;
        button.textContent = 'Đã copy';
        window.setTimeout(() => {
          button.textContent = original;
        }, 1200);
      } catch (_) {
        window.prompt('Copy', text);
      }
    });
  });
})();

(() => {
  document.querySelectorAll('[data-check-all]').forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      document.querySelectorAll(checkbox.dataset.checkAll).forEach((item) => {
        if (item instanceof HTMLInputElement) item.checked = checkbox.checked;
      });
    });
  });
})();

(() => {
  const hint = document.getElementById('playerSlotHint');
  const picker = document.querySelector('[data-player-picker]');
  if (!hint || !picker) return;
  const totalSlots = Number.parseInt(hint.dataset.slotsLeft || '0', 10) || 0;
  const slotCount = hint.querySelector('[data-slot-count]');
  const selectedCount = hint.querySelector('[data-selected-count]');
  const sync = () => {
    const selected = picker.querySelectorAll('input[type="checkbox"]:checked').length;
    const officialLeft = Math.max(0, totalSlots - selected);
    if (slotCount) slotCount.textContent = String(officialLeft);
    if (selectedCount) selectedCount.textContent = String(selected);
    hint.classList.toggle('warn', officialLeft === 0);
    hint.classList.toggle('info', officialLeft > 0);
  };
  picker.addEventListener('change', sync);
  sync();
})();

(() => {
  const list = document.getElementById('matchList');
  if (!list) return;
  const tournamentId = list.dataset.tournamentId;
  const socket = getTournamentSocket(tournamentId);
  if (!socket) return;
  const groupTouchScore = Number.parseInt(list.dataset.touchScore || '11', 10) || 11;
  const groupMaxScore = Number.parseInt(list.dataset.maxScore || '15', 10) || 15;
  const knockoutTouchScore = Number.parseInt(list.dataset.knockoutTouchScore || '15', 10) || 15;
  const knockoutMaxScore = Number.parseInt(list.dataset.knockoutMaxScore || '19', 10) || 19;
  const modal = document.getElementById('scoreModal');
  const scoreTeamA = document.getElementById('scoreTeamA');
  const scoreTeamB = document.getElementById('scoreTeamB');
  const scoreValueA = document.getElementById('scoreInputA');
  const scoreValueB = document.getElementById('scoreInputB');
  const scoreSideA = document.getElementById('scoreSideA');
  const scoreSideB = document.getElementById('scoreSideB');
  const saveStatus = document.getElementById('scoreSaveStatus');
  let activeRow = null;
  let scoreA = 0;
  let scoreB = 0;
  let servingTeam = 'A';
  let scoreOrder = 2;
  let saveTimer = null;
  const activeRules = () => (activeRow?.dataset.knockout === 'true'
    ? { touchScore: knockoutTouchScore, maxScore: knockoutMaxScore }
    : { touchScore: groupTouchScore, maxScore: groupMaxScore });
  const maxAllowedScore = (opponentScore) => {
    const { touchScore, maxScore } = activeRules();
    if (opponentScore >= touchScore - 1) return Math.min(opponentScore + 2, maxScore);
    return Math.min(touchScore, maxScore);
  };
  const clampScores = (a, b) => {
    let nextA = Math.min(Math.max(0, a), maxAllowedScore(b));
    let nextB = Math.min(Math.max(0, b), maxAllowedScore(nextA));
    nextA = Math.min(nextA, maxAllowedScore(nextB));
    return [nextA, nextB];
  };
  const formatTeam = (name) => String(name || '').split(' / ').join('\n');
  let lastWinnerKey = '';
  let speakTimer = null;
  const readVietnameseNumber = (value) => {
    const number = Number.parseInt(value, 10) || 0;
    const units = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
    if (number < 10) return units[number];
    if (number === 10) return 'mười';
    if (number < 20) return number === 15 ? 'mười lăm' : `mười ${units[number % 10]}`;
    const tens = Math.floor(number / 10);
    const unit = number % 10;
    if (unit === 0) return `${units[tens]} mươi`;
    if (unit === 1) return `${units[tens]} mươi mốt`;
    if (unit === 5) return `${units[tens]} mươi lăm`;
    return `${units[tens]} mươi ${units[unit]}`;
  };
  const teamSpeechName = (name) => String(name || '').replace(/\s*\/\s*/g, ' và ');
  const winnerName = () => {
    if (!activeRow || scoreA === scoreB) return '';
    const { touchScore, maxScore } = activeRules();
    const high = Math.max(scoreA, scoreB);
    const diff = Math.abs(scoreA - scoreB);
    if (!(high >= maxScore || (high >= touchScore && diff >= 2))) return '';
    return teamSpeechName(scoreA > scoreB ? activeRow.dataset.teamA : activeRow.dataset.teamB);
  };
  const speak = (text) => {
    if (!('speechSynthesis' in window) || !text) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'vi-VN';
    utterance.rate = 0.95;
    window.speechSynthesis.speak(utterance);
  };
  const speakCurrentScore = () => {
    const scoreText = servingTeam === 'B'
      ? `${readVietnameseNumber(scoreB)} ${readVietnameseNumber(scoreA)} ${readVietnameseNumber(scoreOrder)}`
      : `${readVietnameseNumber(scoreA)} ${readVietnameseNumber(scoreB)} ${readVietnameseNumber(scoreOrder)}`;
    const winner = winnerName();
    const winnerKey = activeRow ? `${activeRow.dataset.matchId}:${winner}:${scoreA}-${scoreB}` : '';
    if (winner && winnerKey !== lastWinnerKey) {
      lastWinnerKey = winnerKey;
      const prefix = winner.includes(' và ') ? 'đội ' : '';
      speak(`${scoreText}. Chúc mừng ${prefix}${winner} giành chiến thắng`);
      return;
    }
    speak(scoreText);
  };
  const scheduleSpeak = (delay = 220) => {
    window.clearTimeout(speakTimer);
    if (delay <= 0) {
      speakCurrentScore();
      return;
    }
    speakTimer = window.setTimeout(speakCurrentScore, delay);
  };
  const setStatus = (text, className = 'muted') => {
    if (!saveStatus) return;
    saveStatus.className = `score-save-status ${className}`;
    saveStatus.textContent = text;
  };
  const renderModal = () => {
    if (!scoreValueA || !scoreValueB) return;
    scoreValueA.textContent = String(scoreA);
    scoreValueB.textContent = String(scoreB);
    scoreSideA?.classList.toggle('serving-team', servingTeam === 'A');
    scoreSideB?.classList.toggle('serving-team', servingTeam === 'B');
    document.querySelectorAll('[data-score-target]').forEach((button) => { button.disabled = false; });
    document.querySelectorAll('[data-serving-select]').forEach((button) => {
      button.classList.toggle('btn-primary', button.dataset.servingSelect === servingTeam);
    });
    document.querySelectorAll('[data-score-order-select]').forEach((button) => {
      button.classList.toggle('btn-primary', Number(button.dataset.scoreOrderSelect) === scoreOrder);
    });
  };
  const updateRoundDoneCount = (row) => {
    const roundBlock = row.closest('[data-round-block]');
    const doneCountEl = roundBlock?.querySelector('[data-done-count]');
    if (!roundBlock || !doneCountEl) return;
    doneCountEl.textContent = String(roundBlock.querySelectorAll('.tran-card.da-xong').length);
  };
  const applyRow = (row, match) => {
    row.dataset.scoreA = String(match.scoreA);
    row.dataset.scoreB = String(match.scoreB);
    row.dataset.scoreOrder = String(match.scoreOrder || 2);
    row.dataset.servingTeam = match.servingTeam || 'A';
    row.querySelector('.score-a').textContent = match.scoreA;
    row.querySelector('.score-b').textContent = match.scoreB;
    const scorePill = row.querySelector('.score-pill');
    scorePill?.classList.toggle('bg-success', match.status === 'FINISHED');
    scorePill?.classList.toggle('bg-primary', match.status !== 'FINISHED');
    const order = row.querySelector('.score-order');
    if (order) order.textContent = match.scoreOrder || 2;
    const status = match.status === 'FINISHED' ? 'Đã xong' : match.status === 'PLAYING' ? 'Đang đánh' : 'Chưa đánh';
    const statusEl = row.querySelector('.match-status');
    statusEl.textContent = status;
    statusEl.classList.toggle('bg-success', match.status === 'FINISHED');
    statusEl.classList.toggle('bg-secondary', match.status !== 'FINISHED');
    row.classList.toggle('da-xong', match.status === 'FINISHED');
    updateRoundDoneCount(row);
  };
  const optimisticRow = () => {
    if (!activeRow) return;
    const { touchScore, maxScore } = activeRules();
    const high = Math.max(scoreA, scoreB);
    const diff = Math.abs(scoreA - scoreB);
    const status = high >= maxScore || (high >= touchScore && diff >= 2 && scoreA !== scoreB) ? 'FINISHED' : 'PLAYING';
    applyRow(activeRow, { scoreA, scoreB, scoreOrder, servingTeam, status });
  };
  const saveScore = () => {
    if (!activeRow) return;
    const matchId = activeRow.dataset.matchId;
    const payload = { tournamentId, matchId, scoreA, scoreB, servingTeam, scoreOrder };
    window.clearTimeout(saveTimer);
    setStatus('Đang tự lưu...', 'text-primary');
    saveTimer = window.setTimeout(() => {
      socket.emit('score', payload);
      setStatus('Đã gửi điểm', 'text-success');
    }, 350);
  };
  const openModal = (row) => {
    if (!modal || !scoreTeamA || !scoreTeamB) return;
    activeRow = row;
    scoreA = Number.parseInt(row.dataset.scoreA || '0', 10) || 0;
    scoreB = Number.parseInt(row.dataset.scoreB || '0', 10) || 0;
    scoreOrder = Number.parseInt(row.dataset.scoreOrder || '2', 10) === 1 ? 1 : 2;
    servingTeam = row.dataset.servingTeam === 'B' ? 'B' : 'A';
    scoreTeamA.textContent = formatTeam(row.dataset.teamA);
    scoreTeamB.textContent = formatTeam(row.dataset.teamB);
    setStatus('Chưa thay đổi');
    renderModal();
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    scheduleSpeak(120);
  };
  const closeModal = () => {
    modal?.classList.add('hidden');
    modal?.setAttribute('aria-hidden', 'true');
    document.querySelectorAll('[data-score-close].loading').forEach(clearActionLoading);
    activeRow = null;
  };
  const stepScore = (side, delta) => {
    if (!activeRow) return;
    if (side !== servingTeam) {
      setStatus('Chỉ đội đang giao được ghi điểm. Muốn đổi đội giao phải ở tay 2.', 'text-danger');
      return;
    }
    if (side === 'A') scoreA = Math.max(0, scoreA + delta);
    if (side === 'B') scoreB = Math.max(0, scoreB + delta);
    [scoreA, scoreB] = clampScores(scoreA, scoreB);
    optimisticRow();
    renderModal();
    scheduleSpeak(0);
    saveScore();
  };
  socket.on('scoreUpdated', (match) => {
    const row = list.querySelector(`[data-match-id="${match.id}"]`);
    if (!row) return;
    applyRow(row, match);
    if (activeRow === row) {
      scoreA = Number(match.scoreA) || 0;
      scoreB = Number(match.scoreB) || 0;
      scoreOrder = Number(match.scoreOrder) === 1 ? 1 : 2;
      servingTeam = match.servingTeam === 'B' ? 'B' : 'A';
      renderModal();
      setStatus('Đã tự lưu', 'text-success');
    }
  });
  socket.on('scoreRejected', (payload) => {
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
    if (item instanceof HTMLButtonElement) setActionLoading(item, 'Đang đóng...');
    window.setTimeout(closeModal, 60);
  }));
  document.querySelectorAll('[data-serving-select], [data-serving-side]').forEach((item) => {
    item.addEventListener('click', (event) => {
      const clicked = event.target instanceof Element ? event.target : null;
      if (clicked?.closest('[data-score-target]')) return;
      const side = item.dataset.servingSelect || item.dataset.servingSide;
      if (!side || !activeRow) return;
      if (side !== servingTeam && scoreOrder !== 2) {
        setStatus('Chỉ đổi đội giao khi đang ở tay 2', 'text-danger');
        scheduleSpeak(0);
        return;
      }
      servingTeam = side === 'B' ? 'B' : 'A';
      if (activeRow.dataset.servingTeam !== servingTeam) scoreOrder = 1;
      optimisticRow();
      renderModal();
      scheduleSpeak(0);
      saveScore();
    });
  });
  document.querySelectorAll('[data-score-order-select]').forEach((button) => {
    button.addEventListener('click', () => {
      scoreOrder = Number(button.dataset.scoreOrderSelect) === 1 ? 1 : 2;
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
})();

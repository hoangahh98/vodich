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


window.Vodich = {
  ...(window.Vodich || {}),
  clearActionLoading,
  getAppSocket,
  getTeamSocket,
  getTournamentSocket,
  setActionLoading,
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

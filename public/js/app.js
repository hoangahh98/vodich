const parseMoneyValue = (value) => Number(String(value || '0').replace(/[^\d.-]/g, '')) || 0;
const formatMoneyValue = (value) => Math.max(0, Number(value) || 0).toLocaleString('en-US');

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
// Lưới an toàn: nếu người dùng rời app (mở file sang app khác, chuyển app rồi quay lại)
// mà trang không hề điều hướng thì spinner sẽ kẹt lại — quay về là dọn luôn.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') clearPageBusy();
});

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
  if (window.Vodich?.validateTournamentPrizeForm && !window.Vodich.validateTournamentPrizeForm(form)) {
    event.preventDefault();
    return;
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

// Nút bị khoá: chặn bấm và nói rõ vì sao, thay vì im lặng không phản ứng.
document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const blocked = target?.closest('[data-blocked]');
  if (!blocked) return;
  event.preventDefault();
  event.stopPropagation();
  const message = blocked.getAttribute('data-blocked');
  if (message) window.alert(message);
}, true);

document.addEventListener('click', (event) => {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
  const target = event.target instanceof Element ? event.target : null;
  const link = target?.closest('a[href]');
  if (!(link instanceof HTMLAnchorElement)) return;
  const href = link.getAttribute('href') || '';
  // data-no-busy: link KHÔNG làm trang điều hướng (vd file .ics giao cho app Lịch của
  // iPhone, trang đứng nguyên). Bật spinner cho những link này thì nó quay mãi không tắt.
  if (link.hasAttribute('data-no-busy')) return;
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

// Tự gửi form khi đổi giá trị (thay cho onchange inline, để CSP script-src 'self' hoạt động).
document.addEventListener('change', (event) => {
  const el = event.target instanceof Element ? event.target.closest('[data-autosubmit]') : null;
  if (el && el.form) el.form.submit();
});

const getAppSocket = () => {
  if (typeof io === 'undefined') return null;
  if (!window.vodichSocket) window.vodichSocket = io();
  return window.vodichSocket;
};

const socketEvents = Object.freeze({
  JOIN_TOURNAMENT: 'joinTournament',
  JOIN_TEAM: 'joinTeam',
  JOIN_TRAVEL_TRIP: 'joinTravelTrip',
  SCORE: 'score',
  SCORE_UPDATED: 'scoreUpdated',
  SCORE_REJECTED: 'scoreRejected',
  TOURNAMENT_UPDATED: 'tournamentUpdated',
  TEAM_UPDATED: 'teamUpdated',
  TEAMS_UPDATED: 'teamsUpdated',
  TRAVEL_TRIP_UPDATED: 'travelTripUpdated',
  TRAVEL_TRIPS_UPDATED: 'travelTripsUpdated',
});

const getTournamentSocket = (tournamentId) => {
  const socket = getAppSocket();
  if (!socket || !tournamentId) return null;
  if (window.joinedTournamentId !== String(tournamentId)) {
    socket.emit(socketEvents.JOIN_TOURNAMENT, String(tournamentId));
    window.joinedTournamentId = String(tournamentId);
  }
  return socket;
};

const getTeamSocket = (teamId) => {
  const socket = getAppSocket();
  if (!socket || !teamId) return null;
  if (window.joinedTeamId !== String(teamId)) {
    socket.emit(socketEvents.JOIN_TEAM, String(teamId));
    window.joinedTeamId = String(teamId);
  }
  return socket;
};

const getTravelTripSocket = (tripId) => {
  const socket = getAppSocket();
  if (!socket || !tripId) return null;
  if (window.joinedTravelTripId !== String(tripId)) {
    socket.emit(socketEvents.JOIN_TRAVEL_TRIP, String(tripId));
    window.joinedTravelTripId = String(tripId);
  }
  return socket;
};

window.Vodich = {
  ...(window.Vodich || {}),
  clearActionLoading,
  formatMoneyValue,
  getAppSocket,
  getTeamSocket,
  getTravelTripSocket,
  getTournamentSocket,
  parseMoneyValue,
  setActionLoading,
  socketEvents,
};

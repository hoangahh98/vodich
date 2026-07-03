(() => {
  const events = window.Vodich?.socketEvents || {};
  const shell = document.querySelector('[data-tournament-id]');
  let ranking = document.querySelector('.ranking-live');
  if (!shell || !ranking) return;
  const socket = window.Vodich?.getTournamentSocket?.(shell.dataset.tournamentId);
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
  socket.on(events.SCORE_UPDATED || 'scoreUpdated', refreshRanking);
})();

(() => {
  const events = window.Vodich?.socketEvents || {};
  const shell = document.querySelector('[data-tournament-id]');
  if (!shell) return;
  const socket = window.Vodich?.getTournamentSocket?.(shell.dataset.tournamentId);
  if (!socket) return;
  let reloadTimer = null;
  socket.on(events.TOURNAMENT_UPDATED || 'tournamentUpdated', () => {
    window.clearTimeout(reloadTimer);
    reloadTimer = window.setTimeout(() => window.location.reload(), 300);
  });
})();

(() => {
  const events = window.Vodich?.socketEvents || {};
  const shell = document.querySelector('[data-team-id]');
  if (!shell) return;
  const socket = window.Vodich?.getTeamSocket?.(shell.dataset.teamId);
  if (!socket) return;
  let reloadTimer = null;
  socket.on(events.TEAM_UPDATED || 'teamUpdated', (payload) => {
    if (String(payload?.teamId || '') !== String(shell.dataset.teamId)) return;
    window.clearTimeout(reloadTimer);
    reloadTimer = window.setTimeout(() => window.location.reload(), 300);
  });
})();

(() => {
  const events = window.Vodich?.socketEvents || {};
  const shell = document.querySelector('[data-teams-index]');
  if (!shell) return;
  const socket = window.Vodich?.getAppSocket?.();
  if (!socket) return;
  let reloadTimer = null;
  socket.on(events.TEAMS_UPDATED || 'teamsUpdated', () => {
    window.clearTimeout(reloadTimer);
    reloadTimer = window.setTimeout(() => window.location.reload(), 300);
  });
})();

(() => {
  const events = window.Vodich?.socketEvents || {};
  const shell = document.querySelector('[data-travel-trip-id]');
  if (!shell) return;
  const socket = window.Vodich?.getTravelTripSocket?.(shell.dataset.travelTripId);
  if (!socket) return;
  let reloadTimer = null;
  socket.on(events.TRAVEL_TRIP_UPDATED || 'travelTripUpdated', (payload) => {
    if (String(payload?.tripId || '') !== String(shell.dataset.travelTripId)) return;
    window.clearTimeout(reloadTimer);
    reloadTimer = window.setTimeout(() => window.location.reload(), 300);
  });
})();

(() => {
  const events = window.Vodich?.socketEvents || {};
  const shell = document.querySelector('[data-travel-index]');
  if (!shell) return;
  const socket = window.Vodich?.getAppSocket?.();
  if (!socket) return;
  let reloadTimer = null;
  socket.on(events.TRAVEL_TRIPS_UPDATED || 'travelTripsUpdated', () => {
    window.clearTimeout(reloadTimer);
    reloadTimer = window.setTimeout(() => window.location.reload(), 300);
  });
})();

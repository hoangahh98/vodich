export const SOCKET_EVENTS = {
  JOIN_TOURNAMENT: 'joinTournament',
  JOIN_TEAM: 'joinTeam',
  SCORE: 'score',
  SCORE_UPDATED: 'scoreUpdated',
  SCORE_REJECTED: 'scoreRejected',
  TOURNAMENT_UPDATED: 'tournamentUpdated',
  TEAM_UPDATED: 'teamUpdated',
  TEAMS_UPDATED: 'teamsUpdated',
} as const;

export type ScorePayload = {
  tournamentId: string;
  matchId: string;
  scoreA: number;
  scoreB: number;
  servingTeam?: string;
  scoreOrder?: number;
};

export type TournamentUpdatedPayload = {
  tournamentId: string;
  reason: string;
};

export type TeamUpdatedPayload = {
  teamId: string;
  reason: string;
};

export type TeamsUpdatedPayload = {
  reason: string;
};

export const tournamentRoom = (tournamentId: string | bigint) => `tournament:${String(tournamentId)}`;
export const teamRoom = (teamId: string | bigint) => `team:${String(teamId)}`;

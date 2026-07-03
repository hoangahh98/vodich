export const SOCKET_EVENTS = {
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

export type TravelTripUpdatedPayload = {
  tripId: string;
  reason: string;
};

export const tournamentRoom = (tournamentId: string | bigint) => `tournament:${String(tournamentId)}`;
export const teamRoom = (teamId: string | bigint) => `team:${String(teamId)}`;
export const travelTripRoom = (tripId: string | bigint) => `travel:${String(tripId)}`;

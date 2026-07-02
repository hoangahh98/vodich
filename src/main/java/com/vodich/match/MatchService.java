package com.vodich.match;

import com.vodich.tournament.Tournament;
import com.vodich.tournament.TournamentRegistration;
import com.vodich.tournament.TournamentService;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class MatchService {
    private final MatchRepository matches;
    private final TournamentService tournaments;
    private final SimpMessagingTemplate messaging;

    public MatchService(MatchRepository matches, TournamentService tournaments, SimpMessagingTemplate messaging) {
        this.matches = matches;
        this.tournaments = tournaments;
        this.messaging = messaging;
    }

    public List<MatchGame> byTournament(Long tournamentId) {
        return matches.findByTournamentIdOrderByRoundNumberAscCourtNumberAscIdAsc(tournamentId);
    }

    @Transactional
    public void generateSchedule(Long tournamentId) {
        Tournament tournament = tournaments.get(tournamentId);
        List<String> names = tournaments.activeRegistrations(tournamentId).stream()
            .map(TournamentRegistration::getDisplayName)
            .toList();
        List<String> teams = buildTeams(tournament, names);
        matches.deleteByTournamentId(tournamentId);
        List<MatchGame> generated = groupStageMatches(tournament, teams);
        if (tournament.getFormat() == com.vodich.tournament.TournamentFormat.GROUP_KNOCKOUT) {
            int lastRound = generated.stream().mapToInt(MatchGame::getRoundNumber).max().orElse(0);
            generated.addAll(knockoutSkeleton(tournament, lastRound + 1));
        }
        matches.saveAll(generated);
        broadcast(tournamentId);
    }

    public void generateRoundRobin(Long tournamentId) {
        generateSchedule(tournamentId);
    }

    private List<String> buildTeams(Tournament tournament, List<String> names) {
        if (tournament.getPlayType() != com.vodich.tournament.PlayType.DOUBLES) {
            return names;
        }
        List<String> teams = new ArrayList<>();
        for (int i = 0; i < names.size(); i += 2) {
            String first = names.get(i);
            String second = i + 1 < names.size() ? names.get(i + 1) : "Chờ thành viên";
            teams.add(first + " / " + second);
        }
        return teams;
    }

    private List<MatchGame> groupStageMatches(Tournament tournament, List<String> teams) {
        List<MatchGame> generated = new ArrayList<>();
        String stage = tournament.getFormat() == com.vodich.tournament.TournamentFormat.GROUP_KNOCKOUT ? "Vòng bảng" : "Vòng tròn";
        List<List<String>> groups = tournament.getFormat() == com.vodich.tournament.TournamentFormat.GROUP_KNOCKOUT
            ? splitGroups(teams, groupCountFor(tournament, teams.size()))
            : List.of(teams);
        int round = 1;
        int court = 1;
        for (int groupIndex = 0; groupIndex < groups.size(); groupIndex++) {
            String groupName = groupLabel(groupIndex);
            List<String> groupTeams = groups.get(groupIndex);
            for (int i = 0; i < groupTeams.size(); i++) {
                for (int j = i + 1; j < groupTeams.size(); j++) {
                    generated.add(new MatchGame(tournament, groupTeams.get(i), groupTeams.get(j), court, round, stage, groupName));
                    court = nextCourt(tournament, court);
                    if (court == 1) {
                        round++;
                    }
                }
            }
        }
        return generated;
    }

    private int groupCountFor(Tournament tournament, int teamCount) {
        int desired = Math.max(1, tournament.getKnockoutQualifierCount() / 2);
        int maxUseful = Math.max(1, teamCount / 2);
        return Math.min(desired, maxUseful);
    }

    private List<List<String>> splitGroups(List<String> teams, int groupCount) {
        List<List<String>> groups = new ArrayList<>();
        for (int i = 0; i < groupCount; i++) {
            groups.add(new ArrayList<>());
        }
        for (int i = 0; i < teams.size(); i++) {
            groups.get(i % groupCount).add(teams.get(i));
        }
        return groups;
    }

    private String groupLabel(int index) {
        return String.valueOf((char) ('A' + index));
    }

    public List<RankingGroup> rankings(Long tournamentId) {
        Map<String, Map<String, RankingAccumulator>> groups = new LinkedHashMap<>();
        for (MatchGame match : byTournament(tournamentId)) {
            if (!isRankingMatch(match)) {
                continue;
            }
            String groupName = match.getGroupName() == null || match.getGroupName().isBlank() ? "A" : match.getGroupName();
            Map<String, RankingAccumulator> rows = groups.computeIfAbsent(groupName, ignored -> new LinkedHashMap<>());
            rows.computeIfAbsent(match.getTeamA(), RankingAccumulator::new).apply(match.getScoreA(), match.getScoreB(), match.getStatus() == MatchStatus.FINISHED);
            rows.computeIfAbsent(match.getTeamB(), RankingAccumulator::new).apply(match.getScoreB(), match.getScoreA(), match.getStatus() == MatchStatus.FINISHED);
        }
        return groups.entrySet().stream()
            .map(entry -> new RankingGroup(
                entry.getKey(),
                entry.getValue().values().stream()
                    .map(RankingAccumulator::toRow)
                    .sorted(Comparator.comparingInt(RankingRow::won).reversed()
                        .thenComparing(Comparator.comparingInt(RankingRow::pointDiff).reversed())
                        .thenComparing(Comparator.comparingInt(RankingRow::pointsFor).reversed())
                        .thenComparing(RankingRow::teamName))
                    .toList()
            ))
            .toList();
    }

    private boolean isRankingMatch(MatchGame match) {
        return "Vòng bảng".equals(match.getStage()) || "Vòng tròn".equals(match.getStage());
    }

    private List<MatchGame> knockoutSkeleton(Tournament tournament, int startRound) {
        List<MatchGame> generated = new ArrayList<>();
        int qualifierCount = tournament.getKnockoutQualifierCount();
        int round = startRound;
        String previousStage = "";
        if (qualifierCount >= 8) {
            generated.addAll(stageMatches(tournament, "Tứ kết", round, initialKnockoutSeeds(8)));
            previousStage = "Tứ kết";
            round++;
        }
        if (qualifierCount >= 4) {
            List<String> teams = previousStage.isBlank() ? initialKnockoutSeeds(4) : winnerPlaceholders(previousStage, 4);
            generated.addAll(stageMatches(tournament, "Bán kết", round, teams));
            previousStage = "Bán kết";
            round++;
        }
        List<String> teams = previousStage.isBlank() ? initialKnockoutSeeds(2) : winnerPlaceholders(previousStage, 2);
        generated.addAll(stageMatches(tournament, "Chung kết", round, teams));
        return generated;
    }

    private List<MatchGame> stageMatches(Tournament tournament, String stage, int round, List<String> teams) {
        List<MatchGame> stageMatches = new ArrayList<>();
        int court = 1;
        for (int i = 0; i < teams.size(); i += 2) {
            String teamA = teams.get(i);
            String teamB = i + 1 < teams.size() ? teams.get(i + 1) : "Chờ đối thủ";
            stageMatches.add(new MatchGame(tournament, teamA, teamB, court, round, stage));
            court = nextCourt(tournament, court);
        }
        return stageMatches;
    }

    private List<String> initialKnockoutSeeds(int qualifierCount) {
        if (qualifierCount >= 8) {
            return List.of("Nhất A", "Nhì B", "Nhất B", "Nhì A", "Nhất C", "Nhì D", "Nhất D", "Nhì C");
        }
        if (qualifierCount >= 4) {
            return List.of("Nhất A", "Nhì B", "Nhất B", "Nhì A");
        }
        return List.of("Nhất A", "Nhất B");
    }

    private List<String> winnerPlaceholders(String stage, int teamCount) {
        List<String> winners = new ArrayList<>();
        for (int i = 1; i <= teamCount; i++) {
            winners.add("Thắng " + stage + " " + i);
        }
        return winners;
    }

    private int nextCourt(Tournament tournament, int currentCourt) {
        return currentCourt >= tournament.getCourtCount() ? 1 : currentCourt + 1;
    }

    private static final class RankingAccumulator {
        private final String teamName;
        private int played;
        private int won;
        private int lost;
        private int pointsFor;
        private int pointsAgainst;

        private RankingAccumulator(String teamName) {
            this.teamName = teamName;
        }

        private void apply(int pointsFor, int pointsAgainst, boolean finished) {
            this.pointsFor += pointsFor;
            this.pointsAgainst += pointsAgainst;
            if (!finished) {
                return;
            }
            played++;
            if (pointsFor > pointsAgainst) {
                won++;
            } else if (pointsFor < pointsAgainst) {
                lost++;
            }
        }

        private RankingRow toRow() {
            return new RankingRow(teamName, played, won, lost, pointsFor, pointsAgainst);
        }
    }

    @Transactional
    public void updateScore(Long tournamentId, Long matchId, ScoreMessage message) {
        MatchGame match = matches.findById(matchId).orElseThrow();
        match.updateScore(message.scoreA(), message.scoreB(), message.servingTeam(), message.scoreOrder());
        broadcast(tournamentId);
    }

    public void broadcast(Long tournamentId) {
        messaging.convertAndSend("/topic/tournaments/" + tournamentId + "/matches", byTournament(tournamentId));
    }
}

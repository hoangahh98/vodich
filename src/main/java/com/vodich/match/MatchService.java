package com.vodich.match;

import com.vodich.tournament.Tournament;
import com.vodich.tournament.TournamentRegistration;
import com.vodich.tournament.TournamentService;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;

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
    public void generateRoundRobin(Long tournamentId) {
        Tournament tournament = tournaments.get(tournamentId);
        List<String> names = tournaments.activeRegistrations(tournamentId).stream()
            .map(TournamentRegistration::getDisplayName)
            .toList();
        matches.deleteByTournamentId(tournamentId);
        List<MatchGame> generated = new ArrayList<>();
        int round = 1;
        int court = 1;
        for (int i = 0; i < names.size(); i++) {
            for (int j = i + 1; j < names.size(); j++) {
                generated.add(new MatchGame(tournament, names.get(i), names.get(j), court, round));
                court++;
                if (court > tournament.getCourtCount()) {
                    court = 1;
                    round++;
                }
            }
        }
        matches.saveAll(generated);
        broadcast(tournamentId);
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

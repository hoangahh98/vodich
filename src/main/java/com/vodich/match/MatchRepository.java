package com.vodich.match;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface MatchRepository extends JpaRepository<MatchGame, Long> {
    List<MatchGame> findByTournamentIdOrderByRoundNumberAscCourtNumberAscIdAsc(Long tournamentId);
    void deleteByTournamentId(Long tournamentId);
}

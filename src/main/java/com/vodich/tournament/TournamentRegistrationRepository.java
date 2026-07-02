package com.vodich.tournament;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface TournamentRegistrationRepository extends JpaRepository<TournamentRegistration, Long> {
    List<TournamentRegistration> findByTournamentIdAndStatusOrderByIdAsc(Long tournamentId, RegistrationStatus status);
    List<TournamentRegistration> findByTournamentIdOrderByIdAsc(Long tournamentId);
    List<TournamentRegistration> findByPlayerEmailIgnoreCaseAndStatusOrderByIdAsc(String email, RegistrationStatus status);
    List<TournamentRegistration> findByExternalEmailIgnoreCaseAndStatusOrderByIdAsc(String email, RegistrationStatus status);
    Optional<TournamentRegistration> findByTournamentIdAndExternalEmailIgnoreCase(Long tournamentId, String email);
    boolean existsByTournamentIdAndPlayerIdAndStatus(Long tournamentId, Long playerId, RegistrationStatus status);
    boolean existsByTournamentIdAndPlayerEmailIgnoreCaseAndStatus(Long tournamentId, String email, RegistrationStatus status);
    boolean existsByTournamentIdAndExternalEmailIgnoreCaseAndStatus(Long tournamentId, String email, RegistrationStatus status);
}

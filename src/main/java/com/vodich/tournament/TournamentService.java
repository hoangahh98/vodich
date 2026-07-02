package com.vodich.tournament;

import com.vodich.auth.CurrentUser;
import com.vodich.auth.UserRole;
import com.vodich.player.Player;
import com.vodich.player.PlayerRepository;
import com.vodich.shared.Money;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashMap;
import java.util.List;

@Service
public class TournamentService {
    private final TournamentRepository tournaments;
    private final TournamentRegistrationRepository registrations;
    private final PlayerRepository players;

    public TournamentService(TournamentRepository tournaments,
                             TournamentRegistrationRepository registrations,
                             PlayerRepository players) {
        this.tournaments = tournaments;
        this.registrations = registrations;
        this.players = players;
    }

    public List<TournamentSummary> summaries() {
        return tournaments.findAll().stream().map(this::summary).toList();
    }

    public List<TournamentSummary> summariesFor(CurrentUser user) {
        if (user.role() == UserRole.ADMIN) {
            return summaries();
        }
        LinkedHashMap<Long, Tournament> visible = new LinkedHashMap<>();
        registrations.findByPlayerEmailIgnoreCaseAndStatusOrderByIdAsc(user.email(), RegistrationStatus.ACTIVE)
            .forEach(registration -> visible.put(registration.getTournament().getId(), registration.getTournament()));
        registrations.findByExternalEmailIgnoreCaseAndStatusOrderByIdAsc(user.email(), RegistrationStatus.ACTIVE)
            .forEach(registration -> visible.put(registration.getTournament().getId(), registration.getTournament()));
        return visible.values().stream().map(this::summary).toList();
    }

    public boolean canView(CurrentUser user, Long tournamentId) {
        if (user.role() == UserRole.ADMIN) {
            return true;
        }
        return registrations.existsByTournamentIdAndPlayerEmailIgnoreCaseAndStatus(tournamentId, user.email(), RegistrationStatus.ACTIVE)
            || registrations.existsByTournamentIdAndExternalEmailIgnoreCaseAndStatus(tournamentId, user.email(), RegistrationStatus.ACTIVE);
    }

    public Tournament get(Long id) {
        return tournaments.findById(id).orElseThrow();
    }

    public List<TournamentRegistration> activeRegistrations(Long tournamentId) {
        return registrations.findByTournamentIdAndStatusOrderByIdAsc(tournamentId, RegistrationStatus.ACTIVE);
    }

    public List<TournamentRegistration> withdrawnRegistrations(Long tournamentId) {
        return registrations.findByTournamentIdAndStatusOrderByIdAsc(tournamentId, RegistrationStatus.WITHDRAWN);
    }

    @Transactional
    public Tournament save(TournamentCommand command) {
        Tournament tournament = new Tournament(command.name());
        tournament.update(command);
        return tournaments.save(tournament);
    }

    @Transactional
    public Tournament update(Long id, TournamentCommand command) {
        Tournament tournament = get(id);
        tournament.update(command);
        return tournament;
    }

    @Transactional
    public void registerPlayer(Long tournamentId, Long playerId) {
        Tournament tournament = get(tournamentId);
        if (registrations.existsByTournamentIdAndPlayerIdAndStatus(tournamentId, playerId, RegistrationStatus.ACTIVE)) {
            return;
        }
        Player player = players.findById(playerId).orElseThrow();
        registrations.save(TournamentRegistration.internal(tournament, player));
    }

    @Transactional
    public TournamentRegistration registerExternal(Long tournamentId, String name, String email, String skillLevel) {
        Tournament tournament = get(tournamentId);
        if (!tournament.isExternalRegistrationEnabled()) {
            throw new IllegalStateException("Giải chưa mở đăng ký ngoài");
        }
        return registrations.findByTournamentIdAndExternalEmailIgnoreCase(tournamentId, email)
            .map(existing -> {
                existing.restore();
                return existing;
            })
            .orElseGet(() -> registrations.save(TournamentRegistration.external(tournament, name, email, skillLevel)));
    }

    @Transactional
    public void updatePayment(Long registrationId, String amount, PaymentStatus status) {
        TournamentRegistration registration = registrations.findById(registrationId).orElseThrow();
        registration.updatePayment(Money.parse(amount), status);
    }

    @Transactional
    public void withdraw(Long registrationId) {
        registrations.findById(registrationId).orElseThrow().withdraw();
    }

    @Transactional
    public void restore(Long registrationId) {
        registrations.findById(registrationId).orElseThrow().restore();
    }

    public TournamentCommand commandFromForm(TournamentForm form) {
        return new TournamentCommand(
            form.name(),
            form.venue(),
            form.startTime(),
            Math.max(1, form.courtCount()),
            Math.max(1, form.expectedPlayers()),
            form.playType(),
            form.format(),
            Math.max(1, form.touchScore()),
            Math.max(form.touchScore(), form.maxScore()),
            Money.parse(form.courtCost()),
            Money.parse(form.foodCost()),
            Money.parse(form.prizeCost()),
            Money.parse(form.otherCost()),
            form.externalRegistrationEnabled()
        );
    }

    private TournamentSummary summary(Tournament tournament) {
        return new TournamentSummary(
            tournament,
            registrations.findByTournamentIdAndStatusOrderByIdAsc(tournament.getId(), RegistrationStatus.ACTIVE).size(),
            tournament.minimumFeePerPlayer()
        );
    }
}

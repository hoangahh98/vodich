package com.vodich.auth;

import com.vodich.tournament.RegistrationStatus;
import com.vodich.tournament.TournamentRegistration;
import com.vodich.tournament.TournamentRegistrationRepository;
import com.vodich.player.PlayerRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AuthService {
    private final AppUserRepository users;
    private final PlayerRepository players;
    private final TournamentRegistrationRepository registrations;
    private final BCryptPasswordEncoder encoder = new BCryptPasswordEncoder();
    private final String rootUsername;
    private final String rootPassword;

    public AuthService(AppUserRepository users,
                       PlayerRepository players,
                       TournamentRegistrationRepository registrations,
                       @Value("${app.admin.username:admin}") String rootUsername,
                       @Value("${app.admin.password:123456789}") String rootPassword) {
        this.users = users;
        this.players = players;
        this.registrations = registrations;
        this.rootUsername = rootUsername;
        this.rootPassword = rootPassword;
    }

    @Transactional
    public void ensureRootAdmin() {
        users.findByUsernameIgnoreCase(rootUsername).orElseGet(() ->
            users.save(new AppUser(rootUsername, encoder.encode(rootPassword), "Admin", UserRole.ADMIN))
        );
    }

    public CurrentUser login(String username, String password, UserRole role) {
        String normalized = username == null ? "" : username.trim().toLowerCase();
        if (role == UserRole.ADMIN) {
            AppUser user = users.findByUsernameIgnoreCase(normalized)
                .orElseThrow(() -> new IllegalArgumentException("Sai tài khoản hoặc mật khẩu"));
            if (!encoder.matches(password, user.getPasswordHash())) {
                throw new IllegalArgumentException("Sai tài khoản hoặc mật khẩu");
            }
            return new CurrentUser(user.getId(), user.getUsername(), user.getDisplayName(), UserRole.ADMIN);
        }
        if (!"123456789".equals(password)) {
            throw new IllegalArgumentException("Sai email hoặc mật khẩu");
        }
        return players.findByEmailIgnoreCase(normalized)
            .map(player -> new CurrentUser(player.getId(), player.getEmail(), player.getDisplayName(), UserRole.PLAYER))
            .orElseGet(() -> externalParticipant(normalized));
    }

    private CurrentUser externalParticipant(String email) {
        TournamentRegistration registration = registrations.findByExternalEmailIgnoreCaseAndStatusOrderByIdAsc(email, RegistrationStatus.ACTIVE).stream()
            .findFirst()
            .orElseThrow(() -> new IllegalArgumentException("Sai email hoặc mật khẩu"));
        return new CurrentUser(registration.getId(), registration.getEmail(), registration.getDisplayName(), UserRole.PLAYER);
    }
}

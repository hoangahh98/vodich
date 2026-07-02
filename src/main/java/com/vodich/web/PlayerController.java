package com.vodich.web;

import com.vodich.auth.AppFeature;
import com.vodich.auth.AuthSession;
import com.vodich.auth.CurrentUser;
import com.vodich.auth.PermissionService;
import com.vodich.player.Player;
import com.vodich.player.PlayerRepository;
import jakarta.servlet.http.HttpSession;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;

@Controller
public class PlayerController {
    private final PlayerRepository players;
    private final AuthSession auth;
    private final PermissionService permissions;

    public PlayerController(PlayerRepository players, AuthSession auth, PermissionService permissions) {
        this.players = players;
        this.auth = auth;
        this.permissions = permissions;
    }

    @GetMapping("/players")
    public String index(HttpSession session, Model model, @RequestParam(defaultValue = "") String error) {
        require(session);
        model.addAttribute("players", players.findAll());
        model.addAttribute("error", error);
        return "player/index";
    }

    @PostMapping("/players")
    public String create(HttpSession session,
                         @RequestParam String displayName,
                         @RequestParam String email,
                         @RequestParam String skillLevel,
                         @RequestParam(defaultValue = "") String notes) {
        require(session);
        String normalizedEmail = email.trim().toLowerCase();
        if (players.existsByEmailIgnoreCase(normalizedEmail)) {
            return "redirect:/players?error=Email%20%C4%91%C3%A3%20t%E1%BB%93n%20t%E1%BA%A1i%20trong%20danh%20s%C3%A1ch%20V%C4%90V";
        }
        players.save(new Player(displayName, normalizedEmail, skillLevel, notes));
        return "redirect:/players";
    }

    private void require(HttpSession session) {
        CurrentUser user = auth.current(session).orElseThrow();
        if (!user.admin() || !permissions.can(user, AppFeature.TOURNAMENTS)) {
            throw new IllegalStateException("Không có quyền");
        }
    }
}

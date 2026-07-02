package com.vodich.web;

import com.vodich.auth.*;
import com.vodich.team.TeamClub;
import com.vodich.team.TeamService;
import jakarta.servlet.http.HttpSession;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.*;

@Controller
public class TeamController {
    private final TeamService teams;
    private final AuthSession auth;
    private final PermissionService permissions;

    public TeamController(TeamService teams, AuthSession auth, PermissionService permissions) {
        this.teams = teams;
        this.auth = auth;
        this.permissions = permissions;
    }

    @GetMapping("/teams")
    public String index(HttpSession session, Model model) {
        requireRead(session);
        model.addAttribute("teams", teams.all());
        return "team/index";
    }

    @PostMapping("/teams")
    public String create(HttpSession session, @RequestParam String name, @RequestParam(defaultValue = "") String description) {
        requireAdmin(session);
        TeamClub team = teams.create(name, description);
        return "redirect:/teams/" + team.getId();
    }

    @GetMapping("/teams/{id}")
    public String detail(HttpSession session, @PathVariable Long id, Model model) {
        requireRead(session);
        model.addAttribute("team", teams.get(id));
        model.addAttribute("members", teams.members(id));
        return "team/detail";
    }

    private void requireRead(HttpSession session) {
        CurrentUser user = auth.current(session).orElseThrow();
        if (!permissions.can(user, AppFeature.TEAMS)) {
            throw new IllegalStateException("Không có quyền");
        }
    }

    private void requireAdmin(HttpSession session) {
        CurrentUser user = auth.current(session).orElseThrow();
        if (!user.admin() || !permissions.can(user, AppFeature.TEAMS)) {
            throw new IllegalStateException("Không có quyền");
        }
    }
}

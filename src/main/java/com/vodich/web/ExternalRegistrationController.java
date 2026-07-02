package com.vodich.web;

import com.vodich.tournament.TournamentService;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.*;

@Controller
public class ExternalRegistrationController {
    private final TournamentService tournaments;

    public ExternalRegistrationController(TournamentService tournaments) {
        this.tournaments = tournaments;
    }

    @GetMapping("/external-register/{tournamentId}")
    public String form(@PathVariable Long tournamentId, Model model) {
        model.addAttribute("tournament", tournaments.get(tournamentId));
        return "external-register";
    }

    @PostMapping("/external-register/{tournamentId}")
    public String submit(@PathVariable Long tournamentId, @RequestParam String displayName, @RequestParam String email, @RequestParam String skillLevel, Model model) {
        tournaments.registerExternal(tournamentId, displayName, email, skillLevel);
        model.addAttribute("tournament", tournaments.get(tournamentId));
        model.addAttribute("email", email);
        return "external-success";
    }
}

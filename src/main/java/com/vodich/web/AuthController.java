package com.vodich.web;

import com.vodich.auth.*;
import jakarta.servlet.http.HttpSession;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.*;

@Controller
public class AuthController {
    private final AuthService authService;
    private final AuthSession authSession;

    public AuthController(AuthService authService, AuthSession authSession) {
        this.authService = authService;
        this.authSession = authSession;
    }

    @GetMapping("/login")
    public String login() {
        return "login";
    }

    @PostMapping("/login")
    public String doLogin(@RequestParam String username,
                          @RequestParam String password,
                          @RequestParam(defaultValue = "ADMIN") UserRole role,
                          HttpSession session,
                          Model model) {
        try {
            authSession.login(session, authService.login(username, password, role));
            return "redirect:/";
        } catch (RuntimeException ex) {
            model.addAttribute("error", ex.getMessage());
            return "login";
        }
    }

    @PostMapping("/logout")
    public String logout(HttpSession session) {
        authSession.logout(session);
        return "redirect:/login";
    }
}

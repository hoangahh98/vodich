package com.vodich.web;

import com.vodich.auth.*;
import jakarta.servlet.http.HttpSession;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.*;

import java.util.Arrays;
import java.util.Map;
import java.util.stream.Collectors;

@Controller
public class PermissionController {
    private final AppUserRepository users;
    private final PermissionService permissions;
    private final AuthSession auth;

    public PermissionController(AppUserRepository users, PermissionService permissions, AuthSession auth) {
        this.users = users;
        this.permissions = permissions;
        this.auth = auth;
    }

    @GetMapping("/permissions")
    public String index(HttpSession session, Model model) {
        CurrentUser user = auth.current(session).orElseThrow();
        if (!permissions.can(user, AppFeature.PERMISSIONS)) {
            throw new IllegalStateException("Không có quyền");
        }
        model.addAttribute("rows", users.findAll().stream()
            .filter(u -> u.getRole() == UserRole.ADMIN)
            .map(u -> new AdminPermissionRow(
                u,
                Arrays.stream(AppFeature.values()).collect(Collectors.toMap(f -> f, f -> permissions.adminHasFeature(u, f)))
            ))
            .toList());
        model.addAttribute("features", AppFeature.values());
        return "permissions";
    }

    @PostMapping("/permissions")
    public String update(HttpSession session, @RequestParam Long adminId, @RequestParam AppFeature feature, @RequestParam(defaultValue = "false") boolean enabled) {
        CurrentUser user = auth.current(session).orElseThrow();
        if (!permissions.can(user, AppFeature.PERMISSIONS)) {
            throw new IllegalStateException("Không có quyền");
        }
        permissions.setPermission(adminId, feature, enabled);
        return "redirect:/permissions";
    }

    public record AdminPermissionRow(AppUser admin, Map<AppFeature, Boolean> enabled) {
    }
}

package com.vodich.web;

import com.vodich.auth.*;
import jakarta.servlet.http.HttpSession;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;

@Controller
public class TravelController {
    private final AuthSession auth;
    private final PermissionService permissions;

    public TravelController(AuthSession auth, PermissionService permissions) {
        this.auth = auth;
        this.permissions = permissions;
    }

    @GetMapping("/travel")
    public String index(HttpSession session, Model model) {
        CurrentUser user = auth.current(session).orElseThrow();
        if (!permissions.can(user, AppFeature.TRAVEL)) {
            throw new IllegalStateException("Không có quyền");
        }
        return "travel/index";
    }
}

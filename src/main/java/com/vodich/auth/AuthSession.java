package com.vodich.auth;

import jakarta.servlet.http.HttpSession;
import org.springframework.stereotype.Component;

import java.util.Optional;

@Component
public class AuthSession {
    public static final String USER_KEY = "currentUser";

    public void login(HttpSession session, CurrentUser user) {
        session.setAttribute(USER_KEY, user);
    }

    public Optional<CurrentUser> current(HttpSession session) {
        Object value = session.getAttribute(USER_KEY);
        return value instanceof CurrentUser user ? Optional.of(user) : Optional.empty();
    }

    public boolean isLoggedIn(HttpSession session) {
        return current(session).isPresent();
    }

    public void logout(HttpSession session) {
        session.invalidate();
    }
}

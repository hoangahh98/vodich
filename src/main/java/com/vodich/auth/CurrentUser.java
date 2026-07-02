package com.vodich.auth;

import java.io.Serializable;

public record CurrentUser(Long id, String email, String displayName, UserRole role) implements Serializable {
    public boolean admin() {
        return role == UserRole.ADMIN;
    }
}

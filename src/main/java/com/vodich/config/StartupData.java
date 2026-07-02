package com.vodich.config;

import com.vodich.auth.AuthService;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

@Component
public class StartupData implements CommandLineRunner {
    private final AuthService authService;

    public StartupData(AuthService authService) {
        this.authService = authService;
    }

    @Override
    public void run(String... args) {
        authService.ensureRootAdmin();
    }
}

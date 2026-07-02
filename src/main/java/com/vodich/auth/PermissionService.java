package com.vodich.auth;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.EnumSet;
import java.util.Set;
import java.util.stream.Collectors;

@Service
public class PermissionService {
    private final AdminFeaturePermissionRepository permissions;
    private final AppUserRepository users;
    private final String rootAdmin;

    public PermissionService(AdminFeaturePermissionRepository permissions,
                             AppUserRepository users,
                             @Value("${app.admin.username:admin}") String rootAdmin) {
        this.permissions = permissions;
        this.users = users;
        this.rootAdmin = rootAdmin;
    }

    public boolean can(CurrentUser user, AppFeature feature) {
        if (user == null) {
            return false;
        }
        if (user.role() == UserRole.CLIENT) {
            return feature != AppFeature.PERMISSIONS;
        }
        if (isRoot(user)) {
            return true;
        }
        return permissions.findByAdminIdAndFeature(user.id(), feature).isPresent();
    }

    public boolean isRoot(CurrentUser user) {
        return user != null && user.role() == UserRole.ADMIN && user.email().equalsIgnoreCase(rootAdmin);
    }

    public Set<AppFeature> featuresFor(CurrentUser user) {
        if (user == null) {
            return Set.of();
        }
        if (isRoot(user)) {
            return EnumSet.allOf(AppFeature.class);
        }
        if (user.role() == UserRole.CLIENT) {
            EnumSet<AppFeature> playerFeatures = EnumSet.of(AppFeature.TOURNAMENTS, AppFeature.TEAMS, AppFeature.TRAVEL);
            return playerFeatures;
        }
        return permissions.findByAdminId(user.id()).stream()
            .map(AdminFeaturePermission::getFeature)
            .collect(Collectors.toCollection(() -> EnumSet.noneOf(AppFeature.class)));
    }

    public boolean adminHasFeature(AppUser admin, AppFeature feature) {
        if (admin == null || admin.getRole() != UserRole.ADMIN) {
            return false;
        }
        if (admin.getUsername().equalsIgnoreCase(rootAdmin)) {
            return true;
        }
        return permissions.findByAdminIdAndFeature(admin.getId(), feature).isPresent();
    }

    @Transactional
    public void setPermission(Long adminId, AppFeature feature, boolean enabled) {
        AppUser admin = users.findById(adminId).orElseThrow();
        if (enabled && permissions.findByAdminIdAndFeature(adminId, feature).isEmpty()) {
            permissions.save(new AdminFeaturePermission(admin, feature));
        }
        if (!enabled) {
            permissions.deleteByAdminIdAndFeature(adminId, feature);
        }
    }
}

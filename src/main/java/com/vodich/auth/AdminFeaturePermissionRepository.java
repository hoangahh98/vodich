package com.vodich.auth;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface AdminFeaturePermissionRepository extends JpaRepository<AdminFeaturePermission, Long> {
    List<AdminFeaturePermission> findByAdminId(Long adminId);
    Optional<AdminFeaturePermission> findByAdminIdAndFeature(Long adminId, AppFeature feature);
    void deleteByAdminIdAndFeature(Long adminId, AppFeature feature);
}

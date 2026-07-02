package com.vodich.auth;

import jakarta.persistence.*;

@Entity
@Table(name = "admin_feature_permission")
public class AdminFeaturePermission {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @ManyToOne(optional = false)
    @JoinColumn(name = "admin_id")
    private AppUser admin;
    @Enumerated(EnumType.STRING)
    private AppFeature feature;

    protected AdminFeaturePermission() {
    }

    public AdminFeaturePermission(AppUser admin, AppFeature feature) {
        this.admin = admin;
        this.feature = feature;
    }

    public Long getId() { return id; }
    public AppUser getAdmin() { return admin; }
    public AppFeature getFeature() { return feature; }
}

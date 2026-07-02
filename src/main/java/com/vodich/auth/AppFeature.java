package com.vodich.auth;

public enum AppFeature {
    TOURNAMENTS("Giải đấu"),
    TEAMS("Đội bóng"),
    TRAVEL("Du lịch"),
    PERMISSIONS("Phân quyền");

    private final String label;

    AppFeature(String label) {
        this.label = label;
    }

    public String label() {
        return label;
    }
}

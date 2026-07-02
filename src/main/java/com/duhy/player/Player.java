package com.duhy.player;

import jakarta.persistence.*;

@Entity
@Table(name = "player")
public class Player {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @Column(name = "display_name")
    private String displayName;
    private String email;
    @Column(name = "skill_level")
    private String skillLevel;
    private String notes;

    protected Player() {
    }

    public Player(String displayName, String email, String skillLevel, String notes) {
        this.displayName = displayName;
        this.email = email;
        this.skillLevel = skillLevel;
        this.notes = notes;
    }

    public Long getId() { return id; }
    public String getDisplayName() { return displayName; }
    public String getEmail() { return email; }
    public String getSkillLevel() { return skillLevel; }
    public String getNotes() { return notes; }
}

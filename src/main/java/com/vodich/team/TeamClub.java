package com.vodich.team;

import jakarta.persistence.*;

@Entity
@Table(name = "team_club")
public class TeamClub {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    private String name;
    private String description;

    protected TeamClub() {
    }

    public TeamClub(String name, String description) {
        this.name = name;
        this.description = description;
    }

    public Long getId() { return id; }
    public String getName() { return name; }
    public String getDescription() { return description; }
}

package com.duhy.team;

import com.duhy.player.Player;
import jakarta.persistence.*;

@Entity
@Table(name = "team_member")
public class TeamMember {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @ManyToOne(optional = false)
    @JoinColumn(name = "team_id")
    private TeamClub team;
    @ManyToOne(optional = false)
    @JoinColumn(name = "player_id")
    private Player player;
    @Enumerated(EnumType.STRING)
    @Column(name = "member_type")
    private MemberType memberType;
    private boolean active = true;
    private String notes;

    protected TeamMember() {
    }

    public TeamMember(TeamClub team, Player player, MemberType memberType) {
        this.team = team;
        this.player = player;
        this.memberType = memberType;
    }

    public Long getId() { return id; }
    public TeamClub getTeam() { return team; }
    public Player getPlayer() { return player; }
    public MemberType getMemberType() { return memberType; }
    public boolean isActive() { return active; }
}

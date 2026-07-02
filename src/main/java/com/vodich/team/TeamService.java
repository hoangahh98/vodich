package com.vodich.team;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class TeamService {
    private final TeamRepository teams;
    private final TeamMemberRepository members;

    public TeamService(TeamRepository teams, TeamMemberRepository members) {
        this.teams = teams;
        this.members = members;
    }

    public List<TeamClub> all() {
        return teams.findAll();
    }

    public TeamClub get(Long id) {
        return teams.findById(id).orElseThrow();
    }

    public List<TeamMember> members(Long teamId) {
        return members.findByTeamIdAndActiveTrue(teamId);
    }

    @Transactional
    public TeamClub create(String name, String description) {
        return teams.save(new TeamClub(name, description));
    }
}

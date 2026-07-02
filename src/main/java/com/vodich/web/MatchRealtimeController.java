package com.vodich.web;

import com.vodich.match.MatchService;
import com.vodich.match.ScoreMessage;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.stereotype.Controller;

@Controller
public class MatchRealtimeController {
    private final MatchService matches;

    public MatchRealtimeController(MatchService matches) {
        this.matches = matches;
    }

    @MessageMapping("/tournaments/{tournamentId}/matches/{matchId}/score")
    public void update(@DestinationVariable Long tournamentId, @DestinationVariable Long matchId, ScoreMessage message) {
        matches.updateScore(tournamentId, matchId, message);
    }
}

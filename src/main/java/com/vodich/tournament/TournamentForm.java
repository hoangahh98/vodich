package com.vodich.tournament;

import org.springframework.format.annotation.DateTimeFormat;

import java.time.LocalDateTime;

public record TournamentForm(
    String name,
    String venue,
    @DateTimeFormat(pattern = "yyyy-MM-dd'T'HH:mm")
    LocalDateTime startTime,
    int courtCount,
    int expectedPlayers,
    PlayType playType,
    TournamentFormat format,
    int touchScore,
    int maxScore,
    String courtCost,
    String foodCost,
    String prizeCost,
    String otherCost,
    boolean externalRegistrationEnabled
) {
    public static TournamentForm defaults() {
        return new TournamentForm("", "", null, 1, 10, PlayType.SINGLES, TournamentFormat.ROUND_ROBIN, 11, 15, "0", "0", "0", "0", false);
    }
}

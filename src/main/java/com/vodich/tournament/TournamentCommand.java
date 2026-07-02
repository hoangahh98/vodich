package com.vodich.tournament;

import java.math.BigDecimal;
import java.time.LocalDateTime;

public record TournamentCommand(
    String name,
    String venue,
    LocalDateTime startTime,
    int courtCount,
    int expectedPlayers,
    PlayType playType,
    TournamentFormat format,
    int knockoutQualifierCount,
    int touchScore,
    int maxScore,
    BigDecimal courtCost,
    BigDecimal foodCost,
    BigDecimal prizeCost,
    BigDecimal otherCost,
    boolean externalRegistrationEnabled
) {
}

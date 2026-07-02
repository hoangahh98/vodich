package com.vodich.tournament;

import java.math.BigDecimal;

public record TournamentSummary(
    Tournament tournament,
    int activeCount,
    BigDecimal minimumFee
) {
}

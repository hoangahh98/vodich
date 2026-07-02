package com.vodich.match;

public record RankingRow(
    String teamName,
    int played,
    int won,
    int lost,
    int pointsFor,
    int pointsAgainst
) {
    public int pointDiff() {
        return pointsFor - pointsAgainst;
    }
}

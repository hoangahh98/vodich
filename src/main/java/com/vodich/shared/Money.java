package com.vodich.shared;

import java.math.BigDecimal;
import java.math.RoundingMode;

public final class Money {
    private Money() {
    }

    public static BigDecimal parse(String value) {
        if (value == null || value.isBlank()) {
            return BigDecimal.ZERO;
        }
        String cleaned = value.replaceAll("[^0-9]", "");
        if (cleaned.isBlank()) {
            return BigDecimal.ZERO;
        }
        return new BigDecimal(cleaned).setScale(2, RoundingMode.HALF_UP);
    }

    public static BigDecimal roundUpToStep(BigDecimal value, int step) {
        if (value == null || value.signum() <= 0) {
            return BigDecimal.ZERO;
        }
        BigDecimal stepValue = BigDecimal.valueOf(step);
        BigDecimal[] parts = value.divideAndRemainder(stepValue);
        return parts[1].signum() == 0 ? value : parts[0].add(BigDecimal.ONE).multiply(stepValue);
    }
}

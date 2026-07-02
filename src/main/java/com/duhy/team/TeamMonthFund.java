package com.duhy.team;

import jakarta.persistence.*;

import java.math.BigDecimal;
import java.time.LocalDate;

@Entity
@Table(name = "team_month_fund")
public class TeamMonthFund {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @ManyToOne(optional = false)
    @JoinColumn(name = "team_id")
    private TeamClub team;
    @Column(name = "fund_month")
    private LocalDate fundMonth;
    @Column(name = "monthly_fee")
    private BigDecimal monthlyFee;
    @Column(name = "court_cost")
    private BigDecimal courtCost;
    @Column(name = "previous_balance")
    private BigDecimal previousBalance;
    private String notes;

    protected TeamMonthFund() {
    }

    public TeamMonthFund(TeamClub team, LocalDate fundMonth, BigDecimal monthlyFee) {
        this.team = team;
        this.fundMonth = fundMonth;
        this.monthlyFee = monthlyFee;
        this.courtCost = BigDecimal.ZERO;
        this.previousBalance = BigDecimal.ZERO;
    }

    public Long getId() { return id; }
    public TeamClub getTeam() { return team; }
    public LocalDate getFundMonth() { return fundMonth; }
    public BigDecimal getMonthlyFee() { return monthlyFee; }
}

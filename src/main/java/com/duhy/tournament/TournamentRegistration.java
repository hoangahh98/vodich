package com.duhy.tournament;

import com.duhy.player.Player;
import jakarta.persistence.*;

import java.math.BigDecimal;
import java.time.LocalDateTime;

@Entity
@Table(name = "tournament_registration")
public class TournamentRegistration {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @ManyToOne(optional = false)
    @JoinColumn(name = "tournament_id")
    private Tournament tournament;
    @ManyToOne
    @JoinColumn(name = "player_id")
    private Player player;
    @Column(name = "external_name")
    private String externalName;
    @Column(name = "external_email")
    private String externalEmail;
    @Column(name = "skill_level")
    private String skillLevel;
    @Enumerated(EnumType.STRING)
    private RegistrationSource source;
    @Enumerated(EnumType.STRING)
    private RegistrationStatus status;
    @Column(name = "paid_amount")
    private BigDecimal paidAmount;
    @Enumerated(EnumType.STRING)
    @Column(name = "payment_status")
    private PaymentStatus paymentStatus;
    @Column(name = "withdrawn_at")
    private LocalDateTime withdrawnAt;

    protected TournamentRegistration() {
    }

    public static TournamentRegistration internal(Tournament tournament, Player player) {
        TournamentRegistration registration = new TournamentRegistration();
        registration.tournament = tournament;
        registration.player = player;
        registration.skillLevel = player.getSkillLevel();
        registration.source = RegistrationSource.INTERNAL;
        registration.status = RegistrationStatus.ACTIVE;
        registration.paidAmount = tournament.minimumFeePerPlayer();
        registration.paymentStatus = PaymentStatus.UNPAID;
        return registration;
    }

    public static TournamentRegistration external(Tournament tournament, String name, String email, String skillLevel) {
        TournamentRegistration registration = new TournamentRegistration();
        registration.tournament = tournament;
        registration.externalName = name;
        registration.externalEmail = email;
        registration.skillLevel = skillLevel;
        registration.source = RegistrationSource.EXTERNAL;
        registration.status = RegistrationStatus.ACTIVE;
        registration.paidAmount = tournament.minimumFeePerPlayer();
        registration.paymentStatus = PaymentStatus.UNPAID;
        return registration;
    }

    public void withdraw() {
        status = RegistrationStatus.WITHDRAWN;
        withdrawnAt = LocalDateTime.now();
    }

    public void restore() {
        status = RegistrationStatus.ACTIVE;
        withdrawnAt = null;
    }

    public void updatePayment(BigDecimal amount, PaymentStatus status) {
        this.paidAmount = amount;
        this.paymentStatus = status;
    }

    public Long getId() { return id; }
    public Tournament getTournament() { return tournament; }
    public String getDisplayName() { return source == RegistrationSource.INTERNAL ? player.getDisplayName() : externalName; }
    public String getEmail() { return source == RegistrationSource.INTERNAL ? player.getEmail() : externalEmail; }
    public String getSkillLevel() { return skillLevel; }
    public RegistrationSource getSource() { return source; }
    public RegistrationStatus getStatus() { return status; }
    public BigDecimal getPaidAmount() { return paidAmount; }
    public PaymentStatus getPaymentStatus() { return paymentStatus; }
}

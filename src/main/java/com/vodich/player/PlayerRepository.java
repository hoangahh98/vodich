package com.vodich.player;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface PlayerRepository extends JpaRepository<Player, Long> {
    Optional<Player> findByEmailIgnoreCase(String email);
    boolean existsByEmailIgnoreCase(String email);
}

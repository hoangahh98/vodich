import random


class MatchSchedulerService:
    """Generate match schedules with smart skill-based pairing for doubles."""

    # Thứ tự trình độ từ mạnh → yếu
    LEVEL_ORDER = ['A', 'B', 'C', 'D']

    @staticmethod
    def generate_round_robin(players, num_courts, match_type='don'):
        """
        Args:
            players : list of (name, trinh_do) tuples  →  khi match_type='doi'
                      list of name strings             →  khi match_type='don'
            num_courts : số sân
            match_type : 'don' | 'doi'
        Returns:
            List[dict]  {'doi_a', 'doi_b', 'san', 'vong'}
        """
        num_courts = max(1, int(num_courts or 1))

        if match_type == 'doi':
            # players là list of (name, trinh_do)
            pairs = MatchSchedulerService._smart_pair(players)
            if len(pairs) < 2:
                return []
            return MatchSchedulerService._round_robin(pairs, num_courts)
        else:
            # players là list of name strings
            names = [p[0] if isinstance(p, tuple) else p for p in players]
            if len(names) < 2:
                return []
            return MatchSchedulerService._round_robin(names, num_courts)

    # ─── SMART PAIRING ──────────────────────────────────────────────────────

    @staticmethod
    def _smart_pair(players):
        """
        Ghép đôi thông minh theo trình độ.
        players: list of (name, trinh_do)
        Returns: list of pair-name strings  "A + B"
        """
        # Nhóm theo trình độ, giữ thứ tự mạnh→yếu
        groups = {}
        for name, trinh in players:
            lvl = (trinh or 'D').upper()
            groups.setdefault(lvl, []).append(name)

        # Shuffle trong mỗi nhóm để random hóa
        for g in groups.values():
            random.shuffle(g)

        # Lấy các level hiện có, sort theo thứ tự mạnh→yếu
        level_order = ['A', 'B', 'C', 'D']
        levels = [l for l in level_order if l in groups] + \
                 [l for l in groups if l not in level_order]

        n = len(levels)
        pairs = []

        if n == 0:
            return pairs

        elif n == 1:
            # 1 trình: ghép random
            pool = groups[levels[0]][:]
            random.shuffle(pool)
            pairs += MatchSchedulerService._pair_pool(pool)

        elif n == 2:
            # 2 trình: mạnh + yếu
            strong = groups[levels[0]][:]
            weak   = groups[levels[1]][:]
            pairs += MatchSchedulerService._pair_two(strong, weak)

        elif n == 3:
            # 3 trình: mạnh(0) + yếu(2), giữa(1) + giữa(1)
            l0 = groups[levels[0]][:]
            l1 = groups[levels[1]][:]
            l2 = groups[levels[2]][:]

            # Pair mạnh nhất với yếu nhất
            while l0 and l2:
                pairs.append(f"{l0.pop()} + {l2.pop()}")

            # Pair giữa với giữa
            while len(l1) >= 2:
                pairs.append(f"{l1.pop()} + {l1.pop()}")

            # Phần dư còn lại → cân bằng nhất có thể
            leftover = l0 + l1 + l2
            pairs += MatchSchedulerService._pair_pool(leftover)

        elif n == 4:
            # 4 trình: A+D, B+C
            lA = groups[levels[0]][:]
            lB = groups[levels[1]][:]
            lC = groups[levels[2]][:]
            lD = groups[levels[3]][:]

            # A + D
            while lA and lD:
                pairs.append(f"{lA.pop()} + {lD.pop()}")

            # B + C
            while lB and lC:
                pairs.append(f"{lB.pop()} + {lC.pop()}")

            # Phần dư: cân bằng — ghép mạnh nhất còn lại với yếu nhất còn lại
            leftover = []
            # Xếp thứ tự mạnh→yếu để ghép cân bằng
            for lv in [lA, lB, lC, lD]:
                leftover.extend(lv)
            pairs += MatchSchedulerService._pair_balanced(leftover)

        else:
            # >4 trình (edge case): ghép mạnh nhất với yếu nhất
            all_named = []
            for lv in levels:
                all_named.extend(groups[lv])
            pairs += MatchSchedulerService._pair_balanced(all_named)

        return pairs

    # ─── PAIRING HELPERS ────────────────────────────────────────────────────

    @staticmethod
    def _pair_pool(pool):
        """Ghép random từng cặp trong pool."""
        pool = list(pool)
        random.shuffle(pool)
        pairs = []
        while len(pool) >= 2:
            pairs.append(f"{pool.pop()} + {pool.pop()}")
        if pool:
            pairs.append(f"{pool[0]} + Lẻ (Chờ ghép)")
        return pairs

    @staticmethod
    def _pair_two(strong, weak):
        """Ghép 2 nhóm mạnh-yếu, phần dư ghép trong nhóm."""
        pairs = []
        s, w = list(strong), list(weak)
        while s and w:
            pairs.append(f"{s.pop()} + {w.pop()}")
        leftover = s + w
        pairs += MatchSchedulerService._pair_pool(leftover)
        return pairs

    @staticmethod
    def _pair_balanced(pool):
        """Ghép mạnh nhất với yếu nhất (pool đã xếp thứ tự mạnh→yếu)."""
        pool = list(pool)
        pairs = []
        while len(pool) >= 2:
            pairs.append(f"{pool.pop(0)} + {pool.pop()}")
        if pool:
            pairs.append(f"{pool[0]} + Lẻ (Chờ ghép)")
        return pairs

    # ─── ROUND ROBIN ────────────────────────────────────────────────────────

    @staticmethod
    def _round_robin(teams, num_courts):
        """Vòng tròn chuẩn — cố định 1 phần tử, xoay phần còn lại."""
        teams = list(teams)
        if len(teams) % 2 == 1:
            teams.append('BYE')

        n = len(teams)
        matches = []

        for vong in range(n - 1):
            round_matches = []
            for i in range(n // 2):
                a = teams[i]
                b = teams[n - 1 - i]
                if a == 'BYE' or b == 'BYE':
                    continue
                round_matches.append({
                    'doi_a': a,
                    'doi_b': b,
                    'san':  (len(round_matches) % num_courts) + 1,
                    'vong': vong + 1,
                })
            matches.extend(round_matches)
            # Xoay: giữ nguyên teams[0], xoay phần còn lại
            teams = [teams[0]] + [teams[-1]] + teams[1:-1]

        return matches

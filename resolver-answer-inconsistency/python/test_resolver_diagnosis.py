from check_resolver_consistency import diagnose_resolver_inconsistency


def test_consistent_when_every_resolver_matches():
    result = diagnose_resolver_inconsistency(
        authoritative_answer={"203.0.113.10"},
        resolver_answers={"1.1.1.1": {"203.0.113.10"}, "8.8.8.8": {"203.0.113.10"}},
        resolver_ttls={"1.1.1.1": 250, "8.8.8.8": 300},
        configured_ttl=300,
    )
    assert result["consistent"] is True
    assert result["stale_resolvers"] == []
    assert result["likely_cause"] == "none"


def test_propagation_lag_with_high_ttl_recommends_lower_ttl():
    result = diagnose_resolver_inconsistency(
        authoritative_answer={"203.0.113.10"},
        resolver_answers={"1.1.1.1": {"203.0.113.10"}, "8.8.8.8": {"198.51.100.5"}},
        resolver_ttls={"1.1.1.1": 100, "8.8.8.8": 60000},
        configured_ttl=86400,
    )
    assert result["consistent"] is False
    assert result["stale_resolvers"] == ["8.8.8.8"]
    assert result["likely_cause"] == "propagation_lag"
    assert result["recommend_lower_ttl"] is True


def test_authoritative_mismatch_when_expired_ttl_still_disagrees():
    result = diagnose_resolver_inconsistency(
        authoritative_answer={"203.0.113.10"},
        resolver_answers={"1.1.1.1": {"198.51.100.5"}},
        resolver_ttls={"1.1.1.1": 2},
        configured_ttl=300,
    )
    assert result["consistent"] is False
    assert result["likely_cause"] == "authoritative_mismatch"
    assert result["recommend_lower_ttl"] is False


def test_authoritative_mismatch_when_all_resolvers_agree_but_differ_from_authoritative():
    result = diagnose_resolver_inconsistency(
        authoritative_answer={"203.0.113.10"},
        resolver_answers={"1.1.1.1": {"198.51.100.5"}, "8.8.8.8": {"198.51.100.5"}},
        resolver_ttls={"1.1.1.1": 200, "8.8.8.8": 200},
        configured_ttl=300,
    )
    assert result["consistent"] is False
    assert result["likely_cause"] == "authoritative_mismatch"
    assert result["recommend_lower_ttl"] is False


def test_propagation_lag_with_low_ttl_does_not_recommend_lower_ttl():
    result = diagnose_resolver_inconsistency(
        authoritative_answer={"203.0.113.10"},
        resolver_answers={"1.1.1.1": {"203.0.113.10"}, "8.8.8.8": {"198.51.100.5"}},
        resolver_ttls={"1.1.1.1": 100, "8.8.8.8": 250},
        configured_ttl=300,
    )
    assert result["consistent"] is False
    assert result["likely_cause"] == "propagation_lag"
    assert result["recommend_lower_ttl"] is False


def test_missing_ttl_entry_falls_back_to_configured_ttl():
    # Missing TTL entries fall back to configured_ttl (not near-expired), but
    # a single stale resolver with none matching still reads as an
    # authoritative mismatch, since there is no other resolver corroborating
    # the authoritative answer.
    result = diagnose_resolver_inconsistency(
        authoritative_answer={"203.0.113.10"},
        resolver_answers={"1.1.1.1": {"198.51.100.5"}},
        resolver_ttls={},
        configured_ttl=86400,
    )
    assert result["consistent"] is False
    assert result["likely_cause"] == "authoritative_mismatch"
    assert result["recommend_lower_ttl"] is False


def test_propagation_lag_needs_at_least_one_matching_resolver():
    result = diagnose_resolver_inconsistency(
        authoritative_answer={"203.0.113.10"},
        resolver_answers={
            "1.1.1.1": {"203.0.113.10"},
            "8.8.8.8": {"198.51.100.5"},
            "9.9.9.9": {"198.51.100.5"},
        },
        resolver_ttls={"1.1.1.1": 50, "8.8.8.8": 60000, "9.9.9.9": 60000},
        configured_ttl=86400,
    )
    assert result["consistent"] is False
    assert set(result["stale_resolvers"]) == {"8.8.8.8", "9.9.9.9"}
    assert result["likely_cause"] == "propagation_lag"
    assert result["recommend_lower_ttl"] is True

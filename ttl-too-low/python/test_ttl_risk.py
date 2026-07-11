from ttl_too_low import assess_ttl_risk


def test_low_ttl_high_traffic_is_risky():
    result = assess_ttl_risk(60, daily_unique_resolvers=500000)
    assert result["risky"] is True
    assert result["estimated_qps"] > 5.0


def test_normal_ttl_low_traffic_is_not_risky():
    result = assess_ttl_risk(3600, daily_unique_resolvers=1000)
    assert result["risky"] is False


def test_ttl_below_min_safe_is_risky_even_with_low_traffic():
    result = assess_ttl_risk(30, daily_unique_resolvers=100)
    assert result["risky"] is True


def test_recommended_ttl_is_from_the_ladder():
    result = assess_ttl_risk(60, daily_unique_resolvers=500000)
    assert result["recommended_ttl"] in (60, 120, 300, 900, 3600, 86400)


def test_recommended_ttl_brings_qps_under_threshold():
    result = assess_ttl_risk(60, daily_unique_resolvers=100000, qps_risk_threshold=5.0)
    assert 100000 / result["recommended_ttl"] <= 5.0


def test_zero_ttl_does_not_divide_by_zero():
    result = assess_ttl_risk(0, daily_unique_resolvers=1000)
    assert result["estimated_qps"] == 1000.0
    assert result["risky"] is True

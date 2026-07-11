from ttl_too_high import classify_ttl


def test_low_ttl_is_safe():
    assert classify_ttl(300, 3600) == "safe"


def test_ttl_at_threshold_is_safe():
    assert classify_ttl(3600, 3600) == "safe"


def test_ttl_above_threshold_is_high():
    assert classify_ttl(86400, 3600) == "high_ttl"


def test_automatic_ttl_of_one_is_safe():
    assert classify_ttl(1, 3600) == "safe"


def test_missing_ttl_is_safe():
    assert classify_ttl(None, 3600) == "safe"


def test_custom_threshold_is_respected():
    assert classify_ttl(1800, 900) == "high_ttl"
    assert classify_ttl(600, 900) == "safe"

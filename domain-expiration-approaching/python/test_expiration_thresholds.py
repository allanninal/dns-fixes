from check_domain_expiry import days_until_expiry


def test_ok_when_plenty_of_runway():
    result = days_until_expiry("2026-09-15T00:00:00Z", "2026-08-01T00:00:00Z")
    assert result["severity"] == "ok"
    assert result["triggered_threshold"] is None
    assert result["days_remaining"] == 45


def test_warning_at_thirty_day_boundary():
    result = days_until_expiry("2026-08-31T00:00:00Z", "2026-08-01T00:00:00Z")
    assert result["days_remaining"] == 30
    assert result["severity"] == "warning"
    assert result["triggered_threshold"] == 30


def test_warning_inside_fourteen_day_window():
    result = days_until_expiry("2026-08-10T00:00:00Z", "2026-08-01T00:00:00Z")
    assert result["days_remaining"] == 9
    assert result["severity"] == "warning"
    assert result["triggered_threshold"] == 14


def test_critical_at_seven_day_boundary():
    result = days_until_expiry("2026-08-08T00:00:00Z", "2026-08-01T00:00:00Z")
    assert result["days_remaining"] == 7
    assert result["severity"] == "critical"
    assert result["triggered_threshold"] == 7


def test_critical_one_day_left():
    result = days_until_expiry("2026-08-02T00:00:00Z", "2026-08-01T00:00:00Z")
    assert result["days_remaining"] == 1
    assert result["severity"] == "critical"
    assert result["triggered_threshold"] == 1


def test_expired_when_negative():
    result = days_until_expiry("2026-07-25T00:00:00Z", "2026-08-01T00:00:00Z")
    assert result["days_remaining"] == -7
    assert result["severity"] == "expired"
    assert result["triggered_threshold"] is None


def test_custom_thresholds():
    result = days_until_expiry(
        "2026-08-21T00:00:00Z", "2026-08-01T00:00:00Z", warn_thresholds_days=[60, 20, 5]
    )
    assert result["days_remaining"] == 20
    assert result["severity"] == "warning"
    assert result["triggered_threshold"] == 20

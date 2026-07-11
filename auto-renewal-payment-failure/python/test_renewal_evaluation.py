from auto_renewal_payment_failure import evaluate_renewal


def test_ok_when_date_moved_forward_and_far_out():
    result = evaluate_renewal(
        "2027-08-05T00:00:00Z", "2026-08-05T00:00:00Z", "2026-07-11T00:00:00Z", []
    )
    assert result["stalled"] is False
    assert result["payment_likely_failed"] is False


def test_stalled_and_inside_window_flags_failure():
    result = evaluate_renewal(
        "2026-08-05T00:00:00Z", "2026-08-05T00:00:00Z", "2026-07-20T00:00:00Z", []
    )
    assert result["stalled"] is True
    assert result["payment_likely_failed"] is True


def test_stalled_but_far_from_window_is_not_yet_a_failure():
    result = evaluate_renewal(
        "2027-08-05T00:00:00Z", "2027-08-05T00:00:00Z", "2026-07-11T00:00:00Z", []
    )
    assert result["stalled"] is True
    assert result["payment_likely_failed"] is False


def test_grace_period_status_always_flags_failure():
    result = evaluate_renewal(
        "2027-08-05T00:00:00Z", None, "2026-07-11T00:00:00Z", ["autoRenewPeriod"]
    )
    assert result["in_grace_period"] is True
    assert result["payment_likely_failed"] is True


def test_no_previous_expiration_defaults_to_not_stalled():
    result = evaluate_renewal(
        "2026-07-20T00:00:00Z", None, "2026-07-11T00:00:00Z", []
    )
    assert result["stalled"] is False
    assert result["payment_likely_failed"] is False


def test_redemption_period_status_flags_failure():
    result = evaluate_renewal(
        "2026-07-05T00:00:00Z", "2026-07-05T00:00:00Z", "2026-07-11T00:00:00Z", ["redemptionPeriod"]
    )
    assert result["in_grace_period"] is True
    assert result["payment_likely_failed"] is True


def test_custom_warn_days_threshold():
    result = evaluate_renewal(
        "2026-08-10T00:00:00Z", "2026-08-10T00:00:00Z", "2026-07-11T00:00:00Z", [], warn_days=45
    )
    assert result["stalled"] is True
    assert result["payment_likely_failed"] is True

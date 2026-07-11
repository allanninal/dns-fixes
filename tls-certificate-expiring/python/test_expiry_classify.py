from datetime import datetime, timedelta, timezone

from check_tls_expiry import days_until_expiry, classify


def test_days_until_expiry_future():
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    not_after = now + timedelta(days=45)
    assert days_until_expiry(not_after, now) == 45


def test_days_until_expiry_past():
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    not_after = now - timedelta(days=3)
    assert days_until_expiry(not_after, now) == -3


def test_classify_ok_when_plenty_of_runway():
    assert classify(60) == "ok"


def test_classify_warn_at_boundary():
    assert classify(21, warn_at=21, crit_at=7) == "warn"


def test_classify_warn_just_inside_window():
    assert classify(15, warn_at=21, crit_at=7) == "warn"


def test_classify_critical_at_boundary():
    assert classify(7, warn_at=21, crit_at=7) == "critical"


def test_classify_critical_just_inside_window():
    assert classify(2, warn_at=21, crit_at=7) == "critical"


def test_classify_expired_when_negative():
    assert classify(-1) == "expired"


def test_classify_expired_many_days_past():
    assert classify(-30) == "expired"

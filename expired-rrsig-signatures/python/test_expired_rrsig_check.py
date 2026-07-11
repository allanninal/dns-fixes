from datetime import datetime, timedelta, timezone

from expired_rrsig_signatures import check_rrsig_expiration

NOW = datetime(2026, 7, 11, 12, 0, 0, tzinfo=timezone.utc)


def test_ok_when_expiration_far_in_future():
    expiration = NOW + timedelta(days=10)
    assert check_rrsig_expiration(expiration, NOW, 48) == "ok"


def test_expiring_soon_within_warn_window():
    expiration = NOW + timedelta(hours=12)
    assert check_rrsig_expiration(expiration, NOW, 48) == "expiring_soon"


def test_expired_when_expiration_already_passed():
    expiration = NOW - timedelta(hours=1)
    assert check_rrsig_expiration(expiration, NOW, 48) == "expired"


def test_expired_exactly_at_boundary():
    assert check_rrsig_expiration(NOW, NOW, 48) == "expired"


def test_not_expiring_soon_just_outside_warn_window():
    expiration = NOW + timedelta(hours=49)
    assert check_rrsig_expiration(expiration, NOW, 48) == "ok"

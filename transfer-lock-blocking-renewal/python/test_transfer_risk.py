from datetime import datetime, timezone
from check_transfer_lock_risk import assess_transfer_risk

NOW = datetime(2026, 7, 11, tzinfo=timezone.utc)


def test_at_risk_when_locked_and_within_window():
    expiration = datetime(2026, 8, 5, tzinfo=timezone.utc)
    result = assess_transfer_risk(["clientTransferProhibited", "active"], expiration, NOW, 30)
    assert result["locked"] is True
    assert result["days_until_expiry"] == 25
    assert result["at_risk"] is True


def test_not_at_risk_when_unlocked():
    expiration = datetime(2026, 8, 5, tzinfo=timezone.utc)
    result = assess_transfer_risk(["active"], expiration, NOW, 30)
    assert result["locked"] is False
    assert result["at_risk"] is False


def test_not_at_risk_when_locked_but_far_from_expiry():
    expiration = datetime(2027, 1, 1, tzinfo=timezone.utc)
    result = assess_transfer_risk(["clientTransferProhibited"], expiration, NOW, 30)
    assert result["locked"] is True
    assert result["at_risk"] is False


def test_not_at_risk_when_already_expired():
    expiration = datetime(2026, 7, 1, tzinfo=timezone.utc)
    result = assess_transfer_risk(["clientTransferProhibited"], expiration, NOW, 30)
    assert result["days_until_expiry"] == -10
    assert result["at_risk"] is False


def test_server_transfer_prohibited_also_counts_as_locked():
    expiration = datetime(2026, 7, 20, tzinfo=timezone.utc)
    result = assess_transfer_risk(["serverTransferProhibited"], expiration, NOW, 30)
    assert result["locked"] is True
    assert result["at_risk"] is True


def test_status_normalization_is_case_and_space_insensitive():
    expiration = datetime(2026, 7, 25, tzinfo=timezone.utc)
    result = assess_transfer_risk(["Client Transfer Prohibited"], expiration, NOW, 30)
    assert result["locked"] is True

from dmarc_policy_check import next_dmarc_policy

RECORD = "v=DMARC1; p=none; rua=mailto:dmarc-reports@example.com; pct=100"


def test_none_when_already_past_none():
    record = "v=DMARC1; p=quarantine; pct=25; rua=mailto:dmarc-reports@example.com"
    assert next_dmarc_policy(record, 200, 0.99) is None


def test_none_when_too_soon_since_last_change():
    assert next_dmarc_policy(RECORD, 30, 0.99) is None


def test_none_when_alignment_too_low():
    assert next_dmarc_policy(RECORD, 200, 0.80) is None


def test_bumps_to_quarantine_when_safe():
    result = next_dmarc_policy(RECORD, 200, 0.99)
    assert "p=quarantine" in result
    assert "pct=25" in result

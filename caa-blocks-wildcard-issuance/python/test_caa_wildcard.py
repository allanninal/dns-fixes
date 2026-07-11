from wildcard_caa_check import wildcard_caa_blocked


def test_blocked_when_issuewild_names_different_ca():
    records = [(0, "issue", "letsencrypt.org"), (0, "issuewild", "sectigo.com")]
    blocked, reason = wildcard_caa_blocked(records, "letsencrypt.org")
    assert blocked is True
    assert "sectigo.com" in reason


def test_blocked_when_issuewild_denies_all():
    records = [(0, "issue", "letsencrypt.org"), (0, "issuewild", ";")]
    blocked, reason = wildcard_caa_blocked(records, "letsencrypt.org")
    assert blocked is True
    assert "deny all" in reason


def test_not_blocked_when_issuewild_matches():
    records = [(0, "issue", "letsencrypt.org"), (0, "issuewild", "letsencrypt.org")]
    blocked, reason = wildcard_caa_blocked(records, "letsencrypt.org")
    assert blocked is False
    assert reason == ""


def test_not_blocked_when_no_issuewild_present():
    records = [(0, "issue", "letsencrypt.org")]
    blocked, reason = wildcard_caa_blocked(records, "letsencrypt.org")
    assert blocked is False
    assert reason == ""


def test_not_blocked_when_desired_ca_not_in_issue_at_all():
    records = [(0, "issue", "sectigo.com"), (0, "issuewild", "digicert.com")]
    blocked, reason = wildcard_caa_blocked(records, "letsencrypt.org")
    assert blocked is False
    assert reason == ""


def test_blocked_checks_all_issuewild_values():
    records = [
        (0, "issue", "letsencrypt.org"),
        (0, "issuewild", "letsencrypt.org"),
        (0, "issuewild", "sectigo.com"),
    ]
    blocked, reason = wildcard_caa_blocked(records, "letsencrypt.org")
    assert blocked is True
    assert "sectigo.com" in reason

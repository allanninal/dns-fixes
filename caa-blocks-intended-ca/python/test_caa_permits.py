from caa_blocks_intended_ca import caa_permits_ca


def test_no_caa_records_permits_any_ca():
    permitted, _ = caa_permits_ca([], "letsencrypt.org")
    assert permitted is True


def test_matching_issue_record_permits():
    records = [("issue", "letsencrypt.org")]
    permitted, _ = caa_permits_ca(records, "letsencrypt.org")
    assert permitted is True


def test_mismatched_issue_record_blocks():
    records = [("issue", "digicert.com")]
    permitted, reason = caa_permits_ca(records, "letsencrypt.org")
    assert permitted is False
    assert "no issue record names letsencrypt.org" in reason


def test_empty_issue_record_blocks_everyone():
    records = [("issue", ";")]
    permitted, reason = caa_permits_ca(records, "letsencrypt.org")
    assert permitted is False
    assert "empty" in reason


def test_wildcard_falls_back_to_issue_when_no_issuewild():
    records = [("issue", "letsencrypt.org")]
    permitted, _ = caa_permits_ca(records, "letsencrypt.org", is_wildcard=True)
    assert permitted is True


def test_wildcard_uses_issuewild_when_present():
    records = [("issue", "letsencrypt.org"), ("issuewild", "digicert.com")]
    permitted, reason = caa_permits_ca(records, "letsencrypt.org", is_wildcard=True)
    assert permitted is False
    assert "issuewild" in reason


def test_accounturi_suffix_is_ignored_for_ca_name_match():
    records = [("issue", "letsencrypt.org;accounturi=https://acme-v02.api.letsencrypt.org/acme/acct/1")]
    permitted, _ = caa_permits_ca(records, "letsencrypt.org")
    assert permitted is True


def test_no_relevant_tag_present_permits():
    records = [("iodef", "mailto:security@example.com")]
    permitted, _ = caa_permits_ca(records, "letsencrypt.org")
    assert permitted is True

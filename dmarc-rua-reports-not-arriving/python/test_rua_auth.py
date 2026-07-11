from dmarc_rua_auth_check import needs_third_party_auth, parse_rua_domain


def test_no_auth_needed_when_same_domain():
    assert needs_third_party_auth("example.com", "example.com", [], []) is False


def test_no_auth_needed_when_rua_is_subdomain():
    assert needs_third_party_auth("example.com", "mail.example.com", [], []) is False


def test_auth_needed_when_different_domain_and_missing():
    assert needs_third_party_auth("example.com", "reports.example.net", [], []) is True


def test_no_auth_needed_when_specific_record_present():
    result = needs_third_party_auth(
        "example.com", "reports.example.net", ["v=DMARC1"], []
    )
    assert result is False


def test_no_auth_needed_when_wildcard_record_present():
    result = needs_third_party_auth(
        "example.com", "reports.example.net", [], ["v=DMARC1"]
    )
    assert result is False


def test_auth_needed_when_records_present_but_invalid():
    result = needs_third_party_auth(
        "example.com", "reports.example.net", ["not a valid record"], ["also invalid"]
    )
    assert result is True


def test_parse_rua_domain_from_record():
    record = "v=DMARC1; p=quarantine; rua=mailto:agg@reports.example.net"
    assert parse_rua_domain(record) == "reports.example.net"


def test_parse_rua_domain_with_multiple_addresses_uses_first():
    record = "v=DMARC1; rua=mailto:agg@reports.example.net,mailto:other@else.example"
    assert parse_rua_domain(record) == "reports.example.net"


def test_parse_rua_domain_returns_none_without_rua():
    assert parse_rua_domain("v=DMARC1; p=none") is None

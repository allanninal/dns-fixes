from dmarc_record_missing_or_malformed import validate_dmarc_record


def test_missing_when_no_records():
    result = validate_dmarc_record([])
    assert result["status"] == "missing"
    assert result["tags"] is None


def test_duplicate_when_two_records():
    records = [
        "v=DMARC1; p=none",
        "v=DMARC1; p=reject",
    ]
    result = validate_dmarc_record(records)
    assert result["status"] == "duplicate"


def test_valid_record_with_p_none():
    result = validate_dmarc_record(["v=DMARC1; p=none; rua=mailto:dmarc@example.com"])
    assert result["status"] == "valid"
    assert result["tags"]["p"] == "none"
    assert result["tags"]["v"] == "DMARC1"


def test_valid_record_with_p_quarantine_and_pct():
    result = validate_dmarc_record(
        ["v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com; pct=100"]
    )
    assert result["status"] == "valid"
    assert result["tags"]["p"] == "quarantine"
    assert result["tags"]["pct"] == "100"


def test_valid_record_with_p_reject():
    result = validate_dmarc_record(["v=DMARC1; p=reject"])
    assert result["status"] == "valid"


def test_invalid_when_p_before_v():
    result = validate_dmarc_record(["p=none; v=DMARC1"])
    assert result["status"] == "invalid"
    assert "start with v=DMARC1" in result["reason"]


def test_invalid_when_p_missing():
    result = validate_dmarc_record(["v=DMARC1; rua=mailto:dmarc@example.com"])
    assert result["status"] == "invalid"
    assert "p=" in result["reason"]


def test_invalid_when_p_value_not_allowed():
    result = validate_dmarc_record(["v=DMARC1; p=maybe"])
    assert result["status"] == "invalid"


def test_invalid_when_tag_repeated():
    result = validate_dmarc_record(["v=DMARC1; p=none; p=reject"])
    assert result["status"] == "invalid"
    assert "more than once" in result["reason"]


def test_invalid_when_not_dmarc1():
    result = validate_dmarc_record(["v=spf1 include:_spf.google.com ~all"])
    assert result["status"] == "invalid"


def test_invalid_when_empty_string():
    result = validate_dmarc_record([""])
    assert result["status"] == "invalid"


def test_invalid_when_tag_has_no_value():
    result = validate_dmarc_record(["v=DMARC1; p"])
    assert result["status"] == "invalid"


def test_handles_quoted_txt_string():
    result = validate_dmarc_record(['"v=DMARC1; p=none"'])
    assert result["status"] == "valid"

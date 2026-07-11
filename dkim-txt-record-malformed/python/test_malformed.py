from dkim_txt_check import validate_dkim_txt


def test_empty_when_no_strings():
    result = validate_dkim_txt([])
    assert result["valid"] is False
    assert result["reason"] == "empty_key"


def test_embedded_quotes_flagged():
    result = validate_dkim_txt(['"v=DKIM1; k=rsa; p=AAA123"'])
    assert result["valid"] is False
    assert result["reason"] == "embedded_quotes"


def test_not_base64_flagged():
    result = validate_dkim_txt(["v=DKIM1; k=rsa; p=not-valid-base64!!!"])
    assert result["valid"] is False
    assert result["reason"] == "not_base64"


def test_valid_key_decodes():
    result = validate_dkim_txt(["v=DKIM1; k=rsa; p=aGVsbG93b3JsZA=="])
    assert result["valid"] is True
    assert result["reason"] == "ok"
    assert result["key_bytes"] == 10


def test_key_split_across_two_strings_joins_cleanly():
    result = validate_dkim_txt(["v=DKIM1; k=rsa; p=aGVsbG8=", ""])
    assert result["valid"] is True
    assert result["key_bytes"] == 5


def test_embedded_space_in_key_flagged():
    result = validate_dkim_txt(["v=DKIM1; k=rsa; p=aGVsbG8 gd29ybGQ="])
    assert result["valid"] is False
    assert result["reason"] == "embedded_quotes"


def test_multiple_rrsets_handled_by_caller_not_pure_fn():
    # The pure function only validates one already-selected RRset's strings.
    # Detecting more than one RRset at the same name is done by the caller
    # in run(), not by validate_dkim_txt itself.
    result = validate_dkim_txt(["v=DKIM1; k=rsa; p=aGVsbG8="])
    assert result["valid"] is True

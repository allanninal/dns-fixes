from dkim_selector_check import evaluate_dkim_selector


def test_missing_when_no_answers():
    result = evaluate_dkim_selector([], "google")
    assert result["status"] == "missing"


def test_stale_when_not_dkim1():
    result = evaluate_dkim_selector(["v=spf1 include:_spf.example.com ~all"], "google")
    assert result["status"] == "stale"


def test_stale_when_pubkey_does_not_match():
    result = evaluate_dkim_selector(["v=DKIM1; k=rsa; p=AAA123"], "google", expected_pubkey_fragment="ZZZ999")
    assert result["status"] == "stale"


def test_ok_when_record_matches():
    result = evaluate_dkim_selector(["v=DKIM1; k=rsa; p=AAA123"], "google", expected_pubkey_fragment="AAA123")
    assert result["status"] == "ok"


def test_ok_when_no_pubkey_fragment_required():
    result = evaluate_dkim_selector(["v=DKIM1; k=rsa; p=AAA123"], "google")
    assert result["status"] == "ok"

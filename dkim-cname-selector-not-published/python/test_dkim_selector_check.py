from dkim_cname_selector_check import check_dkim_selectors

EXPECTED = {
    "selector1": "selector1-yourdomain-com._domainkey.yourdomain.onmicrosoft.com",
    "selector2": "selector2-yourdomain-com._domainkey.yourdomain.onmicrosoft.com",
}


def test_healthy_when_both_selectors_match():
    records = {
        "selector1": {"type": "CNAME", "target": EXPECTED["selector1"]},
        "selector2": {"type": "CNAME", "target": EXPECTED["selector2"]},
    }
    assert check_dkim_selectors(records, EXPECTED) == []


def test_missing_selector_is_flagged():
    records = {
        "selector1": {"type": "CNAME", "target": EXPECTED["selector1"]},
        "selector2": {"type": None, "target": None},
    }
    findings = check_dkim_selectors(records, EXPECTED)
    assert len(findings) == 1
    assert findings[0]["selector"] == "selector2"
    assert findings[0]["issue"] == "missing"


def test_txt_instead_of_cname_is_wrong_type():
    records = {
        "selector1": {"type": "CNAME", "target": EXPECTED["selector1"]},
        "selector2": {"type": "TXT", "target": None},
    }
    findings = check_dkim_selectors(records, EXPECTED)
    assert findings[0]["issue"] == "wrong_type"
    assert findings[0]["found"] == "TXT"


def test_wrong_target_is_flagged_as_mismatch():
    records = {
        "selector1": {"type": "CNAME", "target": EXPECTED["selector1"]},
        "selector2": {"type": "CNAME", "target": "someone-elses-tenant._domainkey.example.onmicrosoft.com"},
    }
    findings = check_dkim_selectors(records, EXPECTED)
    assert findings[0]["issue"] == "target_mismatch"


def test_missing_both_selectors_returns_two_findings():
    records = {
        "selector1": {"type": None, "target": None},
        "selector2": {"type": None, "target": None},
    }
    findings = check_dkim_selectors(records, EXPECTED)
    assert len(findings) == 2
    assert {f["selector"] for f in findings} == {"selector1", "selector2"}

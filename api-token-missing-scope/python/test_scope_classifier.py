from diagnose_token_scope import diagnose_token_scope


def test_ok_when_everything_succeeds():
    assert diagnose_token_scope(True, {"success": True}, {"success": True}) == "ok"


def test_token_invalid_when_verify_fails():
    assert diagnose_token_scope(False, {"success": True}, {"success": True}) == "token_invalid"


def test_missing_zone_read_when_zone_list_fails():
    result = diagnose_token_scope(True, {"success": False}, {"success": True})
    assert result == "missing_zone_read"


def test_missing_dns_edit_when_dns_read_fails():
    result = diagnose_token_scope(True, {"success": True}, {"success": False})
    assert result == "missing_dns_edit"


def test_verify_failure_takes_priority_over_other_failures():
    result = diagnose_token_scope(False, {"success": False}, {"success": False})
    assert result == "token_invalid"


def test_zone_read_failure_takes_priority_over_dns_edit():
    result = diagnose_token_scope(True, {"success": False}, {"success": False})
    assert result == "missing_zone_read"


def test_missing_success_key_treated_as_failure():
    result = diagnose_token_scope(True, {}, {"success": True})
    assert result == "missing_zone_read"

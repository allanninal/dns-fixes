from dkim_key_rotation_check import dkim_key_mismatch, MISSING


def test_missing_when_no_record():
    assert dkim_key_mismatch("", "AAA123") == MISSING


def test_missing_when_no_p_tag_at_all():
    assert dkim_key_mismatch("v=DKIM1; k=rsa", "AAA123") == MISSING


def test_revoked_when_p_is_empty():
    assert dkim_key_mismatch("v=DKIM1; p=", "AAA123") is False


def test_mismatch_when_keys_differ():
    published = "v=DKIM1; k=rsa; p=OLDKEY000"
    assert dkim_key_mismatch(published, "NEWKEY111") is True


def test_ok_when_keys_match():
    published = "v=DKIM1; k=rsa; p=SAMEKEY42"
    assert dkim_key_mismatch(published, "SAMEKEY42") is False


def test_handles_concatenated_quoted_chunks():
    published = '"v=DKIM1; k=rsa; " "p=SPLITKEY99"'
    assert dkim_key_mismatch(published, "SPLITKEY99") is False


def test_deployed_key_with_surrounding_whitespace_still_matches():
    published = "v=DKIM1; k=rsa; p=SAMEKEY42"
    assert dkim_key_mismatch(published, "  SAMEKEY42  ") is False

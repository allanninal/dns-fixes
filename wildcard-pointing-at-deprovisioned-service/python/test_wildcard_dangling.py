from dangling_wildcard import is_dangling_wildcard

VULN = {"no such app", "nosuchbucket"}


def wildcard_record(**over):
    base = {"name": "*.example.com", "type": "CNAME", "content": "old-app.paas.net"}
    base.update(over)
    return base


def test_dangling_when_target_is_nxdomain():
    record = wildcard_record()
    assert is_dangling_wildcard(record, "NXDOMAIN", None, VULN) is True


def test_dangling_when_target_is_servfail():
    record = wildcard_record()
    assert is_dangling_wildcard(record, "SERVFAIL", None, VULN) is True


def test_dangling_when_fingerprint_matches_known_vulnerable():
    record = wildcard_record()
    assert is_dangling_wildcard(record, "OK", "no such app", VULN) is True


def test_not_dangling_when_target_ok_and_fingerprint_unknown():
    record = wildcard_record()
    assert is_dangling_wildcard(record, "OK", "welcome home", VULN) is False


def test_not_dangling_when_not_a_wildcard_name():
    record = wildcard_record(name="shop.example.com")
    assert is_dangling_wildcard(record, "NXDOMAIN", None, VULN) is False


def test_not_dangling_when_not_cname_type():
    record = wildcard_record(type="A")
    assert is_dangling_wildcard(record, "NXDOMAIN", None, VULN) is False

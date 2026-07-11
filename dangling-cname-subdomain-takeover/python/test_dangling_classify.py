from dangling_cname_takeover import classify_cname_target


def test_ok_when_target_resolves_and_answers_normally():
    status = {"resolves": True, "http_status": 200, "body_snippet": "welcome to our site"}
    assert classify_cname_target(status) == "ok"


def test_dangling_when_target_does_not_resolve():
    status = {"resolves": False, "http_status": None, "body_snippet": ""}
    assert classify_cname_target(status) == "dangling"


def test_dangling_when_body_matches_unclaimed_signature():
    status = {"resolves": True, "http_status": 404, "body_snippet": "There isn't a GitHub Pages site here."}
    assert classify_cname_target(status) == "dangling"


def test_unknown_when_status_is_missing():
    assert classify_cname_target(None) == "unknown"

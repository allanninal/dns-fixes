from tls_san_hostname_mismatch import san_covers_hostname


def test_exact_match():
    assert san_covers_hostname("example.com", ["example.com", "www.example.com"]) is True


def test_case_insensitive_exact_match():
    assert san_covers_hostname("APP.example.com", ["app.example.com"]) is True


def test_missing_hostname_returns_false():
    assert san_covers_hostname("app.example.com", ["example.com", "www.example.com"]) is False


def test_wildcard_matches_one_label_subdomain():
    assert san_covers_hostname("app.example.com", ["*.example.com"]) is True


def test_wildcard_does_not_match_two_label_subdomain():
    assert san_covers_hostname("a.b.example.com", ["*.example.com"]) is False


def test_wildcard_does_not_match_bare_apex():
    assert san_covers_hostname("example.com", ["*.example.com"]) is False


def test_trailing_dot_and_whitespace_are_normalized():
    assert san_covers_hostname(" example.com. ", ["example.com"]) is True

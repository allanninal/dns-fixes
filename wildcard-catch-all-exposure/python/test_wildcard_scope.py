from wildcard_catch_all import classify_wildcard_scope


def test_apex_catch_all():
    assert classify_wildcard_scope("*.example.com", "example.com") == "apex_catch_all"


def test_scoped_subzone():
    assert classify_wildcard_scope("*.tenants.example.com", "example.com") == "scoped_subzone"


def test_not_wildcard():
    assert classify_wildcard_scope("app.example.com", "example.com") == "not_wildcard"


def test_deeply_scoped_subzone():
    assert classify_wildcard_scope("*.eu.tenants.example.com", "example.com") == "scoped_subzone"


def test_bare_star_dot_apex_is_apex_catch_all():
    assert classify_wildcard_scope("*.example.com", "example.com") == "apex_catch_all"


def test_wildcard_on_unrelated_domain_treated_as_apex_catch_all():
    assert classify_wildcard_scope("*.other.com", "example.com") == "apex_catch_all"

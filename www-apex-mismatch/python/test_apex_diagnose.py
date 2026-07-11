from www_apex_mismatch import diagnose_www_apex


def test_ok_when_both_resolve_to_same_ips():
    ips = {"185.199.108.153", "185.199.109.153"}
    assert diagnose_www_apex(ips, None, ips, None) == "ok"


def test_apex_missing_when_apex_has_nothing():
    assert diagnose_www_apex(set(), None, {"185.199.108.153"}, None) == "apex_missing"


def test_www_missing_when_www_has_nothing():
    assert diagnose_www_apex({"185.199.108.153"}, None, set(), None) == "www_missing"


def test_both_missing_when_neither_resolves():
    assert diagnose_www_apex(set(), None, set(), None) == "both_missing"


def test_ip_mismatch_when_disjoint_ip_sets():
    apex_ips = {"34.102.136.180"}
    www_ips = {"185.199.108.153"}
    assert diagnose_www_apex(apex_ips, None, www_ips, None) == "ip_mismatch"


def test_ok_when_apex_uses_cname_alias_only():
    assert diagnose_www_apex(set(), "www.example.com", {"185.199.108.153"}, None) == "ok"

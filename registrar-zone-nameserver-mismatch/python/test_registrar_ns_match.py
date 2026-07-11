from check_ns_mismatch import ns_sets_match


def test_matches_when_identical():
    assert ns_sets_match(["ns1.example.com"], ["ns1.example.com"]) is True


def test_matches_ignoring_case():
    assert ns_sets_match(["NS1.EXAMPLE.COM"], ["ns1.example.com"]) is True


def test_matches_ignoring_trailing_dot():
    assert ns_sets_match(["ns1.example.com."], ["ns1.example.com"]) is True


def test_matches_ignoring_order():
    a = ["bob.ns.cloudflare.com", "kate.ns.cloudflare.com"]
    b = ["kate.ns.cloudflare.com", "bob.ns.cloudflare.com"]
    assert ns_sets_match(a, b) is True


def test_mismatch_on_old_vs_new_host():
    old = ["ns1.oldhost.com", "ns2.oldhost.com"]
    new = ["bob.ns.cloudflare.com", "kate.ns.cloudflare.com"]
    assert ns_sets_match(old, new) is False


def test_mismatch_when_one_list_has_an_extra_server():
    a = ["ns1.example.com", "ns2.example.com"]
    b = ["ns1.example.com", "ns2.example.com", "ns3.example.com"]
    assert ns_sets_match(a, b) is False


def test_mismatch_when_one_list_is_missing_a_server():
    a = ["ns1.example.com", "ns2.example.com"]
    b = ["ns1.example.com"]
    assert ns_sets_match(a, b) is False


def test_both_empty_counts_as_matching():
    assert ns_sets_match([], []) is True


def test_one_empty_one_not_is_a_mismatch():
    assert ns_sets_match([], ["ns1.example.com"]) is False

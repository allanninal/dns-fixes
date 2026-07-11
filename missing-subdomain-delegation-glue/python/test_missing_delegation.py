from check_delegation import is_delegation_missing


def test_missing_when_parent_has_nothing():
    assert is_delegation_missing([], ["ns1.cloudflare.com", "ns2.cloudflare.com"], True) is True


def test_missing_when_parent_and_child_disagree():
    parent = ["ns1.oldhost.com"]
    child = ["ns1.cloudflare.com", "ns2.cloudflare.com"]
    assert is_delegation_missing(parent, child, True) is True


def test_ok_when_parent_and_child_agree():
    parent = ["ns1.cloudflare.com", "ns2.cloudflare.com"]
    child = ["ns1.cloudflare.com", "ns2.cloudflare.com"]
    assert is_delegation_missing(parent, child, True) is False


def test_ok_when_sets_partially_overlap():
    parent = ["ns1.cloudflare.com", "ns3.oldhost.com"]
    child = ["ns1.cloudflare.com", "ns2.cloudflare.com"]
    assert is_delegation_missing(parent, child, True) is False


def test_not_a_problem_when_child_not_configured():
    assert is_delegation_missing([], [], False) is False


def test_not_a_problem_when_child_soa_present_but_no_ns():
    assert is_delegation_missing(["ns1.oldhost.com"], [], True) is False

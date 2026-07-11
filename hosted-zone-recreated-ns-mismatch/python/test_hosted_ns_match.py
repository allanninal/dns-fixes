from check_recreated_zone_ns import ns_sets_match


def test_matches_when_identical():
    assert ns_sets_match(["ns1.example.com"], ["ns1.example.com"]) is True


def test_matches_ignoring_case():
    assert ns_sets_match(["NS-321.AWSDNS-40.COM"], ["ns-321.awsdns-40.com"]) is True


def test_matches_ignoring_trailing_dot():
    assert ns_sets_match(["ns-321.awsdns-40.com."], ["ns-321.awsdns-40.com"]) is True


def test_matches_ignoring_order():
    a = ["ns-321.awsdns-40.com", "ns-1054.awsdns-04.org"]
    b = ["ns-1054.awsdns-04.org", "ns-321.awsdns-40.com"]
    assert ns_sets_match(a, b) is True


def test_mismatch_on_recreated_zone_vs_stale_registrar():
    new_zone = ["ns-321.awsdns-40.com", "ns-1054.awsdns-04.org"]
    old_registrar = ["ns-1.awsdns-00.com", "ns-2.awsdns-00.net"]
    assert ns_sets_match(new_zone, old_registrar) is False


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

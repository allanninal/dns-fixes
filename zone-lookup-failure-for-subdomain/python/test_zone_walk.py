from resolve_acme_zone import fqdn_labels, resolve_zone_for_challenge


LABELS = fqdn_labels("_acme-challenge.www.sub.example.com")


def test_resolves_to_parent_when_only_parent_has_soa_and_api_zone():
    soa = {"www.sub.example.com": False, "sub.example.com": False, "example.com": True, "com": False}
    api_zones = {"example.com"}
    assert resolve_zone_for_challenge(LABELS, soa, api_zones) == "example.com"


def test_resolves_to_delegated_subdomain_when_registered():
    soa = {"www.sub.example.com": False, "sub.example.com": True, "example.com": True, "com": False}
    api_zones = {"sub.example.com"}
    assert resolve_zone_for_challenge(LABELS, soa, api_zones) == "sub.example.com"


def test_none_when_soa_apex_not_in_provider_account():
    # Walk finds sub.example.com, but the account only has example.com.
    soa = {"www.sub.example.com": False, "sub.example.com": True, "example.com": True, "com": False}
    api_zones = {"example.com"}
    assert resolve_zone_for_challenge(LABELS, soa, api_zones) is None


def test_none_when_no_level_ever_answers_with_soa():
    soa = {"www.sub.example.com": False, "sub.example.com": False, "example.com": False, "com": False}
    api_zones = {"example.com"}
    assert resolve_zone_for_challenge(LABELS, soa, api_zones) is None


def test_stops_at_the_first_suffix_with_soa_not_a_later_one():
    # Both sub.example.com and example.com answer with SOA; the walk must
    # stop at the first (most specific) one, not skip ahead.
    soa = {"www.sub.example.com": False, "sub.example.com": True, "example.com": True, "com": False}
    api_zones = {"example.com", "sub.example.com"}
    assert resolve_zone_for_challenge(LABELS, soa, api_zones) == "sub.example.com"


def test_empty_provider_zone_set_is_always_none():
    soa = {"www.sub.example.com": False, "sub.example.com": False, "example.com": True, "com": False}
    assert resolve_zone_for_challenge(LABELS, soa, set()) is None

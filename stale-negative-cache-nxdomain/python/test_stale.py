from stale_negative_cache import stale_negative_cache_report


def test_detects_stale_resolver_when_authoritative_is_fixed():
    results = {"8.8.8.8": ("NXDOMAIN", 2143), "1.1.1.1": ("NOERROR", 299)}
    report = stale_negative_cache_report(3600, 2143, results, True)
    assert report["is_stale_negative_cache"] is True
    assert report["stale_resolvers"] == ["8.8.8.8"]
    assert report["eta_seconds"]["8.8.8.8"] == 2143
    assert report["max_wait_seconds"] == 2143


def test_not_stale_when_authoritative_still_missing():
    results = {"8.8.8.8": ("NXDOMAIN", 2143)}
    report = stale_negative_cache_report(3600, 2143, results, False)
    assert report["is_stale_negative_cache"] is False
    assert report["stale_resolvers"] == []


def test_no_stale_resolvers_when_all_agree():
    results = {"8.8.8.8": ("NOERROR", 300), "1.1.1.1": ("NOERROR", 300)}
    report = stale_negative_cache_report(3600, 0, results, True)
    assert report["is_stale_negative_cache"] is False
    assert report["max_wait_seconds"] == 0


def test_negative_ttl_is_clamped_to_zero():
    results = {"9.9.9.9": ("NXDOMAIN", -5)}
    report = stale_negative_cache_report(3600, -5, results, True)
    assert report["eta_seconds"]["9.9.9.9"] == 0


def test_multiple_stale_resolvers_report_max_wait():
    results = {
        "8.8.8.8": ("NXDOMAIN", 2143),
        "9.9.9.9": ("NXDOMAIN", 3500),
        "1.1.1.1": ("NOERROR", 299),
    }
    report = stale_negative_cache_report(3600, 3500, results, True)
    assert sorted(report["stale_resolvers"]) == ["8.8.8.8", "9.9.9.9"]
    assert report["max_wait_seconds"] == 3500

from custom_domain_dns_check import diagnose_pages_dns, GITHUB_PAGES_A_RECORDS


def test_all_ok_when_records_match():
    report = diagnose_pages_dns(GITHUB_PAGES_A_RECORDS, "yourusername.github.io", GITHUB_PAGES_A_RECORDS, ".github.io")
    assert report["apex_ok"] is True
    assert report["www_ok"] is True


def test_apex_missing_ips_reported():
    partial = {"185.199.108.153", "185.199.109.153"}
    report = diagnose_pages_dns(partial, "yourusername.github.io", GITHUB_PAGES_A_RECORDS, ".github.io")
    assert report["apex_ok"] is False
    assert report["apex_missing"] == {"185.199.110.153", "185.199.111.153"}


def test_apex_extra_ip_reported():
    extra_set = GITHUB_PAGES_A_RECORDS | {"203.0.113.10"}
    report = diagnose_pages_dns(extra_set, "yourusername.github.io", GITHUB_PAGES_A_RECORDS, ".github.io")
    assert report["apex_ok"] is False
    assert report["apex_extra"] == {"203.0.113.10"}


def test_www_wrong_target_reported():
    report = diagnose_pages_dns(GITHUB_PAGES_A_RECORDS, "old-host.example.net", GITHUB_PAGES_A_RECORDS, ".github.io")
    assert report["www_ok"] is False


def test_www_missing_reported():
    report = diagnose_pages_dns(GITHUB_PAGES_A_RECORDS, None, GITHUB_PAGES_A_RECORDS, ".github.io")
    assert report["www_ok"] is False

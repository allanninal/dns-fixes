from duplicate_conflicting_records import detect_duplicate_conflict


def rec(name, type_, content, id_):
    return {"name": name, "type": type_, "content": content, "id": id_}


def test_flags_cname_with_a_record_at_same_name():
    records = [
        rec("app.example.com", "CNAME", "app.hosting-provider.net", "r1"),
        rec("app.example.com", "A", "203.0.113.9", "r2"),
    ]
    result = detect_duplicate_conflict(records)
    assert result["conflict"] is True
    assert result["reason"] == "cname_coexistence"
    assert result["to_remove"] == ["r2"]


def test_round_robin_a_records_are_not_a_conflict():
    records = [
        rec("www.example.com", "A", "203.0.113.10", "r1"),
        rec("www.example.com", "A", "203.0.113.11", "r2"),
    ]
    expected_ips = ["203.0.113.10", "203.0.113.11"]
    result = detect_duplicate_conflict(records, expected_ips)
    assert result["conflict"] is False


def test_flags_stale_ip_among_duplicate_a_records():
    records = [
        rec("www.example.com", "A", "203.0.113.10", "r1"),
        rec("www.example.com", "A", "198.51.100.77", "r2"),
    ]
    expected_ips = ["203.0.113.10"]
    result = detect_duplicate_conflict(records, expected_ips)
    assert result["conflict"] is True
    assert result["reason"] == "ambiguous_duplicate_ip"
    assert result["to_remove"] == ["r2"]


def test_clean_zone_has_no_conflict():
    records = [
        rec("www.example.com", "CNAME", "www.hosting-provider.net", "r1"),
        rec("example.com", "A", "203.0.113.10", "r2"),
        rec("example.com", "MX", "mail.example.com", "r3"),
    ]
    assert detect_duplicate_conflict(records)["conflict"] is False


def test_lone_a_record_is_not_a_conflict():
    records = [rec("sub.example.com", "A", "203.0.113.10", "r1")]
    assert detect_duplicate_conflict(records)["conflict"] is False

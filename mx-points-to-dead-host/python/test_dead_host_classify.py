from mx_points_to_dead_host import classify_mx_health


def test_single_healthy_host_is_not_all_down():
    records = [(10, "mail1.example.com")]
    ips = {"mail1.example.com": ["203.0.113.10"]}
    ports = {"mail1.example.com": "connected"}
    result = classify_mx_health(records, ips, ports)
    assert result["mail1.example.com"] == "healthy"
    assert result["all_down"] is False


def test_refused_host_is_unreachable():
    records = [(10, "mail1.example.com")]
    ips = {"mail1.example.com": ["203.0.113.10"]}
    ports = {"mail1.example.com": "refused"}
    result = classify_mx_health(records, ips, ports)
    assert result["mail1.example.com"] == "unreachable"
    assert result["all_down"] is True


def test_timeout_host_is_unreachable():
    records = [(10, "mail1.example.com")]
    ips = {"mail1.example.com": ["203.0.113.10"]}
    ports = {"mail1.example.com": "timeout"}
    result = classify_mx_health(records, ips, ports)
    assert result["mail1.example.com"] == "unreachable"


def test_no_a_record_is_dangling():
    records = [(10, "mail1.example.com")]
    ips = {"mail1.example.com": []}
    ports = {"mail1.example.com": "no_dns"}
    result = classify_mx_health(records, ips, ports)
    assert result["mail1.example.com"] == "dangling"
    assert result["all_down"] is True


def test_one_dead_one_healthy_is_not_all_down():
    records = [(10, "mail1.example.com"), (20, "mail2.example.com")]
    ips = {"mail1.example.com": [], "mail2.example.com": ["203.0.113.20"]}
    ports = {"mail1.example.com": "no_dns", "mail2.example.com": "connected"}
    result = classify_mx_health(records, ips, ports)
    assert result["mail1.example.com"] == "dangling"
    assert result["mail2.example.com"] == "healthy"
    assert result["all_down"] is False


def test_both_dead_is_all_down():
    records = [(10, "mail1.example.com"), (20, "mail2.example.com")]
    ips = {"mail1.example.com": ["203.0.113.10"], "mail2.example.com": []}
    ports = {"mail1.example.com": "refused", "mail2.example.com": "no_dns"}
    result = classify_mx_health(records, ips, ports)
    assert result["all_down"] is True


def test_empty_records_is_all_down():
    result = classify_mx_health([], {}, {})
    assert result["all_down"] is True

from apex_cname_conflict import classify_apex_cname_conflict


def test_ok_when_no_cname_and_ns_soa_present():
    records = {"CNAME": [], "NS": ["ns1.example.com"], "SOA": ["soa data"], "A": ["203.0.113.10"]}
    assert classify_apex_cname_conflict(records) == "ok"


def test_conflict_when_cname_present_and_ns_soa_missing():
    records = {"CNAME": ["target.example.net"], "NS": [], "SOA": [], "A": []}
    assert classify_apex_cname_conflict(records) == "conflict_literal_cname"


def test_flattened_ok_when_cname_upstream_but_a_and_ns_soa_intact():
    records = {
        "CNAME": ["target.example.net"],
        "NS": ["ns1.example.com"],
        "SOA": ["soa data"],
        "A": ["203.0.113.10"],
    }
    assert classify_apex_cname_conflict(records) == "flattened_ok"


def test_conflict_when_cname_present_and_no_a_or_aaaa():
    records = {"CNAME": ["target.example.net"], "NS": ["ns1.example.com"], "SOA": ["soa data"], "A": []}
    assert classify_apex_cname_conflict(records) == "conflict_literal_cname"


def test_ok_when_no_cname_but_missing_ns():
    records = {"CNAME": [], "NS": [], "SOA": ["soa data"], "A": ["203.0.113.10"]}
    assert classify_apex_cname_conflict(records) == "conflict_literal_cname"


def test_flattened_ok_with_only_aaaa():
    records = {
        "CNAME": ["target.example.net"],
        "NS": ["ns1.example.com"],
        "SOA": ["soa data"],
        "A": [],
        "AAAA": ["2001:db8::10"],
    }
    assert classify_apex_cname_conflict(records) == "flattened_ok"

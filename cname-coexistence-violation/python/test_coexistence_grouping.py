from cname_coexistence import find_cname_coexistence_violations


def rec(name, type_, id_):
    return {"name": name, "type": type_, "id": id_}


def test_flags_cname_with_txt_at_same_name():
    records = [
        rec("app.example.com", "CNAME", "r1"),
        rec("app.example.com", "TXT", "r2"),
    ]
    violations = find_cname_coexistence_violations(records)
    assert len(violations) == 1
    assert violations[0]["name"] == "app.example.com"
    assert violations[0]["conflicting_ids"] == ["r2"]
    assert violations[0]["types"] == ["TXT"]


def test_flags_cname_with_multiple_other_types():
    records = [
        rec("sub.example.com", "CNAME", "r1"),
        rec("sub.example.com", "A", "r2"),
        rec("sub.example.com", "MX", "r3"),
    ]
    violations = find_cname_coexistence_violations(records)
    assert len(violations) == 1
    assert sorted(violations[0]["conflicting_ids"]) == ["r2", "r3"]
    assert sorted(violations[0]["types"]) == ["A", "MX"]


def test_clean_zone_has_no_violations():
    records = [
        rec("www.example.com", "CNAME", "r1"),
        rec("example.com", "A", "r2"),
        rec("example.com", "MX", "r3"),
    ]
    assert find_cname_coexistence_violations(records) == []


def test_name_matching_is_case_insensitive():
    records = [
        rec("App.Example.com", "CNAME", "r1"),
        rec("app.example.com", "A", "r2"),
    ]
    violations = find_cname_coexistence_violations(records)
    assert len(violations) == 1
    assert violations[0]["conflicting_ids"] == ["r2"]


def test_lone_cname_is_not_a_violation():
    records = [rec("sub.example.com", "CNAME", "r1")]
    assert find_cname_coexistence_violations(records) == []


def test_empty_records_returns_no_violations():
    assert find_cname_coexistence_violations([]) == []

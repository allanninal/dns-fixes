from mx_target_missing_address_record import find_dangling_mx_targets


def test_no_dangling_when_every_target_has_an_address():
    targets = ["mail.example.com"]
    resolved = {"mail.example.com": ["203.0.113.25"]}
    assert find_dangling_mx_targets(targets, resolved) == []


def test_flags_target_with_empty_address_list():
    targets = ["mail.example.com"]
    resolved = {"mail.example.com": []}
    assert find_dangling_mx_targets(targets, resolved) == ["mail.example.com"]


def test_flags_target_missing_from_the_mapping():
    targets = ["mail.example.com"]
    resolved = {}
    assert find_dangling_mx_targets(targets, resolved) == ["mail.example.com"]


def test_preserves_order_and_dedupes():
    targets = ["b.example.com", "a.example.com", "b.example.com"]
    resolved = {"a.example.com": [], "b.example.com": []}
    assert find_dangling_mx_targets(targets, resolved) == ["b.example.com", "a.example.com"]


def test_mixed_targets_only_flags_the_broken_one():
    targets = ["good.example.com", "bad.example.com"]
    resolved = {"good.example.com": ["203.0.113.1"], "bad.example.com": []}
    assert find_dangling_mx_targets(targets, resolved) == ["bad.example.com"]

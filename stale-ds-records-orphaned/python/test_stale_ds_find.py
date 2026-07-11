from stale_ds_records import find_stale_ds


def ds(**over):
    base = {"key_tag": 2371, "algorithm": 13, "digest_type": 2, "digest": "3a1b9f"}
    base.update(over)
    return base


def dnskey(**over):
    base = {"key_tag": 2371, "algorithm": 13, "flags": 257, "digest": "3a1b9f"}
    base.update(over)
    return base


def test_no_stale_when_ds_matches_dnskey():
    assert find_stale_ds([ds()], [dnskey()]) == []


def test_flags_ds_with_no_matching_dnskey():
    old_ds = ds(key_tag=55123, algorithm=8, digest="9c2e71")
    result = find_stale_ds([ds(), old_ds], [dnskey()])
    assert result == [old_ds]


def test_flags_all_when_no_dnskeys_present():
    old_ds = ds()
    assert find_stale_ds([old_ds], []) == [old_ds]


def test_case_insensitive_digest_comparison():
    upper_ds = ds(digest="3A1B9F")
    assert find_stale_ds([upper_ds], [dnskey()]) == []

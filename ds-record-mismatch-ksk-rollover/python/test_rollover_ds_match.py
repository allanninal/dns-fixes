from ds_ksk_mismatch import ds_matches_ksk


def ds(**over):
    base = {"key_tag": 5511, "algorithm": 13, "digest_type": 2, "digest": "f1e184c0"}
    base.update(over)
    return base


def test_matches_when_ds_equals_live_ksk_digest():
    assert ds_matches_ksk(ds(), ds()) is True


def test_mismatch_when_key_tag_differs():
    old_ds = ds(key_tag=4310, digest="9c2e71a5")
    assert ds_matches_ksk(old_ds, ds()) is False


def test_mismatch_when_digest_differs_same_key_tag():
    wrong_digest = ds(digest="deadbeef")
    assert ds_matches_ksk(wrong_digest, ds()) is False


def test_case_insensitive_digest_comparison():
    upper = ds(digest="F1E184C0")
    assert ds_matches_ksk(upper, ds()) is True


def test_false_when_published_ds_missing():
    assert ds_matches_ksk(None, ds()) is False


def test_false_when_no_live_ksk_found():
    assert ds_matches_ksk(ds(), None) is False

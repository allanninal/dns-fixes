from check_ds_pending import ds_state


def test_ok_when_digest_matches():
    assert ds_state("abc123", True, ["abc123", "def456"], 100.0) == "ok"


def test_not_signed_when_nothing_published_anywhere():
    assert ds_state(None, False, [], 100.0) == "not_signed"


def test_pending_ok_within_threshold():
    assert ds_state("abc123", True, ["def456"], 10.0) == "pending_ok"


def test_stuck_pending_beyond_threshold():
    assert ds_state("abc123", True, ["def456"], 72.0) == "stuck_pending"


def test_stuck_pending_when_parent_has_no_ds_at_all():
    assert ds_state("abc123", True, [], 72.0) == "stuck_pending"


def test_orphaned_ds_when_parent_has_ds_but_child_has_nothing():
    assert ds_state(None, False, ["abc123"], 72.0) == "orphaned_ds"


def test_custom_threshold_is_respected():
    assert ds_state("abc123", True, ["def456"], 30.0, pending_threshold_hours=24.0) == "stuck_pending"
    assert ds_state("abc123", True, ["def456"], 30.0, pending_threshold_hours=48.0) == "pending_ok"

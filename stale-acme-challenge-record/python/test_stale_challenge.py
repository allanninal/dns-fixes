from stale_acme_challenge_record import find_stale_challenge_records

NOW = 1_700_000_000


def record(id_, content, age_seconds):
    return {"id": id_, "content": content, "modified_on": NOW - age_seconds}


def test_no_stale_when_single_fresh_record_matches_token():
    records = [record("r1", "fresh-token", 30)]
    assert find_stale_challenge_records(records, "fresh-token", NOW) == []


def test_flags_record_older_than_timeout_regardless_of_content():
    records = [record("r1", "old-token", 7200)]
    assert find_stale_challenge_records(records, None, NOW, timeout_s=3600) == ["r1"]


def test_flags_mismatched_token_past_grace_period():
    records = [record("r1", "old-token", 600)]
    assert find_stale_challenge_records(records, "fresh-token", NOW) == ["r1"]


def test_does_not_flag_mismatched_token_within_grace_period():
    records = [record("r1", "old-token", 60)]
    assert find_stale_challenge_records(records, "fresh-token", NOW) == []


def test_mixed_set_flags_only_the_stale_one():
    records = [record("r1", "fresh-token", 30), record("r2", "old-token", 10800)]
    assert find_stale_challenge_records(records, "fresh-token", NOW) == ["r2"]


def test_no_current_token_only_uses_timeout():
    records = [record("r1", "anything", 300)]
    assert find_stale_challenge_records(records, None, NOW, timeout_s=3600) == []


def test_empty_records_returns_empty_list():
    assert find_stale_challenge_records([], "fresh-token", NOW) == []

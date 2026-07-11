from check_record_ownership import decide_action


def intended(**over):
    base = {"name": "app.example.com", "type": "A", "content": "203.0.113.10", "owner": "team-a"}
    base.update(over)
    return base


def test_create_when_no_live_record():
    assert decide_action(intended(), None, "team-a") == "create"


def test_noop_when_owned_and_matching():
    live = {"name": "app.example.com", "type": "A", "content": "203.0.113.10", "comment": "managed-by:team-a"}
    assert decide_action(intended(), live, "team-a") == "noop"


def test_update_when_owned_and_content_differs():
    live = {"name": "app.example.com", "type": "A", "content": "198.51.100.5", "comment": "managed-by:team-a"}
    assert decide_action(intended(), live, "team-a") == "update"


def test_skip_conflict_when_owner_differs():
    live = {"name": "app.example.com", "type": "A", "content": "198.51.100.5", "comment": "managed-by:team-b"}
    assert decide_action(intended(), live, "team-a") == "skip_conflict"


def test_skip_conflict_when_no_ownership_marker():
    live = {"name": "app.example.com", "type": "A", "content": "198.51.100.5", "comment": None}
    assert decide_action(intended(), live, "team-a") == "skip_conflict"


def test_skip_conflict_when_comment_missing_managed_by_prefix():
    live = {"name": "app.example.com", "type": "A", "content": "198.51.100.5", "comment": "hand added by ops"}
    assert decide_action(intended(), live, "team-a") == "skip_conflict"


def test_noop_ignores_owner_field_on_intended_record():
    live = {"name": "app.example.com", "type": "A", "content": "203.0.113.10", "comment": "managed-by:team-a"}
    assert decide_action(intended(owner="team-z"), live, "team-a") == "noop"

from cname_to_a import plan_rrset_change


def desired(**over):
    base = {"name": "app.example.com", "type": "A", "content": "203.0.113.10", "ttl": 300}
    base.update(over)
    return base


def test_noop_when_already_matching():
    live = [{"id": "rec_1", "type": "A", "content": "203.0.113.10"}]
    assert plan_rrset_change(live, desired()) == {"action": "noop"}


def test_overwrite_when_one_conflicting_cname():
    live = [{"id": "rec_9", "type": "CNAME", "content": "old-target.example.net"}]
    assert plan_rrset_change(live, desired()) == {"action": "overwrite", "record_id": "rec_9"}


def test_create_when_nothing_exists():
    assert plan_rrset_change([], desired()) == {"action": "create"}


def test_noop_when_multiple_conflicting_records():
    live = [
        {"id": "rec_1", "type": "TXT", "content": "v=spf1 -all"},
        {"id": "rec_2", "type": "MX", "content": "mail.example.com"},
    ]
    assert plan_rrset_change(live, desired())["action"] == "noop"


def test_overwrite_ignores_content_of_conflicting_type():
    live = [{"id": "rec_5", "type": "CNAME", "content": "anything.example.net"}]
    plan = plan_rrset_change(live, desired(content="198.51.100.20"))
    assert plan == {"action": "overwrite", "record_id": "rec_5"}


def test_empty_live_records_returns_create():
    assert plan_rrset_change([], desired(type="A", content="203.0.113.10")) == {"action": "create"}

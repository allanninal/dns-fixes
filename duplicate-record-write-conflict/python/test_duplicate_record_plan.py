from duplicate_record_write_conflict import plan_dns_write


def desired(**over):
    base = {"name": "app.example.com", "type": "A", "content": "203.0.113.10",
            "ttl": 300, "proxied": False}
    base.update(over)
    return base


def existing(**over):
    base = {"id": "rec_1", "name": "app.example.com", "type": "A",
            "content": "203.0.113.10", "ttl": 300, "proxied": False}
    base.update(over)
    return base


def test_creates_when_nothing_exists():
    plan = plan_dns_write([], desired())
    assert plan["action"] == "create"
    assert plan["body"] == desired()


def test_noop_when_existing_matches_desired():
    plan = plan_dns_write([existing()], desired())
    assert plan == {"action": "noop", "id": "rec_1"}


def test_update_when_content_differs():
    plan = plan_dns_write([existing(content="203.0.113.99")], desired())
    assert plan["action"] == "update"
    assert plan["id"] == "rec_1"
    assert plan["body"] == {"content": "203.0.113.10"}


def test_update_only_sends_changed_fields():
    plan = plan_dns_write([existing(ttl=60)], desired())
    assert plan["body"] == {"ttl": 300}


def test_update_when_proxied_differs():
    plan = plan_dns_write([existing(proxied=True)], desired())
    assert plan["action"] == "update"
    assert plan["body"] == {"proxied": False}


def test_cname_conflict_modeled_as_existing_record_of_different_type():
    # A CNAME-vs-A conflict is modeled as an existing record at the same
    # name but a different type. plan_dns_write only inspects the first
    # existing record; the caller decides which record wins.
    cname_existing = [{
        "id": "rec_cname", "name": "app.example.com", "type": "CNAME",
        "content": "app.hosting-provider.net", "ttl": 300, "proxied": False,
    }]
    plan = plan_dns_write(cname_existing, desired())
    assert plan["action"] == "update"
    assert plan["id"] == "rec_cname"

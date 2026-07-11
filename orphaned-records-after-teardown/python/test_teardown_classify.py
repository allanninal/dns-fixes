from orphaned_records import classify_record, UNCLAIMED_FINGERPRINTS


def rec(name, type_, content):
    return {"name": name, "type": type_, "content": content}


def test_active_when_target_in_live_inventory():
    record = rec("app.example.com", "CNAME", "app.herokuapp.com")
    live_inventory = {"app.herokuapp.com"}
    assert classify_record(record, live_inventory, UNCLAIMED_FINGERPRINTS) == "active"


def test_orphaned_when_target_matches_known_suffix_and_not_live():
    record = rec("old-app.example.com", "CNAME", "old-app.herokuapp.com")
    live_inventory = {"app-v2.herokuapp.com"}
    assert classify_record(record, live_inventory, UNCLAIMED_FINGERPRINTS) == "orphaned"


def test_needs_manual_review_for_unknown_target():
    record = rec("mystery.example.com", "CNAME", "mystery.internal-tool.com")
    live_inventory = set()
    assert classify_record(record, live_inventory, UNCLAIMED_FINGERPRINTS) == "needs_manual_review"


def test_trailing_dot_and_case_are_normalized():
    record = rec("app.example.com", "CNAME", "App.Herokuapp.com.")
    live_inventory = {"app.herokuapp.com"}
    assert classify_record(record, live_inventory, UNCLAIMED_FINGERPRINTS) == "active"


def test_s3_bucket_orphaned_when_not_in_inventory():
    record = rec("assets.example.com", "CNAME", "old-bucket.s3-website-us-east-1.amazonaws.com")
    live_inventory = {"new-bucket.s3-website-us-east-1.amazonaws.com"}
    assert classify_record(record, live_inventory, UNCLAIMED_FINGERPRINTS) == "orphaned"

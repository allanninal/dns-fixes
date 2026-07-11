from false_positive_duplicate_detection import is_duplicate_record


def rec(name="acme.example.com", type_="A", set_identifier=None, content="192.0.2.10"):
    return {"name": name, "type": type_, "set_identifier": set_identifier, "content": content}


def test_weighted_records_with_different_set_identifier_are_not_duplicates():
    existing = rec(set_identifier="us-east-primary", content="192.0.2.10")
    candidate = rec(set_identifier="us-east-secondary", content="192.0.2.11")
    assert is_duplicate_record(existing, candidate) is False


def test_same_set_identifier_is_a_true_duplicate():
    existing = rec(set_identifier="us-east-primary", content="192.0.2.10")
    candidate = rec(set_identifier="us-east-primary", content="192.0.2.10")
    assert is_duplicate_record(existing, candidate) is True


def test_no_set_identifier_falls_back_to_content_cloudflare_style():
    existing = rec(set_identifier=None, content="192.0.2.10")
    candidate = rec(set_identifier=None, content="192.0.2.11")
    assert is_duplicate_record(existing, candidate) is False


def test_no_set_identifier_same_content_is_a_true_duplicate():
    existing = rec(set_identifier=None, content="192.0.2.10")
    candidate = rec(set_identifier=None, content="192.0.2.10")
    assert is_duplicate_record(existing, candidate) is True


def test_different_name_is_never_a_duplicate():
    existing = rec(name="acme.example.com")
    candidate = rec(name="other.example.com")
    assert is_duplicate_record(existing, candidate) is False


def test_trailing_dot_and_case_are_normalized():
    existing = rec(name="Acme.Example.com.")
    candidate = rec(name="acme.example.com")
    assert is_duplicate_record(existing, candidate) is True

from duplicate_spf_records import merge_spf_records


def test_empty_list_returns_none():
    assert merge_spf_records([]) is None


def test_single_record_returned_unchanged():
    record = "v=spf1 include:_spf.google.com ~all"
    assert merge_spf_records([record]) == record


def test_two_different_includes_are_merged():
    records = [
        "v=spf1 include:_spf.google.com ~all",
        "v=spf1 include:sendgrid.net -all",
    ]
    result = merge_spf_records(records)
    assert result.startswith("v=spf1 ")
    assert "include:_spf.google.com" in result
    assert "include:sendgrid.net" in result
    assert result.endswith("-all")


def test_overlapping_includes_are_deduplicated():
    records = [
        "v=spf1 include:_spf.google.com ~all",
        "v=spf1 include:_spf.google.com include:sendgrid.net -all",
    ]
    result = merge_spf_records(records)
    assert result.count("include:_spf.google.com") == 1
    assert "include:sendgrid.net" in result


def test_prefers_stricter_all_qualifier():
    records = [
        "v=spf1 include:_spf.google.com ~all",
        "v=spf1 include:sendgrid.net -all",
    ]
    assert merge_spf_records(records).endswith("-all")
    assert not merge_spf_records(records).endswith("~all")

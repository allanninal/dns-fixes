from spf_all_mechanism import check_spf_all_mechanism, rebuild_spf_record


def test_ok_when_single_all_last():
    record = "v=spf1 include:_spf.google.com include:sendgrid.net -all"
    result = check_spf_all_mechanism(record)
    assert result["ok"] is True
    assert result["all_count"] == 1
    assert result["all_position_ok"] is True
    assert result["issue"] is None
    assert result["unreachable_tokens"] == []


def test_duplicate_all_flagged():
    record = "v=spf1 include:_spf.google.com ~all include:sendgrid.net -all"
    result = check_spf_all_mechanism(record)
    assert result["ok"] is False
    assert result["all_count"] == 2
    assert result["issue"] == "duplicate_all"
    assert result["unreachable_tokens"] == ["include:sendgrid.net", "-all"]


def test_all_not_last_flagged():
    record = "v=spf1 all include:_spf.google.com -all"
    result = check_spf_all_mechanism(record)
    assert result["ok"] is False
    assert result["all_count"] == 2
    assert result["all_position_ok"] is False
    assert result["issue"] == "duplicate_all"


def test_two_all_tokens_anywhere():
    record = "v=spf1 a mx -all ~all"
    result = check_spf_all_mechanism(record)
    assert result["all_count"] == 2
    assert result["issue"] == "duplicate_all"


def test_no_all_token_flagged():
    record = "v=spf1 include:_spf.google.com"
    result = check_spf_all_mechanism(record)
    assert result["ok"] is False
    assert result["all_count"] == 0
    assert result["issue"] == "all_not_last"


def test_conflicting_qualifiers_plus_all_first_is_dangerous():
    record = "v=spf1 include:_spf.google.com +all -all"
    result = check_spf_all_mechanism(record)
    assert result["all_count"] == 2
    assert result["issue"] == "duplicate_all"
    assert result["unreachable_tokens"] == ["-all"]


def test_rebuild_spf_record_moves_all_to_end():
    record = "v=spf1 include:_spf.google.com ~all include:sendgrid.net -all"
    corrected = rebuild_spf_record(record, qualifier="-")
    assert corrected == "v=spf1 include:_spf.google.com include:sendgrid.net -all"
    result = check_spf_all_mechanism(corrected)
    assert result["ok"] is True


def test_rebuild_spf_record_handles_missing_version_prefix():
    record = "include:_spf.google.com -all"
    corrected = rebuild_spf_record(record, qualifier="~")
    assert corrected == "v=spf1 include:_spf.google.com ~all"

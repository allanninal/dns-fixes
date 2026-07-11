from missing_address_record import classify_missing_record


def test_missing_record_nxdomain():
    assert classify_missing_record("NXDOMAIN", 0, True) == "missing_record_nxdomain"


def test_nodata_wrong_type():
    assert classify_missing_record("NOERROR", 0, True) == "nodata_wrong_type"


def test_nodata_wrong_type_even_when_not_expected():
    assert classify_missing_record("NOERROR", 0, False) == "nodata_wrong_type"


def test_ok_when_answers_present():
    assert classify_missing_record("NOERROR", 1, True) == "ok"


def test_ok_when_answers_present_on_nxdomain_rcode():
    # answer_count > 0 always wins, even if the rcode string looks odd.
    assert classify_missing_record("NXDOMAIN", 1, True) == "ok"


def test_nxdomain_not_expected_is_unexpected():
    assert classify_missing_record("NXDOMAIN", 0, False) == "unexpected"

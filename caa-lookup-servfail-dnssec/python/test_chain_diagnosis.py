from caa_lookup_servfail_dnssec import diagnose_caa_dnssec_break


def test_ok_when_no_servfail():
    result = diagnose_caa_dnssec_break(False, True, True, False)
    assert result == "ok"


def test_not_dnssec_related_when_cd_also_fails():
    result = diagnose_caa_dnssec_break(True, False, True, False)
    assert result == "not_dnssec_related"


def test_ds_mismatch_when_digests_disagree():
    result = diagnose_caa_dnssec_break(True, True, False, False)
    assert result == "broken_dnssec_chain_ds_mismatch"


def test_expired_rrsig_takes_priority():
    result = diagnose_caa_dnssec_break(True, True, True, True)
    assert result == "broken_dnssec_chain_expired_rrsig"


def test_expired_rrsig_even_if_ds_also_mismatches():
    result = diagnose_caa_dnssec_break(True, True, False, True)
    assert result == "broken_dnssec_chain_expired_rrsig"


def test_ds_matches_and_no_expiry_still_flags_break():
    result = diagnose_caa_dnssec_break(True, True, True, False)
    assert result == "broken_dnssec_chain_ds_mismatch"

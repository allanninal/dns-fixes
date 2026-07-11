from check_split_answers import diff_nameserver_answers


def test_agreement_returns_empty():
    ns_records = {
        "lena.ns.cloudflare.com": {"A": ["198.51.100.9"], "TXT": ["v=spf1 ~all"]},
        "walt.ns.cloudflare.com": {"A": ["198.51.100.9"], "TXT": ["v=spf1 ~all"]},
    }
    assert diff_nameserver_answers(ns_records) == {}


def test_flags_the_stale_nameserver():
    ns_records = {
        "ns1.oldhost.com": {"A": ["203.0.113.5"], "TXT": ["v=spf1 ~all"]},
        "lena.ns.cloudflare.com": {"A": ["198.51.100.9"], "TXT": ["v=spf1 ~all"]},
        "walt.ns.cloudflare.com": {"A": ["198.51.100.9"], "TXT": ["v=spf1 ~all"]},
    }
    result = diff_nameserver_answers(ns_records)
    assert result["A"] == ["ns1.oldhost.com"]
    assert "TXT" not in result


def test_missing_record_counts_as_a_mismatch():
    ns_records = {
        "ns1.oldhost.com": {"TXT": []},
        "lena.ns.cloudflare.com": {"TXT": ["v=spf1 include:_spf.google.com ~all"]},
        "walt.ns.cloudflare.com": {"TXT": ["v=spf1 include:_spf.google.com ~all"]},
    }
    result = diff_nameserver_answers(ns_records)
    assert result["TXT"] == ["ns1.oldhost.com"]


def test_single_nameserver_has_nothing_to_compare():
    ns_records = {"lena.ns.cloudflare.com": {"A": ["198.51.100.9"]}}
    assert diff_nameserver_answers(ns_records) == {}


def test_all_disagree_picks_a_majority_by_count():
    ns_records = {
        "a.ns.com": {"A": ["1.1.1.1"]},
        "b.ns.com": {"A": ["1.1.1.1"]},
        "c.ns.com": {"A": ["2.2.2.2"]},
    }
    result = diff_nameserver_answers(ns_records)
    assert result["A"] == ["c.ns.com"]

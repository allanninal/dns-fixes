from spf_exceeds_lookup_limit import count_spf_lookups


def make_resolver(table):
    def resolver(kind, name):
        return table.get(name, [])
    return resolver


def test_no_lookups_when_only_ip4():
    record = "v=spf1 ip4:203.0.113.0/24 -all"
    total, warnings = count_spf_lookups(record, make_resolver({}))
    assert total == 0
    assert warnings == []


def test_single_include_with_no_nesting():
    record = "v=spf1 include:sendgrid.net ~all"
    table = {"sendgrid.net": ["v=spf1 ip4:198.51.100.0/24 ~all"]}
    total, _ = count_spf_lookups(record, make_resolver(table))
    assert total == 1


def test_nested_includes_are_counted_recursively():
    record = "v=spf1 include:_spf.google.com ~all"
    table = {
        "_spf.google.com": ["v=spf1 include:_netblocks.google.com include:_netblocks2.google.com ~all"],
        "_netblocks.google.com": ["v=spf1 ip4:35.190.247.0/24 ~all"],
        "_netblocks2.google.com": ["v=spf1 ip4:64.233.160.0/19 ~all"],
    }
    total, _ = count_spf_lookups(record, make_resolver(table))
    assert total == 3


def test_exceeding_ten_produces_a_warning():
    record = "v=spf1 " + " ".join(f"include:v{i}.example.com" for i in range(11)) + " ~all"
    table = {f"v{i}.example.com": ["v=spf1 ip4:203.0.113.{}/32 -all".format(i)] for i in range(11)}
    total, warnings = count_spf_lookups(record, make_resolver(table))
    assert total == 11
    assert any("exceeds 10-lookup limit (11 found)" in w for w in warnings)


def test_void_lookup_is_reported():
    record = "v=spf1 include:missing.example.com ~all"
    total, warnings = count_spf_lookups(record, make_resolver({}))
    assert total == 1
    assert any("void lookup" in w for w in warnings)


def test_redirect_modifier_counts_and_recurses():
    record = "v=spf1 redirect=relay.example.com"
    table = {"relay.example.com": ["v=spf1 ip4:203.0.113.9/32 -all"]}
    total, _ = count_spf_lookups(record, make_resolver(table))
    assert total == 1

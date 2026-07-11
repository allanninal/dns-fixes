from leftover_mx_records_after_migration import find_leftover_mx


def test_no_leftovers_when_all_records_match():
    live_mx = [(1, "smtp.google.com.")]
    assert find_leftover_mx(live_mx, ["google.com."]) == []


def test_flags_old_provider_records():
    live_mx = [
        (1, "smtp.google.com."),
        (10, "mx1.oldprovider.net."),
        (20, "mx2.oldprovider.net."),
    ]
    leftovers = find_leftover_mx(live_mx, ["google.com."])
    assert leftovers == [(10, "mx1.oldprovider.net."), (20, "mx2.oldprovider.net.")]


def test_matches_are_case_insensitive_and_dot_normalized():
    live_mx = [(1, "SMTP.GOOGLE.COM")]
    assert find_leftover_mx(live_mx, ["google.com."]) == []


def test_legacy_google_hosts_all_match_suffix():
    live_mx = [
        (1, "ASPMX.L.GOOGLE.COM."),
        (5, "ALT1.ASPMX.L.GOOGLE.COM."),
        (10, "ALT3.ASPMX.L.GOOGLE.COM."),
    ]
    assert find_leftover_mx(live_mx, ["google.com."]) == []


def test_microsoft_365_suffix_flags_unrelated_host():
    live_mx = [
        (0, "example-com.mail.protection.outlook.com."),
        (10, "mx1.oldprovider.net."),
    ]
    leftovers = find_leftover_mx(live_mx, ["mail.protection.outlook.com."])
    assert leftovers == [(10, "mx1.oldprovider.net.")]


def test_empty_live_mx_returns_empty_list():
    assert find_leftover_mx([], ["google.com."]) == []

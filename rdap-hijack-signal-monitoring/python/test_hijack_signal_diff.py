from check_rdap_hijack_signal import diff_rdap_snapshot


def snapshot(**over):
    base = {
        "status": ["clientTransferProhibited", "clientUpdateProhibited"],
        "nameservers": ["ns1.cf.com", "ns2.cf.com"],
        "registrant_handle": "REG-1",
        "registrar_handle": "REGR-1",
        "last_changed": "2026-01-01T00:00:00Z",
    }
    base.update(over)
    return base


def test_no_alerts_when_nothing_changed():
    baseline = snapshot()
    current = snapshot()
    assert diff_rdap_snapshot(baseline, current) == []


def test_alerts_when_transfer_lock_lost():
    baseline = snapshot()
    current = snapshot(status=["clientUpdateProhibited"])
    alerts = diff_rdap_snapshot(baseline, current)
    assert "status lost clientTransferProhibited" in alerts


def test_alerts_when_nameservers_change():
    baseline = snapshot()
    current = snapshot(nameservers=["ns1.evil.net"])
    alerts = diff_rdap_snapshot(baseline, current)
    assert any("nameservers changed" in a for a in alerts)


def test_alerts_when_registrant_handle_changes():
    baseline = snapshot()
    current = snapshot(registrant_handle="REG-2")
    assert "registrant_handle changed" in diff_rdap_snapshot(baseline, current)


def test_alerts_when_registrar_handle_changes():
    baseline = snapshot()
    current = snapshot(registrar_handle="REGR-2")
    assert "registrar_handle changed" in diff_rdap_snapshot(baseline, current)


def test_alerts_when_last_changed_moves():
    baseline = snapshot()
    current = snapshot(last_changed="2026-06-01T00:00:00Z")
    alerts = diff_rdap_snapshot(baseline, current)
    assert any("last_changed event moved" in a for a in alerts)


def test_nameserver_order_does_not_trigger_a_false_alert():
    baseline = snapshot(nameservers=["ns1.cf.com", "ns2.cf.com"])
    current = snapshot(nameservers=["ns2.cf.com", "ns1.cf.com"])
    assert diff_rdap_snapshot(baseline, current) == []


def test_multiple_changes_all_reported():
    baseline = snapshot()
    current = snapshot(status=[], nameservers=["ns1.evil.net"], registrant_handle="REG-2")
    alerts = diff_rdap_snapshot(baseline, current)
    assert len(alerts) >= 3

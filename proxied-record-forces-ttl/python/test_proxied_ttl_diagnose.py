from proxied_record_forces_ttl import diagnose_ttl_proxy_mismatch


def test_consistent_proxied_record_returns_none():
    intended = {"ttl": 1, "proxied": True}
    live = {"ttl": 1, "proxied": True}
    assert diagnose_ttl_proxy_mismatch(intended, live) is None


def test_consistent_unproxied_custom_ttl_returns_none():
    intended = {"ttl": 300, "proxied": False}
    live = {"ttl": 300, "proxied": False}
    assert diagnose_ttl_proxy_mismatch(intended, live) is None


def test_invalid_config_ttl_300_with_proxied_true():
    intended = {"ttl": 300, "proxied": True}
    live = {"ttl": 1, "proxied": True}
    reason = diagnose_ttl_proxy_mismatch(intended, live)
    assert reason is not None
    assert "invalid config" in reason


def test_impossible_state_live_proxied_but_ttl_not_one():
    intended = {"ttl": 1, "proxied": True}
    live = {"ttl": 300, "proxied": True}
    reason = diagnose_ttl_proxy_mismatch(intended, live)
    assert reason is not None
    assert "impossible state" in reason


def test_proxy_status_drifted():
    intended = {"ttl": 1, "proxied": True}
    live = {"ttl": 300, "proxied": False}
    reason = diagnose_ttl_proxy_mismatch(intended, live)
    assert reason is not None
    assert "proxy status drifted" in reason


def test_real_ttl_drift_on_unproxied_record():
    intended = {"ttl": 600, "proxied": False}
    live = {"ttl": 300, "proxied": False}
    reason = diagnose_ttl_proxy_mismatch(intended, live)
    assert reason is not None
    assert "real ttl drift" in reason


def test_intended_ttl_none_with_proxied_true_is_ok():
    intended = {"ttl": None, "proxied": True}
    live = {"ttl": 1, "proxied": True}
    assert diagnose_ttl_proxy_mismatch(intended, live) is None

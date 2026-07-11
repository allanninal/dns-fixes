from dangling_cname_chain import find_dangling_hop


def hop(hostname, status, target=None, is_cname=True):
    return {"hostname": hostname, "is_cname": is_cname, "target": target, "resolved_status": status}


def test_clean_chain_returns_none():
    chain = [
        hop("app.example.com", "OK", "cdn-edge.vendorone.net"),
        hop("cdn-edge.vendorone.net", "OK", "lb-shared.vendortwo.io"),
        hop("lb-shared.vendortwo.io", "OK", None, is_cname=False),
    ]
    assert find_dangling_hop(chain) is None


def test_flags_intermediate_hop_not_just_first():
    chain = [
        hop("app.example.com", "OK", "cdn-edge.vendorone.net"),
        hop("cdn-edge.vendorone.net", "OK", "lb-shared.vendortwo.io"),
        hop("lb-shared.vendortwo.io", "NXDOMAIN", None, is_cname=False),
    ]
    result = find_dangling_hop(chain)
    assert result["hostname"] == "lb-shared.vendortwo.io"


def test_flags_servfail_hop():
    chain = [
        hop("app.example.com", "OK", "cdn-edge.vendorone.net"),
        hop("cdn-edge.vendorone.net", "SERVFAIL", None, is_cname=False),
    ]
    result = find_dangling_hop(chain)
    assert result["hostname"] == "cdn-edge.vendorone.net"


def test_flags_first_hop_too_if_that_is_where_it_breaks():
    chain = [
        hop("app.example.com", "NXDOMAIN", None, is_cname=False),
    ]
    result = find_dangling_hop(chain)
    assert result["hostname"] == "app.example.com"


def test_chain_too_long_flags_possible_loop():
    chain = [hop(f"hop{i}.example.com", "OK", f"hop{i + 1}.example.com") for i in range(12)]
    result = find_dangling_hop(chain, max_depth=10)
    assert result["reason"] == "chain-too-long"


def test_terminal_a_record_after_several_hops_is_clean():
    chain = [
        hop("a.example.com", "OK", "b.example.com"),
        hop("b.example.com", "OK", "c.example.com"),
        hop("c.example.com", "OK", "d.example.com"),
        hop("d.example.com", "OK", None, is_cname=False),
    ]
    assert find_dangling_hop(chain) is None

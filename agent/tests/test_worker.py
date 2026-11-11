def test_a_busy_mac_never_makes_the_worker_refuse_a_call() -> None:
    from agent import never_full, server

    # LiveKit's own load function measures the whole Mac's CPU, and outside dev mode the
    # worker reports itself full above 0.7 of it: a call started then is never dispatched.
    assert server.load_fnc is never_full
    assert never_full() == 0

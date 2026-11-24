import io
import json
import threading
import unittest
import urllib.error

from button_logic import Outcome, TriggerController, call_trigger


class FakeResponse:
    def __init__(self, body, status=200):
        self._body = body if isinstance(body, bytes) else body.encode()
        self.status = status

    def read(self):
        return self._body

    def getcode(self):
        return self.status

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def opener_returning(payload, status=200):
    body = payload if isinstance(payload, (str, bytes)) else json.dumps(payload)
    return lambda req, timeout=None: FakeResponse(body, status)


def opener_raising(exc):
    def opener(req, timeout=None):
        raise exc

    return opener


class CallTriggerTest(unittest.TestCase):
    def call(self, opener):
        return call_trigger("http://x/api/summary-trigger/t", "s3cret", opener=opener)

    def test_success_response_maps_to_success(self):
        self.assertEqual(self.call(opener_returning({"ok": True, "empty": False})), Outcome.SUCCESS)

    def test_empty_response_maps_to_empty(self):
        self.assertEqual(self.call(opener_returning({"ok": True, "empty": True})), Outcome.EMPTY)

    def test_ok_false_maps_to_error(self):
        self.assertEqual(self.call(opener_returning({"ok": False, "empty": False})), Outcome.ERROR)

    def test_broken_json_maps_to_error(self):
        self.assertEqual(self.call(opener_returning("<html>")), Outcome.ERROR)

    def test_non_200_status_maps_to_error(self):
        self.assertEqual(self.call(opener_returning({"ok": True}, status=204)), Outcome.ERROR)

    def _http_error(self, code):
        return urllib.error.HTTPError("http://x", code, "err", {}, io.BytesIO(b"{}"))

    def test_http_error_401_maps_to_error(self):
        self.assertEqual(self.call(opener_raising(self._http_error(401))), Outcome.ERROR)

    def test_http_error_409_maps_to_error(self):
        self.assertEqual(self.call(opener_raising(self._http_error(409))), Outcome.ERROR)

    def test_connection_refused_maps_to_error(self):
        exc = urllib.error.URLError(ConnectionRefusedError(111, "refused"))
        self.assertEqual(self.call(opener_raising(exc)), Outcome.ERROR)

    def test_timeout_maps_to_error(self):
        self.assertEqual(self.call(opener_raising(TimeoutError("timed out"))), Outcome.ERROR)

    def test_request_has_no_body_and_no_content_type_and_bearer_header(self):
        seen = {}

        def opener(req, timeout=None):
            seen["req"] = req
            seen["timeout"] = timeout
            return FakeResponse('{"ok":true,"empty":false}')

        call_trigger("http://x/api/summary-trigger/t", "s3cret", opener=opener)
        req = seen["req"]
        self.assertIsNone(req.data)
        self.assertIsNone(req.get_header("Content-type"))
        self.assertEqual(req.get_header("Authorization"), "Bearer s3cret")
        self.assertEqual(req.get_method(), "POST")
        self.assertEqual(seen["timeout"], 60)


class FakeLed:
    def __init__(self):
        self.calls = []

    def blink(self, on_time, off_time, n=None, background=True):
        self.calls.append(("blink", on_time, off_time, n))

    def on(self):
        self.calls.append(("on",))

    def off(self):
        self.calls.append(("off",))


class ControllerTest(unittest.TestCase):
    def make(self, trigger):
        led = FakeLed()
        sleeps = []
        logs = []
        c = TriggerController(trigger, led, logs.append, sleep=sleeps.append)
        return c, led, sleeps, logs

    def test_press_while_running_is_ignored(self):
        release = threading.Event()
        started = threading.Event()
        count = []

        def trigger():
            count.append(1)
            started.set()
            release.wait(5)
            return Outcome.SUCCESS

        c, led, sleeps, logs = self.make(trigger)
        t = threading.Thread(target=c.on_press)
        t.start()
        self.assertTrue(started.wait(5))
        t2 = threading.Thread(target=c.on_press)
        t2.start()
        t2.join(1)
        self.assertFalse(t2.is_alive())
        release.set()
        t.join(5)
        self.assertEqual(len(count), 1)

    def test_led_patterns_per_outcome(self):
        c, led, sleeps, _ = self.make(lambda: Outcome.SUCCESS)
        c.on_press()
        self.assertEqual(led.calls[0], ("blink", 0.15, 0.15, 3))
        self.assertIn(("blink", 0.5, 0.5, None), led.calls)
        self.assertEqual(led.calls[-2:], [("on",), ("off",)])
        self.assertEqual(sleeps, [5])

        c, led, sleeps, _ = self.make(lambda: Outcome.EMPTY)
        c.on_press()
        self.assertEqual(led.calls[-1], ("blink", 1, 0.5, 2))
        self.assertEqual(sleeps, [])

        c, led, sleeps, _ = self.make(lambda: Outcome.ERROR)
        c.on_press()
        self.assertEqual(led.calls[-2:], [("blink", 0.1, 0.1, None), ("off",)])
        self.assertEqual(sleeps, [10])

    def test_next_press_works_after_error(self):
        results = iter([Outcome.ERROR, Outcome.SUCCESS])
        c, led, sleeps, _ = self.make(lambda: next(results))
        c.on_press()
        c.on_press()
        self.assertEqual(led.calls[-2:], [("on",), ("off",)])

    def test_trigger_exception_is_error_and_does_not_crash(self):
        def boom():
            raise RuntimeError("x")

        c, led, sleeps, _ = self.make(boom)
        c.on_press()
        self.assertEqual(sleeps, [10])
        c.on_press()  # flag released

    def test_new_press_during_hold_is_not_switched_off_by_old_hold(self):
        holder = {}

        def sleep(_):
            holder["c"].on_press()  # press arrives during the hold

        results = iter([Outcome.ERROR, Outcome.EMPTY])
        led = FakeLed()
        c = TriggerController(lambda: next(results), led, lambda m: None, sleep=sleep)
        holder["c"] = c
        c.on_press()
        self.assertNotEqual(led.calls[-1], ("off",))


if __name__ == "__main__":
    unittest.main()

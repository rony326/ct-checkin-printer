"""Reine Logik des Tasten-Dienstes (ohne gpiozero, damit sie ohne Hardware testbar ist)."""

import json
import threading
import time
import urllib.error
import urllib.request
from enum import Enum
from typing import Callable, Optional, Protocol


class Outcome(Enum):
    SUCCESS = "success"
    EMPTY = "empty"
    ERROR = "error"


class LedLike(Protocol):
    def blink(self, on_time, off_time, n=None, background=True): ...

    def on(self): ...

    def off(self): ...


def call_trigger(url: str, secret: str, timeout: float = 60, opener=urllib.request.urlopen) -> Outcome:
    """Löst den Sammelausdruck aus. Wirft nie.

    Absichtlich kein Body und kein Content-Type: der Server lehnt einen leeren
    Body mit Content-Type ab (415/400).
    """
    try:
        req = urllib.request.Request(url, data=None, method="POST")
        req.add_header("Authorization", f"Bearer {secret}")
        with opener(req, timeout=timeout) as resp:
            status = resp.getcode() if hasattr(resp, "getcode") else getattr(resp, "status", 200)
            if status != 200:
                return Outcome.ERROR
            data = json.loads(resp.read())
        if not isinstance(data, dict) or data.get("ok") is not True:
            return Outcome.ERROR
        return Outcome.EMPTY if data.get("empty") else Outcome.SUCCESS
    except Exception:  # HTTPError, URLError (Verbindung abgelehnt), Timeout, kaputtes JSON ...
        return Outcome.ERROR


def show_ready(led: LedLike) -> None:
    """Dienst gestartet: 3x kurz blinken (bereit)."""
    led.blink(0.15, 0.15, n=3)


class TriggerController:
    SUCCESS_HOLD = 5
    ERROR_HOLD = 10

    def __init__(
        self,
        trigger: Callable[[], Outcome],
        led: LedLike,
        log: Callable[[str], None],
        sleep: Callable[[float], None] = time.sleep,
    ):
        self._trigger = trigger
        self._led = led
        self._log = log
        self._sleep = sleep
        self._lock = threading.Lock()
        self._running = False
        self._generation = 0

    def on_press(self) -> None:
        with self._lock:
            if self._running:
                self._log("Druck ignoriert: Sammelausdruck läuft noch")
                return
            self._running = True
            self._generation += 1
            gen = self._generation

        hold = 0
        try:
            self._log("Taster gedrückt: löse Sammelausdruck aus")
            self._led.blink(0.5, 0.5)
            try:
                outcome = self._trigger()
            except Exception as exc:
                self._log(f"Unerwarteter Fehler beim Auslösen: {type(exc).__name__}")
                outcome = Outcome.ERROR

            if outcome is Outcome.SUCCESS:
                self._log("Sammelausdruck erfolgreich")
                self._led.on()
                hold = self.SUCCESS_HOLD
            elif outcome is Outcome.EMPTY:
                self._log("Sammelausdruck: keine Einträge zum Drucken")
                self._led.blink(1, 0.5, n=2)
            else:
                self._log("Sammelausdruck fehlgeschlagen")
                self._led.blink(0.1, 0.1)
                hold = self.ERROR_HOLD
        finally:
            # Sperre vor dem Halten lösen: ein erneuter Druck soll sofort möglich sein.
            with self._lock:
                self._running = False

        if hold:
            self._sleep(hold)
            with self._lock:
                # Nur ausschalten, wenn inzwischen kein neuer Druck das Muster übernommen hat.
                if self._generation == gen and not self._running:
                    self._led.off()

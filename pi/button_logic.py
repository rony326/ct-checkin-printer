"""Reine Logik des Tasten-Dienstes (ohne gpiozero, damit sie ohne Hardware testbar ist)."""

import json
import threading
import time
import urllib.error
import urllib.request
from enum import Enum
from typing import Callable, Protocol, Tuple


class Outcome(Enum):
    SUCCESS = "success"
    EMPTY = "empty"
    ERROR = "error"


class LedLike(Protocol):
    def blink(self, on_time, off_time, n=None, background=True): ...

    def on(self): ...

    def off(self): ...


def _is_timeout(exc: BaseException) -> bool:
    return isinstance(exc, TimeoutError) or isinstance(getattr(exc, "reason", None), TimeoutError)


def _clean(text: str, *hidden: str) -> str:
    """Grund für das Journal: nie Secret oder URL (enthält den Token) enthalten."""
    for value in hidden:
        if value:
            text = text.replace(value, "***")
    return text


def call_trigger(
    url: str, secret: str, timeout: float = 60, opener=urllib.request.urlopen
) -> Tuple[Outcome, str]:
    """Löst den Sammelausdruck aus. Wirft nie. Gibt (Ergebnis, Grund) zurück.

    Der Grund ist bei Fehlern kurz und ohne Secret/URL (`HTTP 401`, `nicht erreichbar: ...`,
    `Timeout` oder die Meldung des Servers), sonst leer.

    Absichtlich kein Body und kein Content-Type: der Server lehnt einen leeren
    Body mit Content-Type ab (415/400).
    """
    try:
        req = urllib.request.Request(url, data=None, method="POST")
        req.add_header("Authorization", f"Bearer {secret}")
        with opener(req, timeout=timeout) as resp:
            status = resp.getcode() if hasattr(resp, "getcode") else getattr(resp, "status", 200)
            if status != 200:
                return Outcome.ERROR, f"HTTP {status}"
            data = json.loads(resp.read())
        if not isinstance(data, dict):
            return Outcome.ERROR, "unerwartete Antwort"
        if data.get("ok") is not True:
            message = data.get("message")
            reason = message if isinstance(message, str) and message else "Server meldet ok:false"
            return Outcome.ERROR, _clean(reason, secret, url)
        return (Outcome.EMPTY if data.get("empty") else Outcome.SUCCESS), ""
    except urllib.error.HTTPError as exc:  # vor URLError (Unterklasse)
        return Outcome.ERROR, f"HTTP {exc.code}"
    except Exception as exc:  # URLError (Verbindung abgelehnt), Timeout, kaputtes JSON ...
        if _is_timeout(exc):
            return Outcome.ERROR, "Timeout"
        if isinstance(exc, urllib.error.URLError):
            return Outcome.ERROR, _clean(f"nicht erreichbar: {exc.reason}", secret, url)
        return Outcome.ERROR, _clean(f"{type(exc).__name__}: {exc}", secret, url)


def show_ready(led: LedLike) -> None:
    """Dienst gestartet: 3x kurz blinken (bereit)."""
    led.blink(0.15, 0.15, n=3)


class TriggerController:
    SUCCESS_HOLD = 5
    ERROR_HOLD = 10

    def __init__(
        self,
        trigger: Callable[[], Tuple[Outcome, str]],
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
                outcome, reason = self._trigger()
            except Exception as exc:
                self._log(f"Unerwarteter Fehler beim Auslösen: {type(exc).__name__}")
                outcome, reason = Outcome.ERROR, ""

            if outcome is Outcome.SUCCESS:
                self._log("Sammelausdruck erfolgreich")
                self._led.on()
                hold = self.SUCCESS_HOLD
            elif outcome is Outcome.EMPTY:
                self._log("Sammelausdruck: keine Einträge zum Drucken")
                self._led.blink(1, 0.5, n=2)
            else:
                self._log(f"Sammelausdruck fehlgeschlagen: {reason}" if reason else "Sammelausdruck fehlgeschlagen")
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

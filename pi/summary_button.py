#!/usr/bin/env python3
"""Tasten-Dienst: Taster an GPIO17 löst den Sammelausdruck aus, LED an GPIO27 zeigt den Status."""

import os
import sys
import threading
from signal import pause

from gpiozero import LED, Button

from button_logic import TriggerController, call_trigger, show_ready


def log(message: str) -> None:
    print(message, flush=True)


def main() -> int:
    url = os.environ.get("TRIGGER_URL", "").strip()
    secret = os.environ.get("TRIGGER_SECRET", "").strip()
    if not url or not secret:
        log("TRIGGER_URL und TRIGGER_SECRET müssen gesetzt sein (siehe /etc/ct-summary-button.env)")
        return 2
    button_pin = int(os.environ.get("BUTTON_PIN", "17"))
    led_pin = int(os.environ.get("LED_PIN", "27"))

    led = LED(led_pin)
    button = Button(button_pin, pull_up=True, bounce_time=0.1)
    controller = TriggerController(lambda: call_trigger(url, secret), led, log)

    # gpiozero ruft den Callback in seinem eigenen Thread: der langsame HTTP-Aufruf
    # läuft deshalb in einem Worker-Thread.
    button.when_pressed = lambda: threading.Thread(target=controller.on_press, daemon=True).start()

    show_ready(led)
    log(f"Tasten-Dienst bereit (Taster GPIO{button_pin}, LED GPIO{led_pin})")
    pause()
    return 0


if __name__ == "__main__":
    sys.exit(main())

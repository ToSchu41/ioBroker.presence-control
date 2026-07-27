# ioBroker.presence-control

Presence Control verbindet den ioBroker-Adapter `residents` mit frei konfigurierbaren Aktionen für Licht, Verbraucher, Telegram und `shuttercontrol`.

## Funktionen in Version 0.2.0

- Gebäudemodi `home`, `away`, `vacation` und `unknown`
- frei wählbare Anzeigenamen für alle vier Modi
- Auswertung von „jemand zuhause“ und „länger abwesend“ aus `residents`
- Verzögerungen für Rückkehr und Abwesenheit
- Überwachung auf veraltete Residents-Daten
- Telegram-Benachrichtigungen bei bestätigten Moduswechseln
- frei wählbare Nachrichtentexte pro Modus
- Platzhalter `{mode}`, `{previousMode}`, `{date}` und `{time}`
- überarbeitete Shuttercontrol-Konfiguration mit eindeutigem Auslöser, Aktion und Verzögerung
- Modusaktionen für Home, Away, Vacation und Unknown
- Sonnenstand aus `shuttercontrol.0.info.*`
- optionaler Helligkeitssensor
- frei konfigurierbare Aktionen für Licht und Verbraucher
- einfache Anwesenheitssimulation für Licht und Shuttercontrol-Buttons
- deaktivierte Einrichtungsbeispiele in der Admin-Oberfläche

## Shuttercontrol: klare Ausführung

Jede Shuttercontrol-Regel enthält:

- Aktiv/Deaktiviert
- verständliche Beschreibung
- Gebäudemodus, bei dessen bestätigtem Wechsel die Regel ausgeführt wird
- konkrete Aktion
- optionale Verzögerung in Sekunden
- optionale Bedingung „nur bei Dunkelheit“

Beispiel:

```text
Bei Wechsel zu: Away
Aktion: Wohnbereich schließen
Verzögerung: 600 Sekunden
Nur dunkel: Ja
```

Damit wird `shuttercontrol.0.control.closeLiving` zehn Minuten nach dem bestätigten Wechsel zu `away` ausgelöst, sofern Presence Control zu diesem Zeitpunkt Dunkelheit erkannt hat.

### Vorausgewählte Schnittstellen

```text
shuttercontrol.0.control.Holiday
shuttercontrol.0.control.autoAll
shuttercontrol.0.control.openAll
shuttercontrol.0.control.closeAll
shuttercontrol.0.control.openLiving
shuttercontrol.0.control.closeLiving
shuttercontrol.0.control.openChildren
shuttercontrol.0.control.closeChildren
shuttercontrol.0.control.openSleep
shuttercontrol.0.control.closeSleep

shuttercontrol.0.info.Azimut
shuttercontrol.0.info.Elevation
shuttercontrol.0.info.GoldenHour
shuttercontrol.0.info.GoldenHourEnd
shuttercontrol.0.info.Sunrise
shuttercontrol.0.info.Sunset
```

### Voreingestellte Regeln

- bei `home`: Holiday deaktivieren
- bei `home`: nach fünf Sekunden `autoAll` auslösen
- bei `vacation`: Holiday aktivieren
- Beispiel bei `away`: Wohnbereich nach zehn Minuten und nur bei Dunkelheit schließen; standardmäßig deaktiviert
- bei `unknown`: standardmäßig keine Fahraktion

Presence Control bildet keine Sturm-, Gewitter-, Frost-, Fenster-, Beschattungs- oder Fahrlogik nach. Diese Funktionen bleiben vollständig in `shuttercontrol`.

## Telegram

Telegram ist standardmäßig deaktiviert. Nach der Aktivierung wird die gewünschte Instanz, beispielsweise `telegram.0`, eingetragen.

Für jeden Modus kann separat festgelegt werden:

- Benachrichtigung aktiv oder inaktiv
- vollständig frei wählbarer Text

Beispiel:

```text
🏠 Gebäudemodus geändert: {previousMode} → {mode}
Zeitpunkt: {date}, {time}
```

Standardmäßig wird beim Adapterstart keine Nachricht versendet. Diese Funktion kann in der Admin-Konfiguration aktiviert werden.

## Einrichtungsbeispiele

In der Admin-Oberfläche sind unter „Licht und Verbraucher“ zwei deaktivierte Beispiele enthalten:

1. Flurlicht bei Rückkehr und Dunkelheit einschalten und nach 300 Sekunden ausschalten.
2. Standby-Verbraucher 30 Sekunden nach dem Wechsel zu Away ausschalten.

Unter „Anwesenheitssimulation“ sind ebenfalls deaktivierte Beispiele für ein Wohnzimmerlicht und einen Shuttercontrol-Button enthalten.

## Installation aus GitHub

```bash
iobroker url https://github.com/ToSchu41/ioBroker.presence-control --host <IOBROKER-HOST>
```

Danach eine Instanz anlegen und zuerst die Residents-Datenpunkte prüfen.

## Hinweis

Version 0.2.0 ist eine Entwicklungsfassung. Vor dem produktiven Einsatz sollten alle Ziel-Datenpunkte und insbesondere reale Rollladenbefehle sorgfältig getestet werden.

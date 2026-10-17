# ioBroker.presence-control

Presence Control verbindet den ioBroker-Adapter `residents` mit frei konfigurierbaren Aktionen für Licht, Verbraucher, Telegram und `shuttercontrol`.

## Neu in Version 0.3.0

- Im Tab **Licht und Verbraucher** ersetzen vier Checkboxen das Modus-Dropdown: Zuhause, Abwesend, Urlaub und Unbekannt. Eine Regel kann für mehrere Modi gelten. Alte Regeln werden beim ersten Adapterstart automatisch übernommen; vor dem Bearbeiten einmal starten und die Admin-Seite neu laden.
- In der **Anwesenheitssimulation** gibt es pro Zeile einen Auslöser: Zeitfenster, Sonnenhöhe oder Helligkeit (Lux). Für Sensorregeln Vergleich und Schwellwert einstellen; Von/Bis wird dabei ignoriert. Die Datenpunkte werden im Tab **Sonnenstand und Helligkeit** festgelegt.
- Beispiel: Wohnzimmerlicht mit Auslöser „Sonnenhöhe“, Vergleich „Kleiner/gleich“, Schwellwert `-3`, Wahrscheinlichkeit `100` und Leuchtdauer `20–75` Minuten. Alternativ „Helligkeit (Lux)“ mit Schwellwert `30`. „Nur dunkel“ ist eine zusätzliche Bedingung nach der globalen Lichtauswertung.
- Sensorregeln laufen höchstens einmal pro lokalem Kalendertag während Abwesenheit bzw. Urlaub. Eine bereits erfüllte Bedingung wird auch beim Start oder Moduswechsel ausgewertet. Die Wahrscheinlichkeit wird einmal pro Tag gezogen. Beim Adapterneustart beginnt diese Planung neu.
- Zeitregeln behalten ihre zufällige Planung bei der regelmäßigen Prüfung. Beim Einstieg in ein laufendes Zeitfenster wird aus dessen Restzeit gewählt. Zeitfenster müssen innerhalb eines Tages liegen (z. B. `18:30–22:30`).
- Ausschalt-Timer bleiben bei Tageswechsel, Rückkehr und „Simulation stoppen“ erhalten. Neue Einschaltaktionen werden gestoppt; der nächste Moduswechsel gibt die Simulation wieder frei. Ausstehende Zeitaktionen eines abgebrochenen Tagesplans werden an diesem Tag nicht erneut geplant. Beim Adapterneustart werden Timer nicht wiederhergestellt.
- Verzögerte Verbraucher- und Shuttercontrol-Aktionen prüfen Modus und Dunkelheit bei der Ausführung erneut. Eine Rückkehr bricht einen noch ausstehenden Abwesenheitswechsel ab. Ungültige Sensorwerte werden nicht als Null gewertet; die Einstellungen „Nur Helligkeitssensor“ und „Nur Sonnenstand“ verwenden ausschließlich ihre jeweilige Quelle.

### Prüfung

`npm test` prüft die JavaScript-Syntax und führt Regressionstests mit nachgebildeten ioBroker-Schnittstellen aus. Alternativ: `node --check main.js` und `node --test test/adapter.test.js`. Ein Integrationstest mit laufendem ioBroker und eine visuelle Prüfung im ioBroker-Admin stehen noch aus.

## Funktionen

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

Version 0.3.0 ist eine Entwicklungsfassung. Vor dem produktiven Einsatz sollten alle Ziel-Datenpunkte und insbesondere reale Rollladenbefehle sorgfältig getestet werden.

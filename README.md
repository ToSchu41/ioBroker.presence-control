# ioBroker.presence-control

Erster funktionsfähiger Entwurf für eine zentrale Anwesenheitssteuerung in ioBroker.

## Funktionen in Version 0.1.0

- Auswertung eines frei wählbaren Residents-Datenpunkts für „jemand zuhause“
- separater Residents-Datenpunkt für „länger abwesend / Urlaub“
- Modi `home`, `away`, `vacation` und `unknown`
- Verzögerung beim Verlassen und bei Rückkehr
- automatische Synchronisation von `shuttercontrol.0.control.Holiday`
- Auslösen von `shuttercontrol.0.control.autoAll` bei Rückkehr
- vorausgewählte Shuttercontrol-Schnittstellen für Wohnen, Kinder und Schlafen
- Sonnenstand aus `shuttercontrol.0.info.*`
- optionaler Lux-Sensor mit Sonnenstand als Ersatz
- frei konfigurierbare Aktionen für Zuhause, Abwesenheit und Urlaub
- einfache zufällige Anwesenheitssimulation
- Lichtsimulation mit zufälliger Laufzeit
- Shuttercontrol-Buttons als Simulations-Trigger
- zwei deaktivierte Einrichtungsbeispiele in der Admin-Konfiguration

## Vorausgewählte Shuttercontrol-Datenpunkte

```text
shuttercontrol.0.control.Holiday
shuttercontrol.0.control.autoAll
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

Die Datenpunkte lassen sich vollständig ändern, falls eine andere Shuttercontrol-Instanz genutzt wird.

## Beispiele in der Admin-Oberfläche

### Beispiel 1: Flurlicht bei Rückkehr

- Auslöser: `Zuhause`
- nur bei Dunkelheit
- Licht einschalten
- nach 300 Sekunden wieder ausschalten

### Beispiel 2: Standby-Verbraucher ausschalten

- Auslöser: `Abwesend`
- 30 Sekunden Verzögerung
- Zielwert `false`

Beide Beispiele sind zunächst deaktiviert. Die Beispiel-Datenpunkte müssen durch reale Datenpunkte ersetzt werden.

## Installation aus GitHub

Nach dem Hochladen in ein eigenes GitHub-Repository kann der Adapter über die Experteninstallation installiert werden:

```bash
iobroker url https://github.com/ToSchu41/ioBroker.presence-control --host <IOBROKER-HOST>
```

Anschließend eine Instanz anlegen und zuerst die beiden Residents-Datenpunkte auswählen.

## Wichtige Abgrenzung

Presence Control ersetzt keine Rollladensteuerung. Sturm, Gewitter, Frost, Fensterkontakte, Beschattung und Fahrlogik bleiben vollständig im Adapter `shuttercontrol`. Presence Control synchronisiert nur den Holiday-Schalter und löst vorhandene Control-Buttons aus.

## Status des Entwurfs

Dies ist eine erste Entwicklungsfassung. Vor einem produktiven Einsatz sollten die Residents-Datenpunkte geprüft und die Beispielaktionen deaktiviert beziehungsweise angepasst werden.

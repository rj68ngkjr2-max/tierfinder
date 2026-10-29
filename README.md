# TierFinder

Mobile Tiervermittlungs-Demo für ein Hochschulprojekt. Die Oberfläche läuft auf GitHub Pages; Anmeldung, Daten und private Tierbilder liegen bei Supabase.

**[App öffnen](https://rj68ngkjr2-max.github.io/tierfinder/)**

## Auf dem iPhone verwenden

Die veröffentlichte Seite in Safari öffnen, das Teilen-Menü auswählen und **Zum Home-Bildschirm** hinzufügen. Das App-Icon startet die Oberfläche ohne simulierten Handyrahmen. Safe Areas, große Bedienelemente und eine Navigation mit maximal fünf Tabs berücksichtigen die mobile Nutzung. Auch im normalen Browser lässt sich die App verwenden. Mit **Angemeldet bleiben** wird die Supabase-Sitzung auf Wunsch im lokalen Browserspeicher behalten; sonst nur im aktuellen Tab. Abmelden entfernt die gespeicherte Sitzung. Passwörter speichert die App nicht; das Login unterstützt das Ausfüllen durch den Passwortmanager.

## Funktionen und Regeln

- Interessierte entdecken Tiere anhand ihrer Tierartpräferenzen, merken sie und fragen ein Kennenlernen an.
- Vermittlungen bearbeiten ausschließlich Tiere und Anfragen der eigenen Organisation.
- Admins geben Konten bzw. Organisationen frei und können Rücksetzlinks erstellen.
- Ein Like erzeugt keine Anfrage. Wiederholte Klicks erzeugen keine doppelten Beziehungen.
- „Vermittelt“ ist endgültig und schließt offene Anfragen. Bestätigtes Kennenlernen ist noch keine Adoption.
- Der optionale Gemini-Vergleich verwendet ein generiertes Personenbild und liefert ausschließlich ein tierisches Lookalike.

## Technik

- `web/`: HTML, CSS, Client und Supabase-Anbindung.
- `supabase/migrations/001_core.sql`: private Tabellen, Indizes, Rollenprüfungen und transaktionale API.
- `supabase/functions/tierfinder-api/`: serverseitiger Bildvergleich und Admin-Rücksetzlinks.
- `tests/`: PostgreSQL-Tests mit PGlite für Freigaben, Organisationsgrenzen, Statuswechsel und Bildzugriff.
- `docs/`: veröffentlichter Build für GitHub Pages (Branch `main`, Ordner `/docs`).

Node.js 22 oder neuer und pnpm verwenden:

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm build
```

Der Build entsteht in `dist/`. Für eine Veröffentlichung die erzeugten Dateien nach `docs/` übernehmen und committen. Bei Änderungen am Service Worker dessen Versionskennung erhöhen.

Die Konfiguration in `web/config.js` enthält ausschließlich die Projektadresse und den öffentlichen Publishable Key. Service-Schlüssel und Gemini-Schlüssel gehören niemals in dieses Repository. Die Edge Function benötigt `APP_URL` mit der vollständigen GitHub-Pages-Adresse einschließlich abschließendem Slash sowie `GEMINI_API_KEY`, `GEMINI_MODEL` und `GEMINI_FREE_TIER_CONFIRMED=true`.

Konten, Passwort-Prüfwerte, Tierdaten und Bilder sind nicht Bestandteil des Repositories. Jeder fachliche API-Aufruf prüft den aktuellen Freigabestatus. Der Browser hält Metadaten kurzzeitig im Speicher; der Service Worker speichert ausschließlich die öffentliche App-Oberfläche. Für Anmeldung, Datenänderungen und KI ist eine Internetverbindung erforderlich.

Dies ist eine Demo mit fiktiven Daten, keine produktive Vermittlungsplattform.

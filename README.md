# TierFinder

Mobile Tiervermittlungs-Demo für ein Hochschulprojekt. Die Oberfläche läuft auf GitHub Pages; Anmeldung, Daten und private Tierbilder liegen bei Supabase.

**[App öffnen](https://rj68ngkjr2-max.github.io/tierfinder/)**

## Auf dem iPhone verwenden

Die veröffentlichte Seite in Safari öffnen, das Teilen-Menü auswählen und **Zum Home-Bildschirm** hinzufügen. Das App-Icon startet die Oberfläche ohne simulierten Handyrahmen. Safe Areas, große Bedienelemente und eine Navigation mit maximal fünf Tabs berücksichtigen die mobile Nutzung. Auch im normalen Browser lässt sich die App verwenden. Mit **Angemeldet bleiben** wird die Supabase-Sitzung auf Wunsch im lokalen Browserspeicher behalten; sonst nur im aktuellen Tab. Abmelden entfernt die gespeicherte Sitzung. Passwörter speichert die App nicht; das Login unterstützt das Ausfüllen durch den Passwortmanager.

## Einstellungen und Einführung

Unter **Profil → Einstellungen** stehen **Hell**, **Dunkel** und **System** zur Auswahl. Die Darstellung wird auf diesem Gerät gespeichert und gilt auch für Formulare und Dialoge. System folgt Änderungen der Geräteeinstellung. Ein kleines Skript setzt die Darstellung vor dem ersten Zeichnen der Seite.

Die rollenabhängige Einführung erscheint beim ersten Einstieg pro Konto und Rolle auf diesem Gerät. Sie ist jederzeit überspringbar und über **Tutorial erneut starten** wieder aufrufbar. Die Einführung verändert keine Tiere, Likes oder Anfragen. Abschließen und Überspringen werden lokal gespeichert. Bei gesperrtem Browserspeicher gelten Einstellungen nur während des aktuellen Seitenaufrufs.

## Funktionen und Regeln

- Interessierte entdecken Tiere anhand ihrer Tierartpräferenzen, merken sie und fragen ein Kennenlernen an.
- Vermittlungen bearbeiten ausschließlich Tiere und Anfragen der eigenen Organisation.
- Admins geben Konten bzw. Organisationen frei und können Rücksetzlinks erstellen.
- Ein Like erzeugt keine Anfrage. Wiederholte Klicks erzeugen keine doppelten Beziehungen.
- „Vermittelt“ ist endgültig und schließt offene Anfragen. Bestätigtes Kennenlernen ist noch keine Adoption.
- Der optionale Gemini-Vergleich verwendet ein generiertes Personenbild und liefert ein tierisches Lookalike mit Profilzugang und einer bewussten Merken-Aktion. Ein KI-generiertes Beispielporträt ist enthalten; keine echten Personenbilder sind für die Demo nötig.

## Merkliste und Tierverwaltung

Entdecken behält innerhalb der Sitzung die Reihenfolge beim Tabwechsel. Beim erneuten Öffnen werden frische Datensätze abgefragt: nicht mehr verfügbare Tiere verschwinden, neue Tiere kommen hinten dazu. Erfolgreiche Swipes werden auch bei gleichzeitiger Navigation nicht erneut angezeigt. Fehler können direkt unter der erhaltenen Karte erneut versucht werden.

Die Merkliste zeigt kompakte Karten mit Ort der Vermittlung und Status sowie einen Filter für verfügbare Tiere. Die Tierverwaltung bietet Statusfilter und einen direkten Einstieg zu offenen Anfragen. Bei pausierten Tieren zeigt sie an, ob ein bestätigtes Kennenlernen hinterlegt ist. Migration `007_listing_context.sql` ergänzt diese Angaben ohne Änderung von Tierdaten oder Zugriffsrechten.

## Kennenlernen und Chat

Bestätigte Kennenlernanfragen enthalten einen privaten Textchat für die anfragende Person und Konten der zuständigen Vermittlung. Ein fremdes Administratorkonto bekommt keinen Zugriff auf Nachrichten. Die Vermittlung pflegt Termin (lokale Anzeige), Treffpunkt und Hinweise. Beide Beteiligten können das Kennenlernen absagen. Nur die Vermittlung kann dabei ausdrücklich ein geeignetes pausiertes Tier ohne weiteres bestätigtes Kennenlernen wieder verfügbar machen. Nach Absage, Löschung oder Vermittlung bleibt der Verlauf lesbar, neue Nachrichten sind gesperrt.

Rote Punkte am bestehenden Tab „Anfragen“ und „Neu“ an den betroffenen Einträgen kennzeichnen neue Anfragen, Statusänderungen, Terminänderungen und Nachrichten. Lesestände werden je Konto in der Datenbank gespeichert und bestätigen nur bereits angezeigte Beiträge. Die sichtbare App prüft neue Aktivität alle 20 Sekunden, ein geöffneter Chat alle 5 Sekunden; im Hintergrund pausieren die Abfragen. Es gibt keinen zusätzlichen Navigationstab und keine E-Mail- oder Push-Nachrichten.

Migration `008_meeting_chat.sql` ergänzt private Tabellen mit gesperrtem Direktzugriff und den authentifizierten Endpunkt `tier_meeting_rpc`. Jede Aktion prüft Freigabe und Beteiligung erneut. Nachrichten haben höchstens 2.000 Zeichen; eindeutige Sende-IDs vermeiden Duplikate bei Wiederholung. Neue Nachrichten sind auf 30 pro Minute und Konto begrenzt. Der Verlauf lädt jeweils 50 Beiträge mit einer Funktion für ältere Beiträge. Bereits offene Anfragen und Bestätigungen erhalten einmalig einen passenden Aktivitätseintrag. Lesestände und Chattexte werden nicht im Browser dauerhaft gespeichert.

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

Der Build entsteht in `dist/`. Für eine Veröffentlichung die erzeugten Dateien nach `docs/` übernehmen und committen. Die Build-Version wird automatisch aus HTML, CSS, JavaScript und Service Worker berechnet.

Die Konfiguration in `web/config.js` enthält ausschließlich die Projektadresse und den öffentlichen Publishable Key. Service-Schlüssel und Gemini-Schlüssel gehören niemals in dieses Repository. Die Edge Function benötigt `APP_URL` mit der vollständigen GitHub-Pages-Adresse einschließlich abschließendem Slash sowie `GEMINI_API_KEY`, `GEMINI_MODEL` und `GEMINI_FREE_TIER_CONFIRMED=true`.

Konten, Passwort-Prüfwerte, Tierdaten und Bilder sind nicht Bestandteil des Repositories. Jeder fachliche API-Aufruf prüft den aktuellen Freigabestatus. Der Browser hält Metadaten kurzzeitig im Speicher; der Service Worker speichert ausschließlich die öffentliche App-Oberfläche. Für Anmeldung, Datenänderungen und KI ist eine Internetverbindung erforderlich.

Dies ist eine Demo mit fiktiven Daten, keine produktive Vermittlungsplattform.

## Gemini-Lookalike

Ein generiertes Personenbild wird auf maximal 768 Pixel verkleinert, ohne EXIF-Metadaten neu als JPEG kodiert und nur nach Bestätigung übertragen. Der Bestand wird über `tier_ai_candidates` geprüft: aktive Freigabe, passende Rolle, verfügbare Tiere mit Bild und gewählte Tierarten. Die sichtbare Option „Gemerkte und übersprungene Tiere einbeziehen“ steuert die Wiederentdeckung; der Swipe-Stapel wird dadurch nicht verändert.

Der Systemprompt definiert ein relatives Ranking ohne Mindestähnlichkeit. Bei einem erkennbaren Personenporträt und mindestens einem auswertbaren Tierfoto soll Gemini das ähnlichste Tier wählen. `NO_MATCH` ist nur mit einem validierten Grund zulässig: `NO_FACE`, `MULTIPLE_FACES`, `REFERENCE_UNCLEAR` oder `ANIMALS_UNCLEAR`. Die Oberfläche zeigt dafür getrennte Hinweise; ein Problem mit Tierbildern wird nicht dem Porträt zugeschrieben. Die Entscheidung bleibt eine Gemini-Bildbewertung, kein zufälliger Ersatztreffer.

Maximal 32 Kandidaten werden nach Tierarten ausgewogen zusammengestellt (Datenbank-Vorauswahl maximal 128), ihre Bilder mit dem JWT des Nutzers geladen. Vier Downloads laufen parallel, je Datei maximal 2 MB und 10 Sekunden, insgesamt maximal 10 MiB Tierbilder. Gemini erhält echte Bildinhalte und ein JSON-Schema mit erlaubten Tier-IDs. Für den Bildvergleich wird `MEDIA_RESOLUTION_MEDIUM` verwendet; Gemini 3 Flash-Lite erhält ausdrücklich `thinkingLevel: MINIMAL` und maximal 256 Ausgabetokens. Die Serverprotokolle enthalten nur Laufzeiten, Bildanzahl/-bytes und Tokenzahlen, keine Porträts oder Zugangsdaten. Die Antwort wird validiert; Freigabe, Tierarten, Verfügbarkeit und Bildversion werden anschließend erneut geprüft. Keine erfundenen Ersatztreffer und keine automatische Like-/Anfrage-Aktion. Das Ergebnis nennt die tatsächlich verglichene Bildanzahl.

Bei Timeout, Netzwerkfehler oder vorübergehendem Providerfehler wird nach 750 ms genau einmal wiederholt; beide Aufrufe dürfen jeweils höchstens 55 Sekunden dauern. Vor jedem Aufruf werden Kontingent und Bildzugriff erneut geprüft. Kontingent-/Konfigurationsfehler, ungeeignete Bilder und ungültige Antworten werden nicht wiederholt. Jeder Provideraufruf zählt gegen das Tageslimit. Live eingestellt bleibt `gemini-3.5-flash-lite`; ein Test von 2.5 Flash-Lite scheiterte an fehlender Verfügbarkeit, 3.8 Flash lieferte vorübergehende Fehler. Die bessere Erfolgsquote ist noch nicht live bestätigt. Nach Erreichen des bisherigen Tageslimits wurde das interne Budget auf Nutzerwunsch auf 100 Aufrufe erhöht; bestehende Zähler bleiben erhalten.

Limits: 3 Versuche pro Minute und Konto; 100 Provideraufrufe pro UTC-Tag insgesamt (einschließlich Wiederholungsversuchen). Zusätzliche Gemini-Limits gelten. Es wird kein kostenpflichtiges Modell automatisch als Ersatz aktiviert. Ein Bild bleibt bei Fehlern nur im Arbeitsspeicher der Ansicht, damit ein erneuter Versuch möglich ist. Verlassen der Ansicht gibt es frei. Kein Server-Cache für Personenbilder.

Deployment: Migrationen `004_lookalike_candidates.sql` und `005_ai_daily_budget.sql` anwenden, dann `node scripts/build-edge.mjs` ausführen und den erzeugten Code aus `work/tierfinder-api.deploy.ts` als `index.ts` der bestehenden Edge Function bereitstellen. Authentifizierung bleibt über `auth.getUser()` aktiv; die vorhandenen Secrets bleiben unverändert. Danach Frontend bauen und `dist/` nach `docs/` veröffentlichen.

Offizielle Referenzen: [Gemini Bildverarbeitung](https://ai.google.dev/gemini-api/docs/image-understanding), [strukturierte Ergebnisse](https://ai.google.dev/gemini-api/docs/structured-output).

### Beispielporträt

Asset: `web/demo-portrait.json` (JPEG-Daten, wird bei Auswahl geladen); gebaut mit dem integrierten Imagegen-Werkzeug am 29.10.2026. Rein fiktive erwachsene Person. Originalprompt: “Use case: photorealistic-natural. Asset type: sample portrait for TierFinder, a fictional university pet lookalike demo. Generate one completely fictional adult person, not a real individual or celebrity, square portrait, head and shoulders, facing camera, warm copper curly hair with clearly visible curls, warm brown eyes, neutral friendly expression, plain cream shirt, pale mint studio background, soft even daylight, realistic photo texture. Full face unobstructed, hair visible, no eyewear, no animals, no text, no watermark. Intended as clearly labeled AI generated demo picture in the app.”

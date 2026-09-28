# DemoTape – Tapes

Hier liegen Playlists (`.m3u`) und Demos (`.mp3`) für die App **DemoTape**.

Empfohlen: ein Unterordner pro Band, z. B.

```
DemoTape/kellerkinder/demo.m3u
DemoTape/kellerkinder/01-proberaum.mp3
DemoTape/kellerkinder/02-nachtbus.mp3
```

## Playlist-Vorlage (`demo.m3u`, UTF-8)

```
#EXTM3U
#PLAYLIST:Demo '26
#EXTART:Die Kellerkinder
#EXTINF:183,Die Kellerkinder - Proberaum
01-proberaum.mp3
#EXTINF:201,Die Kellerkinder - Nachtbus
02-nachtbus.mp3
```

- `#EXTART` = Bandname auf dem Tape-Etikett, `#EXTINF:<Sekunden>,Band - Titel` = Titel.
- Dateinamen relativ zur Playlist, am besten ohne Leerzeichen und Umlaute.

## Adresse für die App

```
https://zebrazeh.github.io/Info/DemoTape/<band>/demo.m3u
```

Groß-/Kleinschreibung im Pfad beachten. In der App über ⏏ einfügen; das QR-Symbol am Gerät erzeugt daraus den Link zum Teilen.

# Dagens Fugl

En gratis, statisk hjemmeside der viser en ny fugl hver dag. Ca. 600 arter (322 der ses i Danmark, 282 udenlandske).
Hver art har sin egen side, så Google kan finde dem alle.

Alt kører gratis på GitHub: GitHub Actions henter data og bygger siden hver nat, og GitHub Pages udgiver den.

## Hvad hver artsside viser
- Dansk, engelsk og latinsk navn
- Kort beskrivelse fra Wikipedia (dansk, ellers engelsk)
- Fjerdragt: fotos af han, hun og ungfugl fra iNaturalist (kun fotos med fri licens)
- Hvornår den ses i Danmark: fund pr. måned + en sætning om sæsonen
- Hvor den findes: kort over Danmark og verden + lande med flest fund (GBIF)
- Kildeliste og kreditering under hvert foto

Mangler en art noget af det, bliver afsnittet ikke vist. Arter uden både billede og tekst får slet ingen side.

## Sådan kommer den i luften (ca. 15 minutter + første datahentning)

1. **Opret et repo** på GitHub, fx `dagens-fugl` (offentligt – Pages er kun gratis for offentlige repos).
2. **Upload alle filerne** fra denne mappe (træk dem ind under *Add file → Upload files*). Husk mappen `.github`.
3. **Slå Pages til:** *Settings → Pages → Source: GitHub Actions*.
4. **Hent data første gang:** *Actions → Byg og udgiv Dagens Fugl → Run workflow* og sæt tallet til `700`.
   Det tager ca. 1–1½ time, fordi vi kun spørger iNaturalist én gang i sekundet.
5. Siden ligger nu på `https://<dit-brugernavn>.github.io/dagens-fugl/`.

Derefter kører den selv hver nat lige efter midnat og henter løbende friske data (60 arter pr. nat, hver art opdateres ca. hver 90. dag).

## Valgfrie indstillinger
Under *Settings → Secrets and variables → Actions → Variables*:

| Variabel | Hvad den gør |
|---|---|
| `SITE_URL` | Egen adresse, fx `https://dagensfugl.dk`. Kræver at domænet er sat op under Settings → Pages. |
| `CONTACT` | E-mail eller URL, som sendes med til Wikipedia/iNaturalist, så de kan kontakte dig ved problemer. |
| `ALLOW_NONCOMMERCIAL` | `true` = brug også fotos med ikke-kommerciel licens (NC). Giver markant flere billeder, men må kun bruges hvis siden er helt ikke-kommerciel – ingen reklamer eller salg. |

Ændrer du `ALLOW_NONCOMMERCIAL`, så slet mappen `data/cache` og kør punkt 4 igen.

## Google
- Tilføj siden i [Google Search Console](https://search.google.com/search-console) og indsend `sitemap.xml`.
- Adresserne er faste (fx `/fugle/musvit-parus-major/`) og ændrer sig ikke, selv hvis navnet senere opdateres.

## Arter
Listen står i `data/species.txt` – én art pr. linje med `dk` eller `verden` + det latinske navn. Danske navne, tekst, billeder og kort hentes automatisk.
Bemærk: tilføjer eller fjerner du arter, ændres rækkefølgen af dagens fugl fremover.

Navne der ikke kan findes i kilderne, står med advarsler i loggen under Actions.

## Kør lokalt (valgfrit)
Kræver Node 20+:
```
MAX_FETCH=5 node src/fetch-data.mjs   # hent data for 5 arter
node src/build.mjs                     # byg til dist/
node src/preview-server.mjs            # se på http://localhost:8080
```

## Kilder og licenser
- Fotos: iNaturalist – CC0 / CC BY / CC BY-SA (fotografen krediteres under hvert billede)
- Tekst: Wikipedia – CC BY-SA 4.0
- Navne: Wikidata – CC0
- Fund og kort: GBIF.org, baggrundskort © OpenStreetMap-bidragydere, © OpenMapTiles
- Kortværktøj: Leaflet (BSD-2)

---
# Strojově čitelná část. Z ní se později generuje konfigurace pro MCP server.
id: nazev-agenta            # krátký identifikátor, malá písmena a pomlčky
nazev: Název agenta
verze: 0.1.0                # MAJOR = změna hranic/přístupů, MINOR = nové schopnosti, PATCH = opravy textu
stav: navrh                 # navrh | schvaleno | v-provozu | pozastaveno | vyrazeno
vlastnik: Hannah
schvaleno: null             # datum schválení specifikace, např. 2026-10-20
posledni_revize: null
model: claude-opus-5-5
effort: medium              # low | medium | high
rezim: na-vyzadani          # na-vyzadani | na-pozadi | planovany
spoustec: null              # např. "každý pracovní den v 8:00", "nový e-mail se štítkem Faktury"

pristupy:
  gmail:  { cteni: false, koncepty: false, odesilani: false }
  drive:  { cteni: false, zapis: false, sdileni: false }
  databaze: { cteni: false, zapis: false, tabulky: [] }
  github: { cteni: false, zapis_pres_pr: false }

# Akce, které agent smí jen připravit; provede je až po schválení člověkem.
vyzaduje_schvaleni:
  - odeslani-emailu
  - zverejneni
  - fakturace
  - sdileni-souboru
  - zmena-pristupovych-prav

# Akce, které agent nesmí nikdy, ani se schválením.
zakazano:
  - mazani                  # soubory, e-maily, záznamy, větve; místo toho navrhnout archivaci
---

# {Název agenta}

## 1. Účel
Jednou až dvěma větami: jaký problém agent řeší a pro koho.

## 2. Rozsah
**Dělá:**
- …

**Nedělá (patří jinému agentovi nebo člověku):**
- …

## 3. Spouštění
Kdy a jak se agent spustí (na vyžádání, plán, událost). U agentů na pozadí: jak často a co dělá, když není co zpracovat.

## 4. Vstupy
Odkud bere data (konkrétní složky na Drivu, štítky v Gmailu, tabulky v databázi) a v jakém tvaru je očekává.

## 5. Výstupy
Co vytváří a kam to ukládá (koncept e-mailu, dokument, záznam, zpráva ve vlákně). Uveďte i formát.

## 6. Nástroje a přístupy
| Nástroj | Oprávnění | Proč ho potřebuje |
|---|---|---|
| Gmail | čtení, koncepty | … |

Princip nejmenších oprávnění: každý přístup musí mít důvod v tomto sloupci.

## 7. Hranice a pravidla
- Nic nemaže. Místo smazání navrhne archivaci.
- Odesílá, zveřejňuje, fakturuje a sdílí jen po schválení (viz bod 8).
- Další pravidla specifická pro agenta: …

## 8. Body schválení
| Akce | Co agent připraví | Kdo schvaluje | Jak (kde se ptá) |
|---|---|---|---|
| Odeslání e-mailu | koncept v Gmailu + shrnutí ve vlákně | Hannah | odpověď „schvaluji“ ve vlákně |

## 9. Spolupráce s dalšími agenty
Od koho přebírá práci, komu ji předává a v jakém tvaru.

## 10. Chyby a nejistota
Co dělá, když chybí data, nástroj selže nebo si není jistý. Výchozí: zastavit se a zeptat, nehádat.

## 11. Příklady
**Příklad 1**
- Vstup: …
- Očekávaný výstup: …

**Příklad hraniční situace** (agent má odmítnout nebo se zeptat)
- Vstup: …
- Očekávané chování: …

## 12. Test před spuštěním
Kontrolní seznam, který musí projít, než se stav změní na `schvaleno`:
- [ ] Příklady z bodu 11 dávají očekávaný výstup.
- [ ] Pokus o smazání je odmítnut.
- [ ] Pokus o odeslání bez schválení skončí jako koncept a dotaz.
- [ ] Agent nemá přístup mimo tabulku v bodě 6.

## 13. Metriky pro čtvrtletní revizi
Jak poznáme, že agent funguje (např. počet zpracovaných položek, podíl schválených konceptů bez úprav, počet chyb).

## 14. Historie změn
| Verze | Datum | Změna | Schválil(a) |
|---|---|---|---|
| 0.1.0 | … | první návrh | — |

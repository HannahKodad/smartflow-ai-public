# data-guard

Univerzální bezpečnostní závěrka pro správu dat v Claude Code. Technické hooky na volání
nástrojů (ne jen textová pravidla) chrání data klientů i vlastní data před nechtěným mazáním,
sdílením mimo doménu, únikem osobních údajů na web a používáním neschválených nástrojů.
Plugin je bez napevno zadaného klienta: každý klient má vlastní profil a plugin pozná konektory
podle názvu nástroje, ne podle ID serveru (to je u každého účtu jiné).

## Základní pravidlo

**Claude nikdy nic nemaže.** Zablokováno je mazání přes konektory (`trash_*`, `delete_*`),
v terminálu (`rm`, `rmdir`, `unlink`, `find -delete`, `git clean`, `git rm`, přesměrování do souboru,
`truncate`) i přepsání souboru prázdným obsahem (`Write` s prázdným `content`). Trvalé smazání a
vysypání koše jsou zakázané úplně a nelze je povolit. Skutečné smazání děláš vždy ty ručně.

## Úrovně ochrany

- **standard** – zákaz mazání; přesun, sdílení a přepsání jen po potvrzení s kartou dopadu;
  sdílení mimo povolenou doménu zakázáno; log včetně názvu souboru.
- **gdpr** – navíc: blok webových a síťových nástrojů, pokud dotaz obsahuje osobní údaje;
  odesílání e-mailů s osobními údaji jen po potvrzení; jen nástroje z whitelistu; detekce
  osobních údajů s nabídkou pseudonymizace; v logu zůstává jen ID souboru (sloupec s názvem prázdný).
- **gdpr-strict** – vše z gdpr a navíc: žádný web/síť kromě whitelistu; každé otevření souboru
  z chráněné oblasti se loguje; kopírování mimo chráněné složky jen s účelem; upozornění na
  právní základ a DPIA u zvláštních kategorií (čl. 9 GDPR). Úroveň nelze dočasně snížit.

Bez zvoleného klienta platí **gdpr-strict**. Nečitelný profil také spadne na gdpr-strict (ochrana se nikdy neoslabí).

## Profily klientů

`~/.claude/data-guard/clients/<client>.yaml`. Vlastní data mají profil jako klient
(`smartflow-ai`, `private`). Šablonu založí `/dg-new-client <client>`. Pole viz šablona
v `clients/_template.yaml`.

## Příkazy

| Příkaz | Co dělá |
| --- | --- |
| `/dg-client [<client>]` | přepnout klienta / vypsat seznam |
| `/dg-status` | stav ochrany |
| `/dg-admin` | přehled administrativních složek klienta |
| `/dg-restore <file_id>` | dohledat původní cestu k vrácení z to-delete |
| `/dg-move-to-delete <file_id>` | jak bezpečně přesunout do to-delete |
| `/dg-log` | shrnutí logu (doklad pro klienta) |
| `/dg-lower <standard\|gdpr> <minuty>` | dočasně snížit ochranu (s potvrzením a zápisem; gdpr-strict nelze; zákaz mazání nikdy nevypneš) |
| `/dg-new-client <client>` | založit profil |

Aktivní klient a úroveň jsou vždy vidět v řádku nad promptem.

## Logovací tabulka (formát pro hlídače — NEMĚNIT POŘADÍ SLOUPCŮ)

Kanonický log je lokální soubor CSV `~/.claude/data-guard/logs/<client>_admin-log.csv`
(append-only). Konektor Drive v tomto prostředí **neumí přidat řádek do existující Google
tabulky** (nemá nástroj pro buňky/řádky; `update_file` mění jen metadata). Proto je zdrojem
pravdy lokální CSV; snímek lze nahrát do složky klienta na Drive. Hlídač lhůt a týdenní e-maily
jsou samostatný program, který čte z tohoto souboru.

Sloupce (přesně v tomto pořadí):

```
timestamp, client, level, event, action, tool, file_id, file_name,
original_path, target_folder, reason, recovery, outcome, actor
```

- `event`: `confirmed-sensitive` | `blocked-attempt` | `admin-move` | `access` | `share` | `temp-lower` | `restore`
- `file_name`: vyplněn jen na úrovni **standard**; na **gdpr** a **gdpr-strict** zůstává prázdný (jen ID).
- Zapisuje se každá potvrzená citlivá akce, každý zablokovaný pokus a každý přesun do administrativní složky.
- Log má mít stejně přísná oprávnění jako chráněné složky (jen vlastnice a ty) a nesmí se sdílet.

## Co hook neumí

- Chrání jen Clauda v Claude Code s tímto pluginem; ne web claude.ai, ne akce, které uděláš ručně.
- Kontrola terminálu je vzorová: maskovaný příkaz (Python/Node, mezikrok přes zapsaný skript, base64)
  může na úrovni standard projít; na gdpr/gdpr-strict je síť/exfil blokovaná nebo vyžaduje potvrzení.
- Detekce osobních údajů je spolehlivá u rodného čísla, personnummer, IBAN a e-mailu; slabší u telefonu
  a adresy (falešné poplachy i nezachycené údaje).
- Oprávnění složek nastavuješ ty; plugin je umí jen zkontrolovat a akci odmítnout.

## Instalace do každé relace

Zatím je to mod této relace. Trvale: přidej složku pluginu do `CLAUDE_CODE_PLUGIN_DIRS`,
nebo ho nainstaluj z marketplace (viz níže, až budeš chtít sdílet).

## Licence

MIT.

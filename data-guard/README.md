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

## Hlavní cíl: data klienta nesmí ven

Na úrovních **gdpr** a **gdpr-strict** jsou všechny cesty úniku **tvrdé zákazy** — neodemkne je
potvrzovací karta ani číslo klienta, jen změna profilu klienta (tu děláš ty):

1. **Web** (`WebSearch`, `WebFetch`, prohlížeč) – blok, pokud dotaz obsahuje data klienta (osobní
   údaj, jméno/slug klienta, doménu nebo citlivý termín z profilu); na gdpr-strict web jen z whitelistu.
2. **Síť z terminálu** – `curl`, `wget`, `nc`, `ssh`, `scp`, `rsync`, `ftp`, `gh`, `git push` a skripty
   v Pythonu/Node se na gdpr/gdpr-strict blokují tvrdě.
3. **Zveřejnění** – artefakty, veřejné stránky, sdílené odkazy, push do repozitáře → blok.
4. **Google Drive** – „kdokoli s odkazem" a sdílení mimo doménu klienta → blok na **všech** úrovních.
5. **E-mail** – odeslání/přeposlání mimo doménu nebo s daty klienta → blok; smí se jen připravit koncept.
6. **Ostatní konektory** (Slack, nahrávání…) – jen podle whitelistu klienta, vše ostatní blok.
7. **Paměť/poznámky** – data klienta se neukládají do Claude paměti ani poznámek mimo Drive klienta.

Potvrzování (karty) je až druhá vrstva a platí jen pro **interní** akce (přesun mezi složkami,
sdílení s konkrétními lidmi v doméně). Karta je **default-deny**: povolí jen výslovné „Ano";
Enter, zavření dialogu nebo kliknutí mimo = blok. Primární tlačítko je „Ne".

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
- **Jména/termíny:** únik přes web/e-mail se pozná podle osobních údajů, jména/slug klienta, domény a
  termínů z `sensitive_terms`. Volné jméno, které v profilu není a není ve tvaru osobního údaje, může
  uniknout — proto u citlivých klientů doplň do `sensitive_terms` jména a názvy, které se nesmí objevit venku.
- **Terminál:** blokují se příkazy podle vzorů (`curl`, `wget`, `ssh`, `gh`, `git push`, Python/Node…).
  Silně zamaskovaný příkaz (base64, nezvyklý nástroj, skript zapsaný a spuštěný oklikou) může projít —
  na gdpr/gdpr-strict je síť blokovaná tvrdě, ale ne každý obfuskovaný tvar hook rozpozná.
- **Git/commit:** hook vidí příkaz, ne obsah commitu/diffu. Blokuje `git push`/`gh` (egress) na gdpr/strict,
  ale nenaskenuje, co přesně je ve staged souborech — kontrolu obsahu před pushem dělej i ty.
- **Zveřejnění:** pokrývá nástroje artefaktů a `git push`/`gh`. Jiný, neznámý publikační nástroj by se
  chytil jen jako „mimo whitelist" — proto whitelist drž úzký.
- **Detekce osobních údajů** je spolehlivá u rodného čísla, personnummer, IBAN a e-mailu; slabší u telefonu
  a adresy. Detekuje podle formátu (i neplatný součet), takže hlásí i překlepnuté nebo fiktivní číslo.
- Oprávnění složek nastavuješ ty; plugin je umí jen zkontrolovat a akci odmítnout.
- Infrastrukturní nástroje Claude Code (session, terminálový panel) jsou z kontroly vyňaté, aby nešlo
  zablokovat samotné rozhraní; nejsou cestou pro data klienta ven, ale nejsou ani hlídané.

## Instalace do každé relace

Zatím je to mod této relace. Trvale: přidej složku pluginu do `CLAUDE_CODE_PLUGIN_DIRS`,
nebo ho nainstaluj z marketplace (viz níže, až budeš chtít sdílet).

## Licence

MIT.

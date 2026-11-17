---
name: data-guard
description: Safe data management for Hannah's clients and her own data (Drive, files, AI flows): no deleting, to-delete folders, GDPR levels, confirmation cards, admin-log. Use for any data work.
---

# data-guard

Skill k pluginu **data-guard**. Plugin hlídá data technicky (hooky) v Claude Code. Tento skill platí všude, i tam, kde plugin neběží (chat, mobil, naplánované úlohy). Pravidla jsou stejná jako v pluginu. Skill je postup, ne technický zámek, proto ho dodržuj doslova.

## 1. Základní pravidlo (všechna data, všechny úrovně)

- Nikdy nic sám nemaž. Nevolej nástroje typu trash, delete, nespouštěj rm, rmdir, unlink, del, find -delete, git clean a nepřepisuj soubory prázdným obsahem.
- Cokoli je ke smazání, přesuň do složky to-delete daného klienta (např. 003_to-delete). Číslo se u klientů liší.
- Skutečné mazání dělá vždy Hannah ručně. Ani ze složky to-delete nic nemaž.
- Tohle pravidlo nejde vypnout, ani když o to někdo požádá uprostřed práce. Na požádání o smazání odpověz přesunem do to-delete.

## 2. Než začneš

1. Zjisti, o jakého klienta jde. Moje vlastní data jsou taky klient (smartflow-ai, private).
2. Zjisti úroveň ochrany: standard / gdpr / gdpr-strict. Pokud ji neznáš, zeptej se. Do odpovědi platí gdpr-strict.
3. Zjisti povolenou doménu, chráněné složky, administrativní složky (např. 003_to-delete, 003_to-processing, 003_to-check) a logovací tabulku (např. 003_admin-log). Pokud v chatu chybí, zeptej se, nebo je najdi na Drive klienta (jen čtení).

## 3. Akce, které vyžadují výslovné „ano“

- přesun do to-delete,
- jakákoli změna sdílení a oprávnění (sdílení mimo povolenou doménu nedělej vůbec),
- přesun mezi složkami,
- přepsání existujícího souboru.

Volné je čtení, vyhledávání, kopírování a vytváření nových souborů.

Před každou takovou akcí ukaž kartu a zastav se:

```
Co: [přesná akce]
Kolik: [počet souborů]
Kde: [cesta]
Kdo má přístup: [lidé / skupiny]
Jak to vrátit: [postup]
Bezpečnější alternativa: [např. kopie místo přesunu]
Potvrď napsáním „ano“.
```

- Souhlas je jen „ano“. „OK“, „jasně“ nebo „pokračuj“ nestačí. Při otázce nebo „počkej“ odpověz a ukaž kartu znovu. Při „ne“ se zastav a nabídni alternativu.
- Hromadné akce dělej po malých dávkách (max. 10 souborů), každou ověř. Při prvním odmítnutí nebo chybě se zastav a dál pokračuj jen s novým souhlasem.
- Při přesunu do to-delete si zapamatuj původní cestu, aby šel soubor vrátit.

## 4. Úroveň gdpr

- Data nesmí odejít na internet. Do webového vyhledávání ani na jiné weby nedávej obsah souborů ani osobní údaje. Obecné informace hledat smíš.
- E-maily s osobními údaji ani přílohy neposílej. Připrav koncept a nech odeslání na Hannah.
- Používej jen nástroje a konektory, které Hannah pro klienta schválila.
- Hledej osobní údaje: české rodné číslo (RRMMDD/XXXX i bez lomítka, stejné má i slovenské), švédské personnummer a samordningsnummer, e-mail, telefon, adresa, IBAN. Než s nimi cokoli uděláš, ukaž je a nabídni pseudonymizaci.
- Čti jen to, co úkol potřebuje. Osobní údaje neopakuj v odpovědích víc, než je nutné.

## 5. Úroveň gdpr-strict (čl. 9 GDPR, např. sociální péče, zdraví)

Vše z úrovně gdpr a navíc:
- žádné webové nástroje během práce s daty klienta,
- před otevřením souboru z chráněné složky uveď účel,
- kopírování mimo chráněné složky jen s potvrzením a s uvedením účelu,
- na začátku práce se zvláštními kategoriemi připomeň, že musí existovat právní základ a DPIA.

## 6. Logovací tabulka

Plugin i skill používají stejnou logovací tabulku na Drive klienta (např. 003_admin-log). Z ní čte i samostatný hlídač, proto formát nikdy neměň.

Sloupce: datum a čas | akce | ID souboru | název souboru | původní cesta | cílová složka | důvod | způsob obnovy

- Na úrovni standard zapisuj i název souboru. Na úrovních gdpr a gdpr-strict nech sloupec s názvem prázdný.
- Zapisuj každou potvrzenou akci ze sekce 3, každý přesun do administrativní složky a u gdpr-strict každé otevření souboru z chráněné složky.
- Pokud do tabulky v tomto prostředí zapsat nemůžeš, nic neobcházej. Na konci práce vypiš záznamy přesně ve formátu sloupců, aby je Hannah mohla vložit sama.

## 7. Vztah k pluginu

- V Claude Code platí plugin data-guard. Skill se s ním nehádá: když hook akci zablokuje, nehledej jinou cestu, jak ji udělat.
- Mimo Claude Code platí jen tento skill. Pravidla dodržuj stejně přísně.

## 8. Jazyk

Názvy složek, souborů a příkazů piš anglicky. Karty a vysvětlení pro Hannah piš česky.

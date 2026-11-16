# NEXORA UX Design System

## Richting

Premium, minimalistisch, zakelijk. Warm licht thema als standaard. Merkaccenten: grafiet + diep petrol/donkergroen. Geen paarse AI-defaults, geen overdadige glow of pill-clusters.

## Tokens

| Token | Waarde | Gebruik |
| --- | --- | --- |
| `--nx-bg` | `#f4f3ef` | Pagina-achtergrond |
| `--nx-surface` | `#ffffff` | Panelen |
| `--nx-ink` | `#151a18` | Primair tekst |
| `--nx-muted` | `#5a635e` | Secundaire tekst |
| `--nx-accent` | `#1a5c4a` | CTA / actief |
| `--nx-accent-soft` | `#d9ebe4` | Soft highlight |
| `--nx-border` | `#e3e5e1` | Randen |
| `--nx-danger` | `#b42318` | Destructief |
| `--nx-warning` | `#b54708` | Waarschuwing |
| `--nx-success` | `#1a5c4a` | Succes |

## Typografie

- Display / merksignaal: `Fraunces` (serif)
- UI body: `Manrope` (sans)
- Schaal: 12 / 14 / 16 / 20 / 28 / 36

## Navigatie

- Desktop: inklapbare sidebar, actieve state, topbar met gebruiker
- Mobiel: compacte topbar + scrollbare module-links; bottom nav voor employee-kernacties
- Alleen modules tonen die entitlements toestaan

## Componentregels

- Geen niet-werkende knoppen
- Destructieve acties altijd bevestigen
- Focus-visible verplicht
- `prefers-reduced-motion` respecteren
- Nederlandse copy in eerste release

## Status

Design tokens + AppShell premium light theme geïmplementeerd in deze branch. Volledige scherm-sweep loopt door Fase F.

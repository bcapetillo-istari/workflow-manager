# Brand and Visual Language

Source: Istari Digital media kit (istaridigital.com/resources: Logos, Color Tools) and the marketing site's stylesheet. Retrieved 2026-10-26. Logos and the palette are Istari Digital trademarks; use only for Istari-delivered software.

## Palette (Revised Color Palette, June 2025)

| Name | Hex | Use in Workflow Manager |
|---|---|---|
| Istari Blue | `#24367F` | App header, primary headings, logo |
| Flight Blue | `#1A54A3` | Primary buttons, links, active nav |
| Digital Blue | `#00A2FF` | Accent, focus rings, progress, selected indicators |
| Cloud Blue | `#D8ECFF` | Tints, selected rows, informational surfaces |
| White | `#FFFFFF` | Cards, inputs |
| Black | `#121212` | Body text |

Tailwind tokens live in `ui/src/index.css` (`@theme`): `istari-blue`, `flight-blue`, `digital-blue`, `cloud-blue`, `apple-black`, ramps `brand-50..950` and `ink-50..900`, and semantic `success|warning|danger` with `-soft` variants.

## Typography

- Body and UI: Inter (variable), self-hosted via `@fontsource-variable/inter`. Matches the Istari platform UI.
- Headings (h1 to h3) and display: Exo (variable), self-hosted via `@fontsource-variable/exo`. The marketing site uses Exo for headings and Inter for paragraphs.
- Monospace for IDs and code: Roboto Mono fallback stack.

No external font or asset requests: everything is bundled, which the air-gapped deployment requires.

## Logos

`ui/public/brand/`: `istari-logo.svg` (Istari Blue), `istari-logo-white.svg`, `istari-logo-black.svg`, and the icon mark in the same three colors. The icon is also the favicon.

## Principles

- Read as a professional extension of the Istari platform, not a marketing page. White page background (chosen over a light gray during review), white cards with ink-200 borders, brand blue for structure and primary actions, one accent color for state.
- Status colors are desaturated so the blues lead.
- Density like the platform UI: compact tables, 14px body text, clear hierarchy.

## Component conventions

How the tokens are applied in `ui/src` (all styling is Tailwind utility classes on the components; no CSS modules).

| Element | Mapping |
|---|---|
| Page | `bg-ink-50`, container `max-w-6xl px-6 py-8`, section gap 6, body text 14px Inter, `text-apple-black` |
| Header (`layout/AppShell`) | `bg-istari-blue` bar, white logo (`brand/istari-logo-white.svg`, 28px), thin `white/25` divider, product name in Exo; nav links `white/70`, active = white with a 2px `digital-blue` underline (`aria-current` set by NavLink); dev-auth marker is a quiet `warning-soft` outline pill |
| Page titles (`pages/PageHeader`) | `h1` in Exo (`font-heading`) `text-2xl text-istari-blue`; lead text `text-ink-600`; eyebrow breadcrumb links in `flight-blue`; bottom `ink-200` rule |
| Section headings | `h2`/`h3` inside content use `font-sans text-xs uppercase tracking-wide text-ink-500` (Exo is reserved for page titles) |
| Buttons (`ui/Button`) | primary `bg-flight-blue hover:bg-brand-700 text-white`; secondary white + `ink-300` border, hover `ink-50`; ghost `text-flight-blue` with `cloud-blue/60` hover; danger white + `danger` text/border, hover `danger-soft`; disabled `ink-200/ink-400`; `h-9` (sm `h-8`), `rounded-md`, `font-medium`; focus ring `digital-blue` |
| Links | `text-flight-blue hover:underline`; external links carry a 12px inline external-link icon |
| Cards (`ui/Card`) | white, `border-ink-200`, `rounded-[var(--radius-card)]`, `shadow-[var(--shadow-card)]`; `interactive` adds a hover lift; `CardTitle` is Inter `font-semibold text-apple-black`; catalog cards have a 3px `istari-blue` left accent (invalid manifests: `danger/60`) |
| Badges (`ui/Badge`, `ui/StatusBadge`) | soft pills `rounded-full px-2 text-xs font-medium`: neutral `ink-100/ink-700`; muted `ink-100/ink-500` (cancelled, tags); info `cloud-blue/istari-blue` (running, in progress, collecting, submitted, provider); success `success-soft/success`; warning `warning-soft/warning`; danger `danger-soft/danger`. Live statuses add a pulsing `digital-blue` dot |
| Inputs (`ui/Field.controlClasses`) | white, `border-ink-300`, `rounded-md`, 36px tall (`py-1.5 leading-5`), focus `border-digital-blue` + `ring-2 ring-digital-blue/30`; labels `text-sm font-medium text-ink-700`, help `text-xs text-ink-500`, errors `text-xs text-danger`, required marker `text-flight-blue`; invalid `border-danger` |
| Toggle / chips | on-state `bg-flight-blue` (Toggle) or `border-flight-blue bg-cloud-blue text-istari-blue` (MultiSelect chips) |
| Picker lists (`ui/Field.pickerListClasses`, `pickerRowClasses`) | `border-ink-300` container with `divide-ink-100`; rows hover `ink-50`, selected `bg-cloud-blue text-istari-blue`; meta (extension, updated, expiry) `text-xs text-ink-500`; selected resource panel `border-brand-200 bg-cloud-blue/40` |
| Stepper (`pages/RunDetail`) | numbered 28px circles: done `bg-flight-blue` with white check, current white with `ring-2 ring-digital-blue` and `istari-blue` number, pending `ink-200/ink-500`, failed `danger`; connectors `ink-200`, done `flight-blue`; current stage name `font-medium text-apple-black`, others `ink-700` |
| Progress (`renderer/StageProgress`) | Digital Blue spinner and bar (`role=progressbar`), timeline list with `ink-200` rail, latest dot `digital-blue`, timestamps mono `text-xs text-ink-500` |
| Result views (`renderer/ViewRenderer`) | summary = definition list in a bordered panel; artifact_list = rows with a `cloud-blue` file-icon tile and `flight-blue` link; json_table = `ink-100` header, zebra `ink-50`, compact `py-1.5`; markdown/JSON = `ink-50` panel in mono |
| Tables (`pages/RunHistory`) | `ink-100` header row with `text-xs font-semibold text-ink-600`, zebra `ink-50`, hover `cloud-blue/40`, relative timestamps with the absolute time in `title` |
| Empty / error states | `EmptyState`: dashed `ink-300` border with a muted inline icon; `ErrorState`: `danger-soft/60` panel, `danger` title and icon, body `ink-700` |
| Icons | inline SVGs in `ui/icons.tsx` (check, external link, file, inbox, alert, chevron, refresh); decorative, `aria-hidden` |

Digital Blue is never used as text on white (contrast); text uses Flight Blue or Istari Blue.

## Sources

- Media kit downloads, linked from https://www.istaridigital.com/resources ("Istari Digital Logos", "Color Tools"), Dropbox folders `LOGOS` and `COLOR TOOLS`. Palette sheet: `Istari_Digital_New_Palette_6-25.pdf` and the RGB/CMYK `.ase` swatch files.
- Typography and web tokens: the marketing site stylesheet (Webflow) declares `--font-style--headings-font: "Exo Variable"` and `--font-style--paragraph-font: Inter`, with Montserrat loaded but unused in the design tokens.
- Platform UI reference: the Istari web app at demo.istari.app uses Inter with a neutral gray scale; this app mirrors that density and neutrality so it reads as part of the product.
- Trademark notice: https://docs.istaridigital.com/intro/copyright/

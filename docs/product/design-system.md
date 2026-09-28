# SocialOS Design System (v0.1)

Derived from the SocialOS logo (`SocialOS-logo.png`). The logo is a placeholder brand and may change before launch; all colors live in CSS tokens (`apps/web/app/globals.css`) so a rebrand is a token change, not a code change.

## Logo assets (`apps/web/public/brand/`)

| File | Use | Min size |
|---|---|---|
| `socialos-logo.png` | Full logo (mark + wordmark) on light backgrounds | 120 px wide |
| `socialos-logo-dark.png` | Full logo with white wordmark, for dark backgrounds | 120 px wide |
| `socialos-mark.png` / `-512.png` | Icon only: collapsed sidebar, avatars, loading states | 24 px |
| `apple-touch-icon.png`, `favicon-32.png` | Browser and home-screen icons | — |

Placement rules:
- App sidebar: full logo at 132–148 px wide; collapsed sidebar uses the mark at 28 px.
- Auth pages: full logo centered, 180–200 px wide, above the form.
- Keep clear space around the logo equal to the height of the "O" in the wordmark.
- Never recolor, stretch, or place the light logo on a dark surface; use the dark variant.

## Color

Sampled from the logo, then adjusted for UI contrast.

| Token | Light | Dark | Source / use |
|---|---|---|---|
| `--brand-ink` | `#0B1A3E` | `#F4F7FF` | Wordmark navy; primary text |
| `--brand-blue` | `#1453F5` | `#4C7DFF` | Core of the mark; primary buttons, links, focus |
| `--brand-blue-hover` | `#0E42D1` | `#6B93FF` | Primary hover |
| `--brand-cyan` | `#0BC3F5` | `#3DD3FA` | Mark's cyan end; accents, charts |
| `--brand-violet` | `#6A3DF7` | `#8E6BFF` | "OS" gradient end, top dot; highlights, AI features |
| `--brand-gradient` | cyan → blue → violet, 135° | same | Hero areas, selected nav pill, empty states. Use sparingly; never behind body text |
| `--bg` | `#F6F8FC` | `#0A1128` | Page background |
| `--surface` | `#FFFFFF` | `#111A36` | Cards, panels |
| `--surface-2` | `#EEF2FA` | `#17223F` | Inputs, hover rows |
| `--border` | `#DCE3F0` | `#26324F` | Dividers, input borders |
| `--muted` | `#5B6788` | `#9AA6C4` | Secondary text |
| `--success` | `#12B76A` | `#32D583` | Published |
| `--warning` | `#F79009` | `#FDB022` | Needs check, retrying |
| `--danger` | `#E5383B` | `#F97066` | Failed, validation errors |

Text on `--brand-blue` is always white (contrast ≥ 4.5:1).

### Post status colors

| Status | Color token |
|---|---|
| Draft | `--muted` |
| Scheduled | `--brand-blue` |
| Publishing / processing / retrying | `--brand-cyan` |
| Published | `--success` |
| Needs check / missed / paused | `--warning` |
| Failed / needs revision | `--danger` |

## Typography

- **Font:** Plus Jakarta Sans (geometric, rounded terminals; close to the wordmark), loaded with `next/font`. Fallback: system-ui.
- **Scale:** 12 / 14 (body) / 16 / 20 / 24 / 32 px. Headings 600–700 weight; body 400–500.
- Numbers in tables and the calendar use tabular figures.

## Shape and spacing

- Radius: 8 px inputs and buttons, 12 px cards, 999 px pills and status badges (echoes the rounded mark).
- Spacing: 4 px base grid (4, 8, 12, 16, 24, 32, 48).
- Elevation: one soft shadow for cards and popovers; no heavy drop shadows.

## Components (initial set)

Buttons (primary, secondary, ghost, danger), input, textarea with character counter, select, toggle, badge/status pill, card, tabs, calendar cell, media thumbnail, platform chip (with network icon), toast, modal, empty state.

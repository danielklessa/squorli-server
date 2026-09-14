# Squorli – Logo & Design Palette

Dark Mode is the default. The primary color #6397FF sits on night blue #0C1424. Buttons use the stronger #246BFD with white text.

The fuller, round speech figures follow the original draft more closely. The icon mark adopts the three circling speech figures of the selected draft. The outlines have been redrawn as smooth Bézier curves and the figures arranged in 120° steps. The eyes are real cut-outs. The custom-drawn, rounded wordmark is built entirely from vector geometry: no fonts, embedded images or external dependencies.

## Files
- AGENTS.md: instructions for AI assistants on embedding and applying the package. Read it first when integrating and reference it from the project AGENTS.md.
- squorli-logo.svg: default logo for dark backgrounds; identical to squorli-logo-dark.svg.
- squorli-icon.svg: default icon mark without wordmark; identical to squorli-icon-blue.svg.
- squorli-icon-blue.svg: icon mark without wordmark, transparent.
- squorli-logo-blue.svg: icon mark above wordmark, uniformly blue, transparent.
- squorli-logo-horizontal.svg: light blue icon mark with light wordmark, for dark surfaces.
- squorli-logo-dark.svg: light blue icon mark and light wordmark, for dark surfaces.
- squorli-icon-white.svg: single-color white, transparent.
- squorli-icon-small.svg: simplified variant without eyes for 16–24 px.
- squorli-tokens.css / palette.json: design colors for adoption in the app.
- designpalette.svg: visual overview of the palette.
- brand-guide.html: logo overview, usage examples and colors.
- BRAND_ORIGIN.md: origin of the name (squad, swirl, circle), pronunciation, brand statement and how the logo relates to it.

## Usage
At least 32 px for the normal icon mark; below that, use the small variant. At least 160 px width for the vertical logo; at least 240 px for the horizontal version. Clear space on all sides of at least 1/8 of the icon mark's width. Do not distort or rotate the shapes. Use primarily flat colors. The blue holds the identity together; Mint, Amber and Coral remain status colors and should be supplemented by text or a symbol.

For UI text, a humanist sans-serif is suitable, e.g. Segoe UI with system-ui as fallback. 16 px body text, 14 px metadata, 24/32 px headings; line height 1.5. The wordmark is deliberately standalone and is not used as a UI typeface. Controls get a 12 px radius, larger panels 20 px; spacing follows a 4 px grid.

## Color Palette
- Squorli Blue: #6397FF — Brand color, icon mark, links and focus
- Action: #246BFD — Primary buttons with white text
- Action Hover: #1856D8 — Hover for primary buttons
- Selection: #243E68 — Selected channels and active navigation
- Raised: #1E2D47 — Menus, inputs and raised surfaces
- Night: #0C1424 — Dark app background
- Surface: #162238 — Channels and panels
- Cloud: #F5F8FF — Primary text and wordmark
- Muted: #A9B8D2 — Secondary text in Dark Mode
- Mint: #42D6AE — Online / success
- Amber: #FFC568 — Away / notice
- Coral: #FF7F91 — Error / do not disturb

## Calculated Contrasts (sRGB)
- #FFFFFF on #246BFD: 4.57:1
- #F5F8FF on #0C1424: 17.31:1
- #A9B8D2 on #162238: 7.93:1
- #6397FF on #0C1424: 6.49:1
- #F5F8FF on #243E68: 10.06:1

The listed text combinations each reach at least 4.5:1. Do not use light status colors as small text on a white background.

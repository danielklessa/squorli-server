# Squorli – Instructions for AI Assistants

## Purpose and Scope

Product names, domains, open-source boundaries, documentation language and cross-project synchronization are defined in [PRODUCT.md](PRODUCT.md). It is part of this package and must remain synchronized across squorli-server, squorli-directory and squorli-website. The server's docs/brand directory is canonical. Use the website's `pnpm brand:sync` and `pnpm brand:check` to maintain every package and selected runtime asset copy.

This package is the approved visual foundation for Squorli, a chat and voice application for gaming and creator communities. Use these rules when embedding the included assets and when designing Squorli interfaces. They do not replace project-specific development, security or testing requirements. Explicit current user instructions take precedence over these brand recommendations.

The current design is version 2: **Dark Mode as the default, blue logos and full, round speech figures**. Do not use older purple grid drafts or an earlier, slimmer SVG version as an implementation template.

## How to Use the Package

1. Read this file and `README.md`. Open `brand-guide.html` for the visual context and look at the chosen SVG file.
2. Copy the required SVGs and `squorli-tokens.css` into the asset directory of the target project. Keep the meaningful file names. Use the SVGs directly; the PNGs are previews.
3. Import the CSS tokens once in a suitable place. If there is an existing design system, map their values onto its semantic tokens. Use `palette.json` as the machine-readable color source.
4. Design the interface in Dark Mode first. Add a Light Mode only if it is part of the assignment. `color-scheme: dark` alone does not style an interface: background, text and component colors must be assigned explicitly.
5. Choose the logo using the table below, set meaningful alternative text and check rendering, contrast and scaling in the actual target medium.
6. Finish with a brief report of which assets were embedded and which relevant renderings were checked.

If this file lives only in an asset subfolder, some assistants will not automatically read it for the whole application. When integrating, therefore reference this file from the existing project `AGENTS.md`. Do not overwrite an existing project `AGENTS.md` with the contents of this package.

## Mandatory Design Rules

- Write the brand name as **Squorli**.
- The brand mark consists of three full, round, circling speech figures. Preserve their proportions, eyes and gaps.
- Primary appearance: light blue icon mark `#6397FF`, light wordmark `#F5F8FF`, dark background `#0C1424`.
- The SVG logos are transparent. The dark background is added in the target medium, not treated as a supposed part of the logo.
- Use the existing vector geometry. In a normal integration, do not recreate it with CSS, emoji, icon libraries or image generation.
- The wordmark is standalone vector geometry. Do not replace it with typed text in a similar typeface.
- No distortion, rotation, gradients, shadows, outlines or individual recoloring of the single figures. No permanent logo animations.
- Routine integration, responsive arrangement and token mapping need no additional brand approval. Changes to the brand shape belong only to an explicit redesign assignment.

## Which Asset to Use?

| File | Use |
| --- | --- |
| `squorli-logo.svg` | Default logo: icon mark above the light wordmark, for dark backgrounds. |
| `squorli-icon.svg` | Default icon mark without wordmark: app icon, avatar, compact navigation. |
| `squorli-logo-horizontal.svg` | Horizontal variant with light wordmark, e.g. website header. |
| `squorli-icon-small.svg` | Simplified variant without eyes for 16–24 px; also preferred below 32 px. |
| `squorli-icon-white.svg` | Single-color white brand mark on a sufficiently dark background. |
| `squorli-logo-blue.svg` | Fully blue special variant; check contrast in the target medium. |
| `squorli-logo-dark.svg` | Identical to the default logo `squorli-logo.svg`. |
| `squorli-icon-blue.svg` | Identical to the default icon mark `squorli-icon.svg`. |
| `squorli-logo-preview.png` | Preview with background; do not use as the primary logo source. |
| `designpalette.svg`, `designpalette.png` | Color overviews, not logos. |

The normal icon mark must be at least 32 px wide; the vertical logo at least 160 px, the horizontal one at least 240 px. Preserve the aspect ratio and leave at least 1/8 of the icon mark's width as clear space from other elements. Do not crop the SVG viewBox automatically. The minimum sizes are design guidelines; check legibility in the actual rendering.

## Palette and Semantic Mapping

| CSS token | Value | Role |
| --- | --- | --- |
| `--sq-bg`, `--sq-night` | `#0C1424` | App background |
| `--sq-surface` | `#162238` | Channel lists, panels, message areas |
| `--sq-raised` | `#1E2D47` | Menus, inputs, raised surfaces |
| `--sq-selection` | `#243E68` | Active navigation and selection |
| `--sq-text`, `--sq-cloud` | `#F5F8FF` | Primary text and wordmark |
| `--sq-muted` | `#A9B8D2` | Secondary text and timestamps |
| `--sq-squorli-blue` | `#6397FF` | Brand color, links, focus |
| `--sq-action` | `#246BFD` | Primary button background |
| `--sq-action-hover` | `#1856D8` | Primary button hover |
| `--sq-mint` | `#42D6AE` | Online / success |
| `--sq-amber` | `#FFC568` | Away / notice |
| `--sq-coral` | `#FF7F91` | Error / do not disturb |

Distinguish between brand blue and action blue. On primary buttons the text is **pure white `#FFFFFF`**: this combination was calculated at 4.57:1. Do not replace the white button text with Cloud without checking. Use status colors deliberately and always add text or a distinguishable symbol; color alone must not convey a state.

The calculated color contrasts are listed in `palette.json`. They apply to exactly the specified, fully opaque color pairings. Transparency, other backgrounds and differing states require a new check. The contrast values are not a blanket accessibility certification of the application.

## Typography, Spacing and Behavior

- UI font: `"Segoe UI", system-ui, sans-serif`. Do not load an additional font file for the wordmark.
- Body text 16 px, metadata 14 px, headings 24/32 px; body text line height 1.5.
- Spacing follows a 4 px grid (`--sq-space-unit`).
- Controls: 12 px radius (`--sq-radius-control`). Larger panels: 20 px (`--sq-radius-panel`).
- The interface should feel friendly, calm and focused on conversations. Blue emphasizes actions; not every surface should be blue.
- Interactive elements need visible keyboard focus. Respect reduced motion in animations. Examples in the brand guide are visual demonstrations, not finished interactive components.

## Minimal Web Example

The following paths are examples; adapt them to the target project.

```html
<link rel="stylesheet" href="/assets/squorli/squorli-tokens.css">
<a class="brand" href="/" aria-label="Squorli – Home">
  <img src="/assets/squorli/squorli-logo-horizontal.svg"
       alt="" width="280" height="90">
</a>
<button class="sq-primary" type="button">Join voice channel</button>
```

```css
body {
  background: var(--sq-bg);
  color: var(--sq-text);
  font-family: "Segoe UI", system-ui, sans-serif;
  font-size: 16px;
  line-height: 1.5;
}
.brand { display: inline-block; padding: 16px; }
.brand img { display: block; width: 280px; height: auto; }
.sq-primary {
  background: var(--sq-action);
  color: #FFFFFF;
  border: 0;
  border-radius: var(--sq-radius-control);
  padding: 12px 20px;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.sq-primary:hover { background: var(--sq-action-hover); }
:is(.brand, .sq-primary):focus-visible {
  outline: 3px solid var(--sq-squorli-blue);
  outline-offset: 4px;
}
```

If an image alone conveys the brand, use `alt="Squorli"`. For a link that is already clearly labeled, or with the brand name placed directly adjacent, `alt=""` can avoid duplicate announcements. The actual button functionality must be implemented in the target project.

## Review and Maintenance

- Check the chosen SVG on a transparent background and on the intended dark background, at normal size and at the smallest size used.
- Check responsive views and keyboard focus. The logo must be neither squashed nor cropped.
- Do not reference absolute paths from the authoring environment or files outside the delivered package.
- For authorized brand changes, update the affected SVGs, alias files, CSS tokens, `palette.json`, previews and documentation together. The default aliases must not diverge from their documented counterparts.
- If the package is re-archived, include this `AGENTS.md` and all referenced files. Verify the ZIP contents.
- The brand package does not establish any trademark rights or permanently available domains and accounts. Do not derive such claims from the assets.

# Asset prompts

> **Resolved.** The aperture (1a) won and ships as the mark; the plate from §2
> ships as the social card. What follows is kept as the record of what was
> asked for and why, and as the brief to re-run if the brand ever moves.
>
> **What was chosen, and what changed in the drawing.** Of the three logo
> options, the enclosed field read as a dice face and the severed thread lost
> its gaps below about 48px — which inverted its meaning, since the gaps *are*
> the argument. The aperture survived. It was then redrawn from scratch as
> vector geometry rather than traced: the generated version had six irregular
> blades with hooked tips that merged into a blob at 16px, so it is three even
> blades now, at the size a favicon actually renders. `npm run brand`
> regenerates every raster from that one definition.
>
> **On watermarks.** None of the five images carried a visible one. What they
> carry is a C2PA content credential — a signed manifest from Grok Imagine
> recording that the image is AI-generated. That is a provenance signal rather
> than a badge on the artwork, so it was left alone. It costs nothing: the
> logo is new geometry with no bitmap in it, and the social card is composited
> fresh.
>
> Source images live in `docs/brand/`. They are deliberately not in `public/`,
> which would serve them to anyone.

---

Generate these, drop the files where each section says, and tell me — I'll wire
them in. Everything is monochrome on purpose: ink `#121214`, paper `#f3f2f0`,
white `#ffffff`. No gradients, no colour, no third tone.

---

## 1. The logo

The mark has to work at 16px in a browser tab and at 512px on a home screen,
so it must be one idea, not a picture. What Lumen does is hold a whole picture
so nothing else can assemble it — a container, or a boundary around something.
Avoid: eyes (surveillance products all use them), shields (every crypto wallet),
locks (every privacy app), keyholes, light bulbs.

Generate **all three** and send them; I'll pick against real sizes.

### 1a — the aperture

```
A minimalist geometric logo mark. A perfect circle rendered as six thick
equal arcs separated by narrow gaps, like a camera aperture closed most of
the way, leaving a small solid circle at the very centre. Pure flat vector,
absolutely no gradient, no shadow, no texture, no 3D. Solid black #121214 on
a plain #f3f2f0 background. Thick uniform stroke weight, rounded stroke caps.
Perfectly centred, generous even margin on all four sides, no text, no
letters, no wordmark. Crisp geometric construction, the kind of mark that
stays legible at 16 pixels. Flat vector logo, icon design, Swiss graphic
design.
```

### 1b — the enclosed field

```
A minimalist geometric logo mark. A rounded square outline drawn in one thick
uniform stroke, and inside it a loose scatter of seven small solid dots of
slightly different sizes, with no lines connecting any of them. The dots sit
clearly inside the boundary with clean space around them. Pure flat vector,
absolutely no gradient, no shadow, no texture, no 3D. Solid black #121214 on
a plain #f3f2f0 background. Rounded stroke caps, perfectly centred, generous
even margin on all four sides, no text, no letters, no wordmark. Flat vector
logo, icon design, Swiss graphic design.
```

### 1c — the severed thread

```
A minimalist geometric logo mark. Two solid circles of equal size, one upper
left and one lower right, with a single thick straight line running between
them that stops short at both ends, leaving a clear gap before each circle so
nothing actually touches. Pure flat vector, absolutely no gradient, no
shadow, no texture, no 3D. Solid black #121214 on a plain #f3f2f0 background.
Thick uniform stroke weight, rounded stroke caps, perfectly centred, generous
even margin on all four sides, no text, no letters, no wordmark. Flat vector
logo, icon design, Swiss graphic design.
```

**Deliver as:** `docs/brand/logo-a.png`, `logo-b.png`, `logo-c.png` — 1024×1024,
transparent or `#f3f2f0` background. PNG is fine; I'll trace it to clean SVG
paths by hand so the mark stays sharp at every size and inherits `currentColor`.
Do not send a generated SVG — image models produce unusable path soup.

---

## 2. Social card (Open Graph)

One image, shown when the link is pasted into X, Discord, Telegram or Slack.
It is the single most-seen asset we have and we currently have none.

```
A wide 1200x630 editorial graphic, entirely black and white, no colour
anywhere. Background is flat warm off-white #f3f2f0 with no gradient and no
texture. Scattered across the frame are about thirty small solid black dots
of slightly varying sizes, grouped into loose clusters, with thin hairline
straight lines connecting some of them into a sparse constellation. The
network is dense in the upper right and sparse in the lower left, and the
lines are very fine and light. Wide empty margins. Minimal Swiss graphic
design, editorial data visualisation, extremely clean, high contrast,
absolutely no text, no letters, no numbers, no words, no watermark, no logo,
no user interface elements.
```

**Deliver as:** `docs/brand/og.png` — exactly 1200×630. I overlay the headline
in our real typeface, so the image must contain **no text at all**.

---

## 3. Optional — a scroll poster for the mid-page break

Only if you want a full-bleed still between chapters. The film covers the top
of the page already, so this is a nice-to-have.

```
A tall vertical black and white photograph-like graphic, no colour anywhere.
Pure black #121214 background. A sparse constellation of small white dots
scattered across the frame with a few very thin white hairlines connecting
some of them, gradually thinning out toward the bottom of the frame until the
lower third is almost empty black. Deep negative space, very high contrast,
no glow, no bloom, no lens flare, no stars, no galaxy, no nebula. Minimal
Swiss graphic design, absolutely no text, no letters, no logo, no watermark.
```

**Deliver as:** `docs/brand/poster.png` — 1400×1800 or larger.

---

## Where each asset ended up

| Asset | Lives in | Rebuilt by |
| --- | --- | --- |
| The mark | `LumenMark` in [icons.tsx](../src/components/lumen/icons.tsx) | by hand |
| App tile | `public/icon.svg` | by hand, kept in step with the above |
| Launcher icons | `public/icon-{180,192,512}.png` | `npm run brand` |
| Social card | `public/og.png` | `npm run brand` |

The geometry appears three times — in `LumenMark`, in `icon.svg`, and in
`GEOMETRY` at the top of [brand.mjs](../scripts/brand.mjs). Change one and
change all three, or the favicon quietly stops matching the app.

## What I am not asking you to generate

The film is drawn in code, not from images — that is why it costs a few
kilobytes, scrubs exactly with the scroll and stays sharp at every density.
A video file would be megabytes, would buffer, and could not hold the palette.
So there is no trailer footage to generate; `npm run film` renders its frames
as stills whenever you want to look at them.

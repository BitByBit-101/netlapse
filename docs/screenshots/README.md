# Screenshots

Drop seven PNGs here using these **exact** filenames. The main
[README](../../README.md#-gallery) references them directly, so the gallery
works as soon as the files exist — no other edits needed.

The layout is a 3 × 1 × 3 grid, so **`04.png` is displayed at full width** while
the other six render at roughly a third each:

```
┌─────────┬─────────┬─────────┐
│  01.png │  02.png │  03.png │
├─────────┴─────────┴─────────┤
│           04.png            │   ← wide, spans all three columns
├─────────┬─────────┬─────────┤
│  05.png │  06.png │  07.png │
└─────────┴─────────┴─────────┘
```

| File | Suggested shot | Where |
|:--|:--|:--|
| `01.png` | Latency chart with the 1h / 24h / 7d buttons visible | `#/app` → **Latency** |
| `02.png` | DNS timeline showing a record rotation | `#/app` → **DNS** |
| `03.png` | Cross-signal chronological history | `#/app` → **Timeline** |
| `04.png` | **Wide.** The landing hero, or the dashboard at full width | `/` |
| `05.png` | A diff with changed fields showing | `#/app` → **Diff** |
| `06.png` | The 3D traceroute at a readable angle | `#/app` → **Twin** |
| `07.png` | The seven-day availability heatmap | `#/app` → **Weather** |

The middle image is the one people actually look at, so give it the most
striking view. Everything else is a supporting thumbnail.

## Tips

- **Capture with real history.** Let the collectors run overnight first — a
  screenshot of an empty timeline undersells the entire project. A domain that
  changes often (`google.com` rotates its A records every few minutes) shows far
  better than a static one.
- **Frame the six thumbnails tight.** They render at about a third of the README
  width, so a full 1920-px desktop screenshot becomes illegible. Narrowing the
  browser below ~1024 px collapses the sidebar into a drawer and lets the
  content fill the frame.
- **Width 1200–1600 px** for the thumbnails, wider for `04.png`. Capture at 2×
  device pixel ratio if you can — it stays crisp on high-DPI screens.
- **Keep each under ~500 KB.** Run them through [TinyPNG](https://tinypng.com)
  or `pngquant`: git keeps images forever, and they are the fastest way to bloat
  a clone.
- Windows: `Win` + `Shift` + `S`. Any browser: `F12` → device toolbar to pin an
  exact viewport, so all seven come out consistent.

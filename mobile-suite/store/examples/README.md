# Suite icon examples — home-screen opacity GO

Option **5** is the chosen store icon. Layering is navy tile → white
outlined paper box → opacity **GO** (clipped inside the box) → sky fold
and lines. That matches Suite login `lr-b` (Saira Condensed, ~18%)
without letting the letters sit outside the page.

Examples 1–4 keep the earlier “GO behind the document” previews for
comparison. They do not ship as Play / App Store icons.

| # | Folder | Treatment |
|---|--------|-----------|
| 1 | `1-home-18` | Home-screen 18% white GO behind the box |
| 2 | `2-home-26` | Stronger 26% white GO behind the box |
| 3 | `3-home-12` | Softer 12% white GO, a little wider |
| 4 | `4-home-sky` | 18% sky `#38BDF8` GO behind the box |
| 5 | `5-home-high` | **Chosen:** option 5 GO inside the white outlined box |

Official Play 512 / App Store 1024 are generated from
`generate-icons.py` (`compose` → `paint_boxed_mark`).

```bash
python3 mobile-suite/store/generate-icons.py
python3 mobile-suite/store/generate-go-examples.py
```

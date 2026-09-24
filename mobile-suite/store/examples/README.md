# Suite icon examples — Go in the background

Five treatments of the navy document mark with **Go** behind it.
These do **not** replace the current Play / App Store icons until one is chosen.

Each folder has both store sizes:

- `icon-play-512.png` — Google Play high-res (32-bit, opaque)
- `icon-appstore-1024.png` — App Store (RGB, no alpha)

| # | Folder | Treatment |
|---|--------|-----------|
| 1 | `1-soft-navy` | Stacked G / O in lifted navy |
| 2 | `2-login-watermark` | Stacked G / O in paper-white, same idea as the Suite login |
| 3 | `3-sky-stacked` | Stacked G / O in sky `#38BDF8` |
| 4 | `4-side-letters` | Sky **G** top-left and **O** bottom-right |
| 5 | `5-inline-amber` | Amber **GO** word behind the document |

Regenerate:

```bash
python3 mobile-suite/store/generate-go-examples.py
```

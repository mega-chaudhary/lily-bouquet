# ASCII Lily Bouquet

A 3D lily bouquet drawn entirely with text characters. Stems grow, leaves unfurl, buds swell and eleven lilies bloom one by one.

Built with React + Vite. The 3D engine (curved petal surfaces, a small software rasteriser, lighting and ASCII shading) is plain JavaScript in `src/engine/`.

**Controls:** click / tap or press `R` to replay, `Space` to pause.

## Just look at it

Double-click `index.html` (or `docs/index.html`). It opens in your browser – nothing to install.

## Put it online with GitHub Pages

1. Create a new **empty** repository on GitHub, for example `lily-bouquet`.
2. Upload everything in this folder to it. Either:
   - **No terminal:** on the repo page click **uploading an existing file**, drag in all the files and folders from this folder (including `docs` and `.github`), then **Commit changes**; or
   - **Terminal:**
     ```bash
     git init
     git add .
     git commit -m "ASCII lily bouquet"
     git branch -M main
     git remote add origin https://github.com/YOUR-USERNAME/lily-bouquet.git
     git push -u origin main
     ```
3. On GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, Branch: **main**, folder **/ (root)** or **/docs** (both work) → **Save**.
4. Wait 1–2 minutes, then open `https://YOUR-USERNAME.github.io/lily-bouquet/`.

The ready-built site lives in `docs/index.html`. If you open the repo root, it forwards there automatically.

*Optional:* if you prefer automatic rebuilds, set **Source: GitHub Actions** instead – the included workflow builds and deploys on every push to `main`.

## Edit the code

You need [Node.js](https://nodejs.org) (version 18 or newer).

```bash
npm install
npm run dev      # live preview at http://localhost:5173
npm run build    # writes the finished site to docs/index.html
```

After changing anything, run `npm run build` and push again so `docs/index.html` is updated.

| What | Where |
| --- | --- |
| Flower positions, sizes, colours | `FLOWERS` and `BUDS` in `src/engine/scene.js` |
| Flower colour palette | `HEX` in `src/engine/scene.js` |
| Character size, brightness, colour fill, characters used | `SETTINGS` in `src/engine/renderer.js` |
| Glow strength | `.bouquet__glow` in `src/components/LilyBouquet.css` |

Tip: add `?t=6` to the URL to show one frozen frame, handy for screenshots.

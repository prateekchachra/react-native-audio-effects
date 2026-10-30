# Brand assets

`icon.svg` — the app icon, a tile. `logo.svg` — the README lockup, which
uses `currentColor` for the wordmark so it reads on a light or dark page.

`scope-chord-1.png`, `scope-chord-2.png` — the same chord three seconds
apart, which is how a still shows that the trace moves. Captured from the
example app on an iPhone 17 Pro and downscaled to 349px wide, since the
README renders them at 300 and the @3x originals were ten times the size.

None of this ships to npm: `files` in `package.json` is an allowlist and
does not include this directory. The README therefore has to reference
them by absolute `raw.githubusercontent.com` URL, or they break on npm.

## Regenerating the example app's icons

macOS has no SVG rasteriser on the path, but Quick Look will render one
and `sips` can resize the result.

```sh
qlmanage -t -s 1024 -o /tmp/icon assets/icon.svg
SRC=/tmp/icon/icon.svg.png

IOS=example/ios/AudioEffectsExample/Images.xcassets/AppIcon.appiconset
for pair in "40 icon-20@2x" "60 icon-20@3x" "58 icon-29@2x" "87 icon-29@3x" \
            "80 icon-40@2x" "120 icon-40@3x" "120 icon-60@2x" \
            "180 icon-60@3x" "1024 icon-1024"; do
  px="${pair%% *}"; name="${pair##* }"
  sips -z "$px" "$px" "$SRC" --out "$IOS/$name.png"
done

AND=example/android/app/src/main/res
for pair in "48 mdpi" "72 hdpi" "96 xhdpi" "144 xxhdpi" "192 xxxhdpi"; do
  px="${pair%% *}"; d="${pair##* }"
  sips -z "$px" "$px" "$SRC" --out "$AND/mipmap-$d/ic_launcher.png"
  sips -z "$px" "$px" "$SRC" --out "$AND/mipmap-$d/ic_launcher_round.png"
done
```

Use `${pair%% *}` rather than `set -- $pair`: zsh does not word-split an
unquoted parameter by default, so the positional form silently writes
every file to the same wrong path. Check `git diff --stat` afterwards —
the stock React Native launcher icons are already 48 through 192, so
matching dimensions do not prove anything was replaced.

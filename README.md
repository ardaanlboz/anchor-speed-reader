# Anchor Reader

A self-contained speed-reading web app with:

- adjustable words-per-minute playback
- pivot-letter highlighting for each word
- fixed top and bottom focus ticks to steady your eyes
- pasted text input
- upload support for readable text files like `.txt`, `.md`, `.rtf`, and `.html`
- PDF upload that extracts selectable text and falls back to OCR for scanned pages
- natural punctuation pauses you can toggle on or off
- an `Extend` reader mode that stretches the reader full-width and stacks the tools below
- local autosave of your last text, settings, and reading position
- a nearby context view so you can stay oriented

## Run

Open [`index.html`](./index.html) directly in a browser.

If you prefer a local server:

```bash
python3 -m http.server
```

Then visit `http://localhost:8000`.

If you want the exact commands from this folder:

```bash
cd /Users/ardaanilboz/Desktop/speedread
python3 -m http.server 8000
```

## Controls

- `Play` / `Pause` starts and stops the reader
- `Back`, `Next`, and `Restart` move through the text
- `Speed` adjusts playback from `100` to `1000` WPM
- `Word size` scales the reader display
- `Extend` expands the reader across the page and moves the other panels below it
- `Position` scrubs through the loaded text
- `Natural pauses` toggles punctuation-aware timing
- `Space`, `Left Arrow`, and `Right Arrow` work as keyboard shortcuts when focus is not inside an input

## PDF Notes

- PDF uploads use PDF.js in the browser to extract text client-side
- When a PDF has no selectable text, the app falls back to OCR in the browser
- OCR is slower than normal PDF text extraction
- Scanned PDFs can still be imperfect depending on image quality

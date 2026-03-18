const state = {
  words: [],
  currentIndex: 0,
  isPlaying: false,
  isExtended: false,
  wpm: 350,
  fontSize: 88,
  naturalPauses: true,
  timerId: null,
  sourceName: "",
  rawText: "",
};

const STORAGE_KEY = "anchor-reader-state-v1";
const PDF_WORKER_SRC = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
const AVERAGE_READING_WPM = 250;
const sampleText = `Speed reading works best when your eyes have a stable place to aim. Anchor Reader keeps the pivot letter fixed, so each new word lands in the same visual position while you control the pace. Load your own chapter, article, or notes and settle into a cleaner rhythm.`;

const elements = {
  textInput: document.querySelector("#textInput"),
  loadTextButton: document.querySelector("#loadTextButton"),
  clearButton: document.querySelector("#clearButton"),
  sampleButton: document.querySelector("#sampleButton"),
  fileInput: document.querySelector("#fileInput"),
  pdfInput: document.querySelector("#pdfInput"),
  dropZone: document.querySelector("#dropZone"),
  statusMessage: document.querySelector("#statusMessage"),
  sourceLabel: document.querySelector("#sourceLabel"),
  wordCount: document.querySelector("#wordCount"),
  wordLeft: document.querySelector("#wordLeft"),
  wordPivot: document.querySelector("#wordPivot"),
  wordRight: document.querySelector("#wordRight"),
  playButton: document.querySelector("#playButton"),
  extendButton: document.querySelector("#extendButton"),
  backButton: document.querySelector("#backButton"),
  nextButton: document.querySelector("#nextButton"),
  restartButton: document.querySelector("#restartButton"),
  speedSlider: document.querySelector("#speedSlider"),
  speedNumber: document.querySelector("#speedNumber"),
  averageTimeValue: document.querySelector("#averageTimeValue"),
  currentSpeedTimeValue: document.querySelector("#currentSpeedTimeValue"),
  timeSavedValue: document.querySelector("#timeSavedValue"),
  sizeSlider: document.querySelector("#sizeSlider"),
  sizeValue: document.querySelector("#sizeValue"),
  seekSlider: document.querySelector("#seekSlider"),
  naturalPauseToggle: document.querySelector("#naturalPauseToggle"),
  progressLabel: document.querySelector("#progressLabel"),
  percentLabel: document.querySelector("#percentLabel"),
  readingTime: document.querySelector("#readingTime"),
  contextPreview: document.querySelector("#contextPreview"),
};

function tokenize(text) {
  return text.match(/\S+/g) ?? [];
}

function looksLikeHtml(text) {
  return /<[^>]+>/.test(text);
}

function looksLikeRtf(text) {
  return text.trimStart().startsWith("{\\rtf");
}

function stripHtml(text) {
  const doc = new DOMParser().parseFromString(text, "text/html");
  return doc.body.textContent || "";
}

function stripRtf(text) {
  return text
    .replace(/\\par[d]?/g, "\n")
    .replace(/\\tab/g, "\t")
    .replace(/\\'[0-9a-fA-F]{2}/g, (match) =>
      String.fromCharCode(parseInt(match.slice(2), 16))
    )
    .replace(/\\u(-?\d+)\??/g, (_, codePoint) => {
      const value = Number(codePoint);
      return String.fromCharCode(value < 0 ? value + 65536 : value);
    })
    .replace(/\\[a-zA-Z]+-?\d* ?/g, "")
    .replace(/[{}]/g, "");
}

function extractReadableText(text) {
  if (looksLikeRtf(text)) {
    return stripRtf(text);
  }

  if (looksLikeHtml(text)) {
    return stripHtml(text);
  }

  return text;
}

function hasPdfParser() {
  return typeof window.pdfjsLib !== "undefined";
}

function hasOcrParser() {
  return typeof window.Tesseract !== "undefined";
}

function configurePdfParser() {
  if (!hasPdfParser()) {
    return false;
  }

  window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;
  return true;
}

function getPrintableRatio(text) {
  const sample = text.slice(0, 2000);

  if (!sample) {
    return 1;
  }

  const printable = [...sample].filter((char) => {
    if (char === "\n" || char === "\r" || char === "\t") {
      return true;
    }

    const code = char.charCodeAt(0);
    return code >= 32 && code !== 65533;
  }).length;

  return printable / sample.length;
}

function getPivotIndex(word) {
  const characters = [...word];
  const anchorable = characters
    .map((character, index) => ({ character, index }))
    .filter(({ character }) => /[\p{L}\p{N}]/u.test(character));

  const usableCharacters = anchorable.length ? anchorable : characters.map((character, index) => ({ character, index }));
  const length = usableCharacters.length;

  if (!length) {
    return 0;
  }

  let pivotOffset = 0;

  if (length <= 1) {
    pivotOffset = 0;
  } else if (length <= 5) {
    pivotOffset = 1;
  } else if (length <= 9) {
    pivotOffset = 2;
  } else if (length <= 13) {
    pivotOffset = 3;
  } else {
    pivotOffset = 4;
  }

  return usableCharacters[Math.min(pivotOffset, length - 1)].index;
}

function renderWord() {
  const word = state.words[state.currentIndex] || "steady";
  const characters = [...word];
  const pivotIndex = getPivotIndex(word);

  elements.wordLeft.textContent = characters.slice(0, pivotIndex).join("");
  elements.wordPivot.textContent = characters[pivotIndex] || "";
  elements.wordRight.textContent = characters.slice(pivotIndex + 1).join("");
}

function formatDurationFromMinutes(totalMinutes) {
  if (totalMinutes <= 0) {
    return "0 min";
  }

  const roundedMinutes = Math.round(totalMinutes);
  const hours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;

  if (hours === 0) {
    return `${minutes} min`;
  }

  if (minutes === 0) {
    return `${hours} hr`;
  }

  return `${hours} hr ${minutes} min`;
}

function renderTimeComparison() {
  const total = state.words.length;

  if (!total) {
    elements.averageTimeValue.textContent = "0 min";
    elements.currentSpeedTimeValue.textContent = "0 min";
    elements.timeSavedValue.textContent = "0 min";
    return;
  }

  const averageMinutes = total / AVERAGE_READING_WPM;
  const currentMinutes = total / state.wpm;
  const savedMinutes = averageMinutes - currentMinutes;

  elements.averageTimeValue.textContent = formatDurationFromMinutes(averageMinutes);
  elements.currentSpeedTimeValue.textContent = formatDurationFromMinutes(currentMinutes);
  elements.timeSavedValue.textContent =
    savedMinutes >= 0
      ? `${formatDurationFromMinutes(savedMinutes)} saved`
      : `${formatDurationFromMinutes(Math.abs(savedMinutes))} slower`;
}

function renderProgress() {
  const total = state.words.length;
  const current = total ? state.currentIndex + 1 : 0;
  const percent = total ? Math.round((current / total) * 100) : 0;

  elements.progressLabel.textContent = `${current} / ${total}`;
  elements.percentLabel.textContent = `${percent}%`;
  elements.seekSlider.max = String(Math.max(total - 1, 0));
  elements.seekSlider.value = String(Math.min(state.currentIndex, Math.max(total - 1, 0)));
  elements.wordCount.textContent = `${total.toLocaleString()} words`;

  const minutes = total ? Math.max(1, Math.round(total / state.wpm)) : 0;
  elements.readingTime.textContent = `${minutes} min`;
  renderTimeComparison();
}

function renderContext() {
  if (!state.words.length) {
    elements.contextPreview.textContent = "Your nearby words will appear here once text is loaded.";
    return;
  }

  const start = Math.max(0, state.currentIndex - 18);
  const end = Math.min(state.words.length, state.currentIndex + 22);
  const fragment = document.createDocumentFragment();

  for (let index = start; index < end; index += 1) {
    const word = state.words[index];
    const node = document.createElement(index === state.currentIndex ? "mark" : "span");
    node.textContent = word;

    if (index === state.currentIndex) {
      node.className = "current";
    }

    fragment.append(node, document.createTextNode(" "));
  }

  elements.contextPreview.replaceChildren(fragment);
}

function renderControls() {
  const hasWords = state.words.length > 0;

  elements.playButton.textContent = state.isPlaying ? "Pause" : "Play";
  elements.extendButton.textContent = state.isExtended ? "Collapse" : "Extend";
  elements.playButton.disabled = !hasWords;
  elements.backButton.disabled = !hasWords;
  elements.nextButton.disabled = !hasWords;
  elements.restartButton.disabled = !hasWords;
  elements.seekSlider.disabled = !hasWords;
  elements.naturalPauseToggle.checked = state.naturalPauses;
}

function renderSource() {
  elements.sourceLabel.textContent = state.sourceName || "No source loaded";
}

function renderSize() {
  const effectiveFontSize = state.isExtended
    ? Math.min(Math.round(state.fontSize * 1.35), 180)
    : state.fontSize;
  const effectiveStageHeight = state.isExtended
    ? Math.max(184, Math.round(effectiveFontSize * 1.7))
    : Math.max(148, Math.round(effectiveFontSize * 1.55));

  document.documentElement.style.setProperty("--word-size", `${effectiveFontSize}px`);
  document.documentElement.style.setProperty(
    "--reader-stage-min-height",
    `${effectiveStageHeight}px`
  );
  elements.sizeValue.textContent = state.isExtended
    ? `${state.fontSize}px base / ${effectiveFontSize}px extended`
    : `${state.fontSize}px`;
}

function renderLayoutMode() {
  document.body.classList.toggle("reader-extended", state.isExtended);
}

function renderAll() {
  renderLayoutMode();
  renderWord();
  renderProgress();
  renderContext();
  renderControls();
  renderSource();
  renderSize();
}

function persistState() {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        rawText: state.rawText,
        sourceName: state.sourceName,
        currentIndex: state.currentIndex,
        isExtended: state.isExtended,
        wpm: state.wpm,
        fontSize: state.fontSize,
        naturalPauses: state.naturalPauses,
        textInputValue: elements.textInput.value,
      })
    );
  } catch {
    // Ignore storage failures so the app still works in restricted browsers.
  }
}

function clearPersistedState() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage failures so the app still works in restricted browsers.
  }
}

function restoreState() {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);

    if (!saved) {
      return;
    }

    const parsed = JSON.parse(saved);

    state.wpm = Number(parsed.wpm) || state.wpm;
    state.fontSize = Number(parsed.fontSize) || state.fontSize;
    state.isExtended = parsed.isExtended === true;
    state.naturalPauses = parsed.naturalPauses !== false;
    elements.speedSlider.value = String(state.wpm);
    elements.speedNumber.value = String(state.wpm);
    elements.sizeSlider.value = String(state.fontSize);
    elements.textInput.value = parsed.textInputValue || parsed.rawText || "";

    if (parsed.rawText) {
      loadText(parsed.rawText, parsed.sourceName || "Recovered session");
      state.currentIndex = Math.min(
        Math.max(Number(parsed.currentIndex) || 0, 0),
        Math.max(state.words.length - 1, 0)
      );
      renderAll();
      setStatus(`Restored ${state.sourceName || "your last session"}.`);
    }
  } catch {
    // Ignore corrupted storage and start fresh.
  }
}

function stopPlayback() {
  state.isPlaying = false;
  clearTimeout(state.timerId);
  state.timerId = null;
  renderControls();
}

function getDelayForWord(word) {
  const baseDelay = 60000 / state.wpm;

  if (!state.naturalPauses) {
    return baseDelay;
  }

  let multiplier = 1;

  if (word.length >= 8) {
    multiplier += 0.12;
  }

  if (/[,:;)]$/.test(word)) {
    multiplier += 0.18;
  }

  if (/[.!?]$/.test(word)) {
    multiplier += 0.34;
  }

  return baseDelay * multiplier;
}

function tick() {
  if (!state.isPlaying) {
    return;
  }

  if (state.currentIndex >= state.words.length - 1) {
    stopPlayback();
    return;
  }

  state.currentIndex += 1;
  renderAll();

  state.timerId = window.setTimeout(tick, getDelayForWord(state.words[state.currentIndex]));
}

function startPlayback() {
  if (!state.words.length) {
    return;
  }

  clearTimeout(state.timerId);
  state.isPlaying = true;
  renderControls();
  state.timerId = window.setTimeout(tick, getDelayForWord(state.words[state.currentIndex]));
}

function setStatus(message) {
  elements.statusMessage.textContent = message;
}

function loadText(text, sourceName) {
  const cleaned = extractReadableText(text).replace(/\u00a0/g, " ").trim();
  const words = tokenize(cleaned);

  if (!words.length) {
    stopPlayback();
    state.words = [];
    state.currentIndex = 0;
    state.rawText = "";
    state.sourceName = "";
    renderAll();
    clearPersistedState();
    setStatus("No readable words were found in that source.");
    return;
  }

  stopPlayback();
  state.words = words;
  state.currentIndex = 0;
  state.rawText = cleaned;
  state.sourceName = sourceName;
  renderAll();
  persistState();
  setStatus(`Loaded ${words.length.toLocaleString()} words from ${sourceName}.`);
}

async function loadFile(file) {
  if (!file) {
    return;
  }

  const text = await file.text();

  if (!text.trim()) {
    setStatus("That file appears to be empty.");
    return;
  }

  if (getPrintableRatio(text) < 0.85) {
    setStatus("That file does not look like plain readable text. Try a .txt, .md, .rtf, or .html file.");
    return;
  }

  elements.textInput.value = extractReadableText(text).trim();
  persistState();
  loadText(text, file.name);
}

function getPdfItemMetrics(item) {
  const x = item.transform?.[4] ?? 0;
  const y = item.transform?.[5] ?? 0;
  const width = Math.abs(item.width ?? 0);
  const fallbackHeight =
    Math.abs(item.transform?.[0] ?? 0) ||
    Math.abs(item.transform?.[3] ?? 0) ||
    12;
  const height = Math.abs(item.height ?? fallbackHeight) || fallbackHeight;

  return { x, y, width, height };
}

function buildPdfPageText(items) {
  let pageText = "";
  let previousItem = null;

  for (const item of items) {
    if (!("str" in item) || !item.str) {
      continue;
    }

    const text = item.str.replace(/\u00a0/g, " ");
    const metrics = getPdfItemMetrics(item);

    if (!text.trim()) {
      if (pageText && !pageText.endsWith("\n") && !pageText.endsWith(" ")) {
        pageText += " ";
      }

      continue;
    }

    if (previousItem) {
      const lineHeight = Math.max(previousItem.height, metrics.height);
      const movedToNewLine =
        Math.abs(metrics.y - previousItem.y) > Math.max(5, lineHeight * 0.8) ||
        metrics.x < previousItem.x - lineHeight * 0.6;

      if (movedToNewLine) {
        if (!pageText.endsWith("\n")) {
          pageText += "\n";
        }
      } else {
        const previousEndX = previousItem.x + previousItem.width;
        const gap = metrics.x - previousEndX;
        const spaceThreshold = Math.max(1.5, lineHeight * 0.18);

        if (gap > spaceThreshold && !pageText.endsWith("\n") && !pageText.endsWith(" ")) {
          pageText += " ";
        }
      }
    }

    pageText += text;

    if (item.hasEOL && !pageText.endsWith("\n")) {
      pageText += "\n";
    }

    previousItem = metrics;
  }

  return pageText
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

async function extractTextFromPdf(file) {
  if (!configurePdfParser()) {
    throw new Error("PDF support is unavailable because the PDF parser could not be loaded.");
  }

  const buffer = new Uint8Array(await file.arrayBuffer());
  const pdf = await window.pdfjsLib.getDocument({ data: buffer }).promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    setStatus(`Reading ${file.name}: page ${pageNumber} of ${pdf.numPages}...`);

    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = buildPdfPageText(content.items);
    pages.push(pageText.trim());
  }

  return pages.filter(Boolean).join("\n\n");
}

async function extractTextFromPdfWithOcr(file) {
  if (!configurePdfParser()) {
    throw new Error("PDF support is unavailable because the PDF parser could not be loaded.");
  }

  if (!hasOcrParser()) {
    throw new Error("OCR support is unavailable because the OCR engine could not be loaded.");
  }

  const buffer = new Uint8Array(await file.arrayBuffer());
  const pdf = await window.pdfjsLib.getDocument({ data: buffer }).promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    setStatus(`OCR scanning ${file.name}: rendering page ${pageNumber} of ${pdf.numPages}...`);

    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });

    if (!context) {
      throw new Error("OCR could not start because the canvas context is unavailable.");
    }

    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);

    await page.render({
      canvasContext: context,
      viewport,
    }).promise;

    const result = await window.Tesseract.recognize(canvas, "eng", {
      logger: (event) => {
        if (event.status === "recognizing text") {
          const percent = Math.round((event.progress || 0) * 100);
          setStatus(
            `OCR scanning ${file.name}: page ${pageNumber} of ${pdf.numPages} (${percent}%)...`
          );
        }
      },
    });

    const ocrText = result?.data?.text?.trim() || "";

    if (ocrText) {
      pages.push(ocrText);
    }

    canvas.width = 0;
    canvas.height = 0;
    page.cleanup?.();
  }

  return pages.join("\n\n").trim();
}

async function loadPdf(file) {
  if (!file) {
    return;
  }

  setStatus(`Opening ${file.name}...`);

  try {
    let text = await extractTextFromPdf(file);

    if (!text.trim()) {
      setStatus(`No selectable text found in ${file.name}. Starting OCR...`);
      text = await extractTextFromPdfWithOcr(file);
    }

    if (!text.trim()) {
      setStatus("That PDF did not contain readable text, even after OCR.");
      return;
    }

    elements.textInput.value = text.trim();
    loadText(text, file.name);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The PDF could not be read.";
    setStatus(message);
  }
}

function handleTextLoad() {
  const value = elements.textInput.value.trim();

  if (!value) {
    setStatus("Paste some text first, then load it into the reader.");
    return;
  }

  loadText(value, "Pasted text");
}

function handlePlayToggle() {
  if (state.isPlaying) {
    stopPlayback();
    return;
  }

  startPlayback();
}

function moveBy(step) {
  if (!state.words.length) {
    return;
  }

  stopPlayback();
  state.currentIndex = Math.min(Math.max(state.currentIndex + step, 0), state.words.length - 1);
  renderAll();
}

function toggleExtendedMode() {
  state.isExtended = !state.isExtended;
  renderAll();
  persistState();
  document.querySelector(".panel-reader")?.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
}

function bindEvents() {
  elements.loadTextButton.addEventListener("click", handleTextLoad);
  elements.sampleButton.addEventListener("click", () => {
    elements.textInput.value = sampleText;
    loadText(sampleText, "Sample text");
  });
  elements.clearButton.addEventListener("click", () => {
    stopPlayback();
    elements.textInput.value = "";
    elements.fileInput.value = "";
    elements.pdfInput.value = "";
    state.words = [];
    state.currentIndex = 0;
    state.rawText = "";
    state.sourceName = "";
    renderAll();
    clearPersistedState();
    setStatus("Reader cleared.");
  });

  elements.fileInput.addEventListener("change", async (event) => {
    const [file] = event.target.files;
    await loadFile(file);
  });

  elements.pdfInput.addEventListener("change", async (event) => {
    const [file] = event.target.files;
    await loadPdf(file);
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    elements.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.dropZone.classList.add("drag-over");
    });
  });

  ["dragleave", "dragend", "drop"].forEach((eventName) => {
    elements.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.dropZone.classList.remove("drag-over");
    });
  });

  elements.dropZone.addEventListener("drop", async (event) => {
    const [file] = event.dataTransfer.files;
    await loadFile(file);
  });

  elements.playButton.addEventListener("click", handlePlayToggle);
  elements.extendButton.addEventListener("click", toggleExtendedMode);
  elements.backButton.addEventListener("click", () => moveBy(-1));
  elements.nextButton.addEventListener("click", () => moveBy(1));
  elements.restartButton.addEventListener("click", () => {
    if (!state.words.length) {
      return;
    }

    stopPlayback();
    state.currentIndex = 0;
    renderAll();
  });

  elements.speedSlider.addEventListener("input", (event) => {
    state.wpm = Number(event.target.value);
    elements.speedNumber.value = String(state.wpm);
    renderProgress();
    persistState();

    if (state.isPlaying) {
      startPlayback();
    }
  });

  elements.speedNumber.addEventListener("input", (event) => {
    const value = Math.min(1000, Math.max(100, Number(event.target.value) || 100));
    state.wpm = value;
    elements.speedSlider.value = String(value);
    elements.speedNumber.value = String(value);
    renderProgress();
    persistState();

    if (state.isPlaying) {
      startPlayback();
    }
  });

  elements.sizeSlider.addEventListener("input", (event) => {
    state.fontSize = Number(event.target.value);
    renderSize();
    persistState();
  });

  elements.seekSlider.addEventListener("input", (event) => {
    if (!state.words.length) {
      return;
    }

    stopPlayback();
    state.currentIndex = Number(event.target.value);
    renderAll();
    persistState();
  });

  elements.naturalPauseToggle.addEventListener("change", (event) => {
    state.naturalPauses = event.target.checked;
    persistState();

    if (state.isPlaying) {
      startPlayback();
    } else {
      renderControls();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) {
      return;
    }

    if (event.code === "Space") {
      event.preventDefault();
      handlePlayToggle();
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveBy(-1);
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      moveBy(1);
    }
  });
}

bindEvents();
restoreState();
renderAll();

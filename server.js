const STORAGE_KEY = "pagine";
const LAST_SAVE_KEY = "ultimoSalvataggio";
const MAX_HISTORY = 100;
const CANVAS_HEIGHT = 2000;

const lavagna = document.getElementById("lavagna");
const selectionCanvas = document.getElementById("selectionCanvas");
const selectionContext = selectionCanvas.getContext("2d");
const canvasWrapper = document.querySelector(".canvas-wrapper");

const penTool = document.getElementById("penTool");
const eraserTool = document.getElementById("eraserTool");
const lineTool = document.getElementById("lineTool");
const activateSelectionBtn = document.getElementById("activateSelection");
const savePDF = document.getElementById("savePDF");
const clearStorageBtn = document.getElementById("clearStorage");
const colorPicker = document.getElementById("colorPicker");
const brushSize = document.getElementById("brushSize");
const aggiungiPaginaBtn = document.getElementById("aggiungiPagina");
const selettorePagine = document.getElementById("selettorePagine");
const undoBtn = document.getElementById("undo");
const redoBtn = document.getElementById("redo");
const ultimoNomeFileBtn = document.getElementById("ultimoNomeFile");
const calcolatriceButton = document.getElementById("calcolatriceButton");
const displayInput = document.getElementById("display");

const canvas = new fabric.Canvas("drawingCanvas", {
    isDrawingMode: true,
    selection: false
});

let drawingMode = "pen";
let pagine = [];
let paginaAttuale = 0;
let undoStack = [];
let redoStack = [];
let isRestoringState = false;

let isSelectionMode = false;
let isDraggingSelection = false;
let selectionStartX = 0;
let selectionStartY = 0;

let activeLine = null;

function setCanvasSize() {
    const width = Math.max(lavagna.clientWidth - 2, 900);

    canvas.setDimensions({ width, height: CANVAS_HEIGHT });
    canvas.calcOffset();


    selectionCanvas.width = width;
    selectionCanvas.height = CANVAS_HEIGHT;
    selectionCanvas.style.width = `${width}px`;
    selectionCanvas.style.height = `${CANVAS_HEIGHT}px`;

    canvasWrapper.style.height = `${CANVAS_HEIGHT}px`;
    clearSelectionOverlay();
    canvas.requestRenderAll();
}

function applyBrushSettings() {
    canvas.freeDrawingBrush.color = colorPicker.value;
    canvas.freeDrawingBrush.width = Number.parseInt(brushSize.value, 10);
}

function saveToLocalStorage() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pagine));
    localStorage.setItem(LAST_SAVE_KEY, new Date().toISOString());
}

function formatDate(isoDate) {
    if (!isoDate) {
        return "nessun salvataggio";
    }
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) {
        return "nessun salvataggio";
    }
    return date.toLocaleString("it-IT");
}

function persistCurrentPage() {
    if (!pagine[paginaAttuale]) {
        return;
    }
    pagine[paginaAttuale].canvasData = canvas.toJSON();
}

function snapshotCanvas() {
    return JSON.stringify(canvas.toJSON());
}

function pushHistoryState() {
    if (isRestoringState) {
        return;
    }
    undoStack.push(snapshotCanvas());
    if (undoStack.length > MAX_HISTORY) {
        undoStack.shift();
    }
    redoStack = [];
    persistCurrentPage();
    saveToLocalStorage();
}

function resetHistory() {
    undoStack = [snapshotCanvas()];
    redoStack = [];
}

function loadCanvasData(canvasData) {
    isRestoringState = true;
    return new Promise((resolve) => {
        canvas.clear();

        if (!canvasData) {
            canvas.requestRenderAll();
            isRestoringState = false;
            resolve();
            return;
        }

        canvas.loadFromJSON(canvasData, () => {
            canvas.requestRenderAll();
            isRestoringState = false;
            resolve();
        });
    });
}

function createPage(index) {
    return {
        paginaNome: `Pagina ${index + 1}`,
        canvasData: null
    };
}

function updatePageSelector() {
    selettorePagine.innerHTML = "";
    pagine.forEach((pagina, index) => {
        const option = new Option(pagina.paginaNome, String(index));
        selettorePagine.appendChild(option);
    });
    selettorePagine.value = String(paginaAttuale);
}

async function selectPage(indexValue) {
    const index = Number.parseInt(indexValue, 10);
    if (Number.isNaN(index) || index < 0 || index >= pagine.length) {
        return;
    }
    if (index === paginaAttuale) {
        return;
    }

    persistCurrentPage();
    saveToLocalStorage();

    paginaAttuale = index;
    await loadCanvasData(pagine[paginaAttuale].canvasData);
    resetHistory();
    updatePageSelector();
}

async function aggiungiPagina() {
    persistCurrentPage();
    pagine.push(createPage(pagine.length));
    paginaAttuale = pagine.length - 1;
    updatePageSelector();
    await loadCanvasData(null);
    resetHistory();
    saveToLocalStorage();
}

function clearSelectionOverlay() {
    selectionContext.clearRect(0, 0, selectionCanvas.width, selectionCanvas.height);
}

function setSelectionMode(enabled) {
    isSelectionMode = enabled;
    selectionCanvas.style.pointerEvents = enabled ? "auto" : "none";
    activateSelectionBtn.classList.toggle("active", enabled);
    activateSelectionBtn.title = enabled ? "OCR attivo: seleziona area" : "Selezione OCR";
    if (!enabled) {
        isDraggingSelection = false;
        clearSelectionOverlay();
    }
}

function getSelectionRect(startX, startY, endX, endY) {
    const left = Math.min(startX, endX);
    const top = Math.min(startY, endY);
    const width = Math.abs(endX - startX);
    const height = Math.abs(endY - startY);

    return { left, top, width, height };
}

function drawSelectionRect(rect) {
    clearSelectionOverlay();
    selectionContext.setLineDash([6, 4]);
    selectionContext.lineWidth = 2;
    selectionContext.strokeStyle = "#ff3b30";
    selectionContext.strokeRect(rect.left, rect.top, rect.width, rect.height);
}

function cleanExpression(text) {
    return text
        .replace(/[xX\u00D7]/g, "*")
        .replace(/[\u00F7]/g, "/")
        .replace(/(\d),(\d)/g, "$1.$2")
        .replace(/[^\d+\-*/().%^]/g, "")
        .trim();
}

async function runOCRSelection(rect) {
    const imageData = canvas.toDataURL({
        format: "png",
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        multiplier: 2
    });

    try {
        const result = await Tesseract.recognize(imageData, "eng");
        const text = (result.data.text || "").replace(/\s+/g, "");
        const expression = cleanExpression(text);

        if (expression) {
            appendDisplay(expression);
        } else {
            alert("OCR completato, ma nessuna espressione valida trovata.");
        }
    } catch (_error) {
        alert("Errore OCR: impossibile riconoscere il testo.");
    }
}

const eraserMouseDownHandler = (opt) => {
    const target = canvas.findTarget(opt.e, false);
    if (target) {
        canvas.remove(target);
    }
};

const lineMouseDownHandler = (opt) => {
    const pointer = canvas.getPointer(opt.e);
    activeLine = new fabric.Line([pointer.x, pointer.y, pointer.x, pointer.y], {
        stroke: colorPicker.value,
        strokeWidth: Number.parseInt(brushSize.value, 10),
        selectable: false
    });
    canvas.add(activeLine);
};

const lineMouseMoveHandler = (opt) => {
    if (!activeLine) {
        return;
    }
    const pointer = canvas.getPointer(opt.e);
    activeLine.set({ x2: pointer.x, y2: pointer.y });
    canvas.requestRenderAll();
};

const lineMouseUpHandler = () => {
    if (!activeLine) {
        return;
    }
    activeLine = null;
    pushHistoryState();
};

function detachToolHandlers() {
    canvas.off("mouse:down", eraserMouseDownHandler);
    canvas.off("mouse:down", lineMouseDownHandler);
    canvas.off("mouse:move", lineMouseMoveHandler);
    canvas.off("mouse:up", lineMouseUpHandler);
}

function activatePen() {
    drawingMode = "pen";
    detachToolHandlers();
    canvas.isDrawingMode = true;
    applyBrushSettings();
}

function activateEraser() {
    drawingMode = "eraser";
    detachToolHandlers();
    canvas.isDrawingMode = false;
    canvas.on("mouse:down", eraserMouseDownHandler);
}

function activateLine() {
    drawingMode = "line";
    detachToolHandlers();
    canvas.isDrawingMode = false;
    canvas.on("mouse:down", lineMouseDownHandler);
    canvas.on("mouse:move", lineMouseMoveHandler);
    canvas.on("mouse:up", lineMouseUpHandler);
}

function undo() {
    if (undoStack.length <= 1) {
        return;
    }

    const currentState = undoStack.pop();
    redoStack.push(currentState);
    const previousState = undoStack[undoStack.length - 1];

    isRestoringState = true;
    canvas.loadFromJSON(previousState, () => {
        canvas.requestRenderAll();
        isRestoringState = false;
        persistCurrentPage();
        saveToLocalStorage();
    });
}

function redo() {
    if (redoStack.length === 0) {
        return;
    }

    const stateToRestore = redoStack.pop();
    undoStack.push(stateToRestore);

    isRestoringState = true;
    canvas.loadFromJSON(stateToRestore, () => {
        canvas.requestRenderAll();
        isRestoringState = false;
        persistCurrentPage();
        saveToLocalStorage();
    });
}

async function salvaPDF() {
    if (pagine.length === 0) {
        return;
    }

    persistCurrentPage();
    saveToLocalStorage();

    const originalPage = paginaAttuale;
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF("p", "pt", "a4");

    for (let i = 0; i < pagine.length; i += 1) {
        await loadCanvasData(pagine[i].canvasData);

        const image = canvas.toDataURL({ format: "png", multiplier: 2 });
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const ratio = canvas.width / canvas.height;

        const drawWidth = pageWidth - 30;
        const drawHeight = drawWidth / ratio;
        const y = Math.max(15, (pageHeight - drawHeight) / 2);

        if (i > 0) {
            doc.addPage();
        }
        doc.addImage(image, "PNG", 15, y, drawWidth, drawHeight);
    }

    const defaultName = `lavagna_${new Date().toISOString().slice(0, 10)}`;
    const fileName = prompt("Nome PDF:", defaultName) || defaultName;
    doc.save(`${fileName}.pdf`);

    paginaAttuale = originalPage;
    await loadCanvasData(pagine[paginaAttuale].canvasData);
    updatePageSelector();
    resetHistory();
}

async function clearStorage() {
    const conferma = confirm("Vuoi cancellare tutte le pagine salvate?");
    if (!conferma) {
        return;
    }

    Object.keys(localStorage)
        .filter((key) => key === STORAGE_KEY || key === LAST_SAVE_KEY || key === "ultimoNomeFile" || key.startsWith("disegno_"))
        .forEach((key) => localStorage.removeItem(key));

    pagine = [createPage(0)];
    paginaAttuale = 0;
    updatePageSelector();
    await loadCanvasData(null);
    resetHistory();
    saveToLocalStorage();
}

function appendDisplay(value) {
    displayInput.value += value;
}

function clearDisplay() {
    displayInput.value = "";
}

function calculate() {
    const expression = cleanExpression(displayInput.value);
    if (!expression) {
        return;
    }
    try {
        const result = math.evaluate(expression);
        displayInput.value = String(result);
    } catch (_error) {
        alert("Espressione non valida.");
    }
}

window.appendDisplay = appendDisplay;
window.clearDisplay = clearDisplay;
window.calculate = calculate;

function setupEvents() {
    penTool.addEventListener("click", activatePen);
    eraserTool.addEventListener("click", activateEraser);
    lineTool.addEventListener("click", activateLine);

    colorPicker.addEventListener("input", () => {
        if (drawingMode === "pen") {
            applyBrushSettings();
        }
    });
    brushSize.addEventListener("input", () => {
        if (drawingMode === "pen") {
            applyBrushSettings();
        }
    });

    activateSelectionBtn.addEventListener("click", () => {
        setSelectionMode(!isSelectionMode);
    });

    selectionCanvas.addEventListener("mousedown", (event) => {
        if (!isSelectionMode) {
            return;
        }
        isDraggingSelection = true;
        selectionStartX = event.offsetX;
        selectionStartY = event.offsetY;
        clearSelectionOverlay();
    });

    selectionCanvas.addEventListener("mousemove", (event) => {
        if (!isSelectionMode || !isDraggingSelection) {
            return;
        }
        const rect = getSelectionRect(selectionStartX, selectionStartY, event.offsetX, event.offsetY);
        drawSelectionRect(rect);
    });

    selectionCanvas.addEventListener("mouseup", async (event) => {
        if (!isSelectionMode || !isDraggingSelection) {
            return;
        }
        isDraggingSelection = false;
        const rect = getSelectionRect(selectionStartX, selectionStartY, event.offsetX, event.offsetY);

        if (rect.width < 5 || rect.height < 5) {
            clearSelectionOverlay();
            return;
        }

        await runOCRSelection(rect);
        setSelectionMode(false);
    });

    selectionCanvas.addEventListener("mouseleave", () => {
        if (isDraggingSelection) {
            isDraggingSelection = false;
            clearSelectionOverlay();
        }
    });

    canvas.on("path:created", pushHistoryState);
    canvas.on("object:removed", pushHistoryState);
    canvas.on("object:modified", pushHistoryState);

    aggiungiPaginaBtn.addEventListener("click", () => {
        void aggiungiPagina();
    });
    selettorePagine.addEventListener("change", () => {
        void selectPage(selettorePagine.value);
    });
    savePDF.addEventListener("click", () => {
        void salvaPDF();
    });
    undoBtn.addEventListener("click", undo);
    redoBtn.addEventListener("click", redo);
    clearStorageBtn.addEventListener("click", () => {
        void clearStorage();
    });

    ultimoNomeFileBtn.addEventListener("click", () => {
        const lastSave = localStorage.getItem(LAST_SAVE_KEY);
        alert(`Ultimo salvataggio: ${formatDate(lastSave)}`);
    });

    window.addEventListener("resize", setCanvasSize);
}

async function initializePages() {
    const pagesFromStorage = localStorage.getItem(STORAGE_KEY);
    if (pagesFromStorage) {
        try {
            const parsed = JSON.parse(pagesFromStorage);
            if (Array.isArray(parsed) && parsed.length > 0) {
                pagine = parsed;
            }
        } catch (_error) {
            pagine = [];
        }
    }

    if (pagine.length === 0) {
        pagine = [createPage(0)];
    }

    paginaAttuale = 0;
    updatePageSelector();
    await loadCanvasData(pagine[paginaAttuale].canvasData);
    resetHistory();
}

$(function () {
    $("#calcolatrice").dialog({
        autoOpen: false,
        width: 360,
        modal: false,
        resizable: true,
        draggable: true
    });

    calcolatriceButton.addEventListener("click", () => {
        $("#calcolatrice").dialog("open");
    });
});

async function initializeApp() {
    setCanvasSize();
    setupEvents();
    activatePen();
    await initializePages();
}

void initializeApp();

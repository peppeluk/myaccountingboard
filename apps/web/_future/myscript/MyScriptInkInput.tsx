import { useEffect, useRef, type InputHTMLAttributes } from "react";

type MyScriptInkInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: string;
  onValueChange: (nextValue: string) => void;
  handwritingEnabled?: boolean;
  forceExportOnPointerUp?: boolean;
  renderingMinWidth?: number;
  renderingMinHeight?: number;
};

const MYSCRIPT_APP_KEY = import.meta.env.VITE_MYSCRIPT_APP_KEY as string | undefined;
const MYSCRIPT_HMAC_KEY = import.meta.env.VITE_MYSCRIPT_HMAC_KEY as string | undefined;
const MYSCRIPT_HOST = (import.meta.env.VITE_MYSCRIPT_HOST as string | undefined) ?? "cloud.myscript.com";
const MYSCRIPT_LANG = (import.meta.env.VITE_MYSCRIPT_LANG as string | undefined) ?? "it_IT";
const MYSCRIPT_SCRIPT_URL =
  (import.meta.env.VITE_MYSCRIPT_SCRIPT_URL as string | undefined) ??
  "https://cdn.jsdelivr.net/npm/iink-ts@3.2.1/dist/iink.min.js";
const MYSCRIPT_FALLBACK_SCRIPT_URL = "https://unpkg.com/iink-ts@3.2.1/dist/iink.min.js";
const MYSCRIPT_EDITOR_TYPE =
  (import.meta.env.VITE_MYSCRIPT_EDITOR_TYPE as string | undefined) ?? "INTERACTIVEINKSSR";
const IS_MYSCRIPT_CONFIGURED = Boolean(MYSCRIPT_APP_KEY && MYSCRIPT_HMAC_KEY);

let iinkLoaderPromise: Promise<any> | null = null;

function extractTextFromJiix(rawJiix: unknown): string | null {
  if (!rawJiix) {
    return null;
  }
  let parsed: any = null;
  if (typeof rawJiix === "string") {
    try {
      parsed = JSON.parse(rawJiix);
    } catch (error) {
      console.error("MyScript JIIX parse failed:", error);
      return null;
    }
  } else if (typeof rawJiix === "object") {
    parsed = rawJiix;
  }
  if (!parsed) {
    return null;
  }

  const chunks: string[] = [];
  const visit = (node: any) => {
    if (!node || typeof node !== "object") {
      return;
    }
    const nodeType = typeof node.type === "string" ? node.type : "";
    const label = typeof node.label === "string" ? node.label : null;
    const text = typeof node.text === "string" ? node.text : null;
    if (label) {
      chunks.push(label);
    } else if (text) {
      chunks.push(text);
    }

    if (Array.isArray(node.words)) {
      node.words.forEach((word: any) => {
        if (typeof word?.label === "string") {
          chunks.push(word.label);
        }
      });
    }
    if (nodeType.toLowerCase().includes("text") && Array.isArray(node.items)) {
      node.items.forEach((item: any) => {
        if (typeof item?.label === "string") {
          chunks.push(item.label);
        }
        if (Array.isArray(item?.words)) {
          const itemWords = item.words
            .map((word: any) => (typeof word?.label === "string" ? word.label : ""))
            .filter(Boolean)
            .join(" ");
          if (itemWords) {
            chunks.push(itemWords);
          }
        }
      });
    }
    if (Array.isArray(node.lines)) {
      node.lines.forEach((line: any) => {
        if (Array.isArray(line?.words)) {
          const lineWords = line.words
            .map((word: any) => (typeof word?.label === "string" ? word.label : ""))
            .filter(Boolean)
            .join(" ");
          if (lineWords) {
            chunks.push(lineWords);
          }
        }
      });
    }
    if (Array.isArray(node.elements)) {
      node.elements.forEach(visit);
    }
    if (Array.isArray(node.children)) {
      node.children.forEach(visit);
    }
  };

  visit(parsed);

  const normalized = chunks
    .map((value) => value.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || null;
}

function loadScript(src: string, scriptId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.getElementById(scriptId) as HTMLScriptElement | null;
    const handleLoad = () => resolve();
    const handleError = () => reject(new Error(`Impossibile caricare MyScript SDK: ${src}`));

    if (existing) {
      if (existing.getAttribute("data-loaded") === "true") {
        resolve();
        return;
      }
      existing.addEventListener("load", handleLoad, { once: true });
      existing.addEventListener("error", handleError, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.id = scriptId;
    script.src = src;
    script.async = true;
    script.addEventListener("load", () => {
      script.setAttribute("data-loaded", "true");
      resolve();
    }, { once: true });
    script.addEventListener("error", handleError, { once: true });
    document.head.appendChild(script);

    window.setTimeout(() => {
      if (script.getAttribute("data-loaded") !== "true") {
        reject(new Error(`Timeout caricamento MyScript SDK: ${src}`));
      }
    }, 8000);
  });
}

function loadIink(): Promise<any> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("MyScript SDK non disponibile lato server."));
  }
  const globalIink = (window as any).iink;
  if (globalIink?.Editor) {
    return Promise.resolve(globalIink);
  }
  if (iinkLoaderPromise) {
    return iinkLoaderPromise;
  }

  iinkLoaderPromise = (async () => {
    const urls = [MYSCRIPT_SCRIPT_URL, MYSCRIPT_FALLBACK_SCRIPT_URL]
      .filter(Boolean)
      .filter((value, index, list) => list.indexOf(value) === index);
    let lastError: unknown = null;

    for (const [index, url] of urls.entries()) {
      const scriptId = index === 0 ? "myscript-iink-sdk" : `myscript-iink-sdk-${index}`;
      try {
        await loadScript(url, scriptId);
        const loaded = (window as any).iink;
        if (loaded?.Editor) {
          return loaded;
        }
        lastError = new Error("MyScript SDK caricato ma non disponibile.");
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError ?? new Error("Impossibile caricare MyScript SDK.");
  })();

  return iinkLoaderPromise;
}

export function MyScriptInkInput({
  value,
  onValueChange,
  handwritingEnabled = false,
  forceExportOnPointerUp = false,
  renderingMinWidth,
  renderingMinHeight,
  readOnly,
  className,
  ...rest
}: MyScriptInkInputProps) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<any>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const onValueChangeRef = useRef(onValueChange);
  const lastExportRef = useRef<string>("");
  const wasEnabledRef = useRef(false);
  const pendingTextExportRef = useRef(false);

  useEffect(() => {
    onValueChangeRef.current = onValueChange;
  }, [onValueChange]);

  useEffect(() => {
    if (!handwritingEnabled || !IS_MYSCRIPT_CONFIGURED) {
      return;
    }

    let cancelled = false;
    const element = overlayRef.current;
    if (!element) {
      return;
    }

    const hideMenus = () => {
      const root = overlayRef.current;
      if (!root) {
        return;
      }
      root.querySelectorAll(".ms-menu").forEach((node) => {
        const element = node as HTMLElement;
        element.style.display = "none";
        element.setAttribute("aria-hidden", "true");
        (element as any).inert = true;
      });
      root.querySelectorAll(".ms-menu button").forEach((node) => {
        const element = node as HTMLElement;
        element.setAttribute("tabindex", "-1");
        element.setAttribute("aria-hidden", "true");
      });
    };

    const initialize = async () => {
      let module: any;
      try {
        module = await loadIink();
      } catch (error) {
        console.error("MyScript SDK load failed:", error);
        return;
      }
      if (cancelled || !overlayRef.current) {
        return;
      }

      const inputElement = overlayRef.current.parentElement?.querySelector("input");
      const inputHeight = inputElement?.clientHeight ?? 24;
      const overlayElement = overlayRef.current;
      const overlayRect = overlayElement.getBoundingClientRect();
      const overlayWidth = overlayRect.width || overlayElement.clientWidth || overlayElement.offsetWidth || 0;
      const overlayHeight = overlayRect.height || overlayElement.clientHeight || overlayElement.offsetHeight || 0;
      const baseMinHeight = Math.max(24, Math.floor((overlayHeight || inputHeight) - 2));
      const baseMinWidth = Math.max(120, Math.floor(overlayWidth || 0));
      const minHeight = Math.max(
        baseMinHeight,
        typeof renderingMinHeight === "number" ? renderingMinHeight : 0
      );
      const minWidth = Math.max(
        baseMinWidth,
        typeof renderingMinWidth === "number" ? renderingMinWidth : 0
      );

      let editor: any;
      try {
        const configuration: Record<string, unknown> = {
          server: {
            protocol: "WEBSOCKET",
            scheme: "https",
            host: MYSCRIPT_HOST,
            applicationKey: MYSCRIPT_APP_KEY,
            hmacKey: MYSCRIPT_HMAC_KEY
          },
          export: {
            mimeTypes: ["text/plain", "application/vnd.myscript.jiix"]
          },
          recognition: {
            type: "TEXT",
            lang: MYSCRIPT_LANG,
            text: {
              mimeTypes: ["text/plain", "application/vnd.myscript.jiix"]
            }
          },
          triggers: {
            exportContent: "POINTER_UP",
            exportContentDelay: 150
          },
          rendering: {
            minHeight,
            minWidth
          }
        };

        if (MYSCRIPT_EDITOR_TYPE === "INTERACTIVEINK") {
          configuration["raw-content"] = {
            recognition: {
              types: ["text"]
            },
            classification: {
              types: ["text"]
            },
            gestures: []
          };
        }

        editor = await module.Editor.load(overlayRef.current, MYSCRIPT_EDITOR_TYPE, {
          configuration
        });
      } catch (error) {
        console.error("MyScript editor load failed:", error);
        return;
      }

      editorRef.current = editor;
      try {
        if (editor?.start) {
          await editor.start();
        }
        if (editor?.resize) {
          editor.resize();
        }
      } catch (error) {
        console.error("MyScript editor start failed:", error);
      }
      window.requestAnimationFrame(() => {
        if (editorRef.current?.resize) {
          editorRef.current.resize();
        }
      });
      hideMenus();

      if (cancelled) {
        if (editor?.close) {
          await editor.close();
        }
        if (editor?.unload) {
          editor.unload();
        }
        return;
      }

      const handleExported = (event: Event) => {
        const detail = (event as CustomEvent).detail;
        const exports = detail?.rawResult?.exports ?? detail?.exports;
        const plainText = exports?.["text/plain"];
        const jiixText = extractTextFromJiix(exports?.["application/vnd.myscript.jiix"]);
        const textValue = typeof plainText === "string" && plainText.trim()
          ? plainText
          : jiixText;
        if (!plainText && !pendingTextExportRef.current) {
          const editor = editorRef.current;
          if (editor?.export_ && typeof editor.export_ === "function") {
            pendingTextExportRef.current = true;
            try {
              editor.export_("text/plain");
            } catch (error) {
              console.error("MyScript export text/plain failed:", error);
            }
          }
        }
        if (!textValue) {
          return;
        }
        pendingTextExportRef.current = false;
        if (textValue === lastExportRef.current) {
          return;
        }
        lastExportRef.current = textValue;
        onValueChangeRef.current(textValue);
      };

      const handleError = (event: Event) => {
        const detail = (event as CustomEvent).detail;
        console.error("MyScript error:", detail?.message ?? detail);
      };

      const eventTarget: EventTarget | null = editor?.events ?? overlayRef.current;
      eventTarget?.addEventListener("exported", handleExported as EventListener);
      eventTarget?.addEventListener("error", handleError as EventListener);

      cleanupRef.current = () => {
        eventTarget?.removeEventListener("exported", handleExported as EventListener);
        eventTarget?.removeEventListener("error", handleError as EventListener);
      };
    };

    void initialize();

    const observer = new MutationObserver(() => hideMenus());
    if (overlayRef.current) {
      observer.observe(overlayRef.current, { childList: true, subtree: true });
    }

    const enableManualExport = forceExportOnPointerUp === true;
    const handlePointerDown = (event: PointerEvent) => {
      if (!enableManualExport) {
        return;
      }
      const target = event.currentTarget as HTMLElement | null;
      if (target?.setPointerCapture) {
        try {
          target.setPointerCapture(event.pointerId);
        } catch (error) {
          console.warn("MyScript pointer capture failed:", error);
        }
      }
    };

    const scheduleExport = () => {
      if (!enableManualExport) {
        return;
      }
      const editor = editorRef.current;
      if (!editor) {
        return;
      }
      const doExport = () => {
        if (editor?.export_ && typeof editor.export_ === "function") {
          try {
            editor.export_("text/plain");
            editor.export_("application/vnd.myscript.jiix");
          } catch (error) {
            console.error("MyScript export failed:", error);
          }
          return;
        }
        if (editor?.export && typeof editor.export === "function") {
          try {
            editor.export();
          } catch (error) {
            console.error("MyScript export failed:", error);
          }
        }
      };

      if (editor?.waitForIdle && typeof editor.waitForIdle === "function") {
        Promise.resolve(editor.waitForIdle())
          .then(doExport)
          .catch(doExport);
        return;
      }
      window.setTimeout(doExport, 400);
    };

    const handlePointerUp = (event?: PointerEvent) => {
      if (!enableManualExport) {
        return;
      }
      const target = event?.currentTarget as HTMLElement | null;
      if (target?.releasePointerCapture && event) {
        try {
          target.releasePointerCapture(event.pointerId);
        } catch (error) {
          console.warn("MyScript pointer release failed:", error);
        }
      }
      scheduleExport();
    };

    if (enableManualExport) {
      element.addEventListener("pointerdown", handlePointerDown);
      element.addEventListener("pointerup", handlePointerUp);
      element.addEventListener("pointercancel", handlePointerUp);
    }

    return () => {
      if (enableManualExport) {
        element.removeEventListener("pointerdown", handlePointerDown);
        element.removeEventListener("pointerup", handlePointerUp);
        element.removeEventListener("pointercancel", handlePointerUp);
      }
      observer.disconnect();
      cancelled = true;
      cleanupRef.current?.();
      cleanupRef.current = null;
      if (editorRef.current?.close) {
        void editorRef.current.close();
      }
      if (editorRef.current?.unload) {
        editorRef.current.unload();
      }
      editorRef.current = null;
    };
  }, [handwritingEnabled, forceExportOnPointerUp]);

  useEffect(() => {
    if (!handwritingEnabled || !editorRef.current) {
      wasEnabledRef.current = handwritingEnabled;
      return;
    }
    if (handwritingEnabled && !wasEnabledRef.current) {
      if (value) {
        editorRef.current.import_?.(value, "text/plain");
      } else {
        editorRef.current.clear?.();
      }
    }
    wasEnabledRef.current = handwritingEnabled;
  }, [handwritingEnabled, value]);

  const isInkActive = handwritingEnabled && IS_MYSCRIPT_CONFIGURED;
  const effectiveReadOnly = Boolean(readOnly || isInkActive);

  const inputProps = { ...(rest as Record<string, unknown>) };
  delete (inputProps as Record<string, unknown>).onValueChange;
  delete (inputProps as Record<string, unknown>).handwritingEnabled;
  delete (inputProps as Record<string, unknown>).handwritingenabled;

  return (
    <div className={`ink-input${isInkActive ? " ink-enabled" : ""}`}>
      <input
        {...(inputProps as InputHTMLAttributes<HTMLInputElement>)}
        className={className}
        value={value}
        readOnly={effectiveReadOnly}
      />
      <div ref={overlayRef} className="ink-overlay" aria-hidden="true" />
    </div>
  );
}

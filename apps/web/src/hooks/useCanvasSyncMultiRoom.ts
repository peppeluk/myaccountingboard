// ============================================================
// useCanvasSyncMultiRoom.ts
// Hook per sincronizzazione canvas multi-room via WebSocket
// ============================================================
// Path: apps/web/src/hooks/useCanvasSyncMultiRoom.ts

import { useEffect, useRef, useState, useCallback, type RefObject } from 'react';
import { mbdService, MBDDocument } from '../services/mbdService';
import { lazyImportFabric } from '../lib/lazyImports';

export type ConnectedUser = {
  clientId: string;
  nickname?: string;
  ipAddress?: string; // Nuovo campo IP
  connectedAt: number;
};

export type SyncState = {
  isConnected: boolean;
  currentRoom: string | null;
  latency: number | null;
  connectedUsers: ConnectedUser[];
};

export type JournalSyncState = {
  entries: any[];
  selectedProfileId?: string;
  isJournalOpen?: boolean;
  isCalculatorOpen?: boolean;
  calculatorDisplay?: string;
  selectedField?: {
    entryId: string;
    field: string;
  } | null;
  calculatorTarget?: {
    entryId: string;
    field: string;
  } | null;
  journalScroll?: {
    top: number;
    left: number;
  } | null;
};

export type BoardSyncState = {
  pageCount: number;
  currentPageIndex: number;
  scrollTop: number;
  scrollLeft: number;
};

export type JournalSyncAction =
  | { type: 'journal-add'; entry: any }
  | { type: 'journal-update'; entryId: string; patch: any }
  | { type: 'journal-remove'; entryId: string }
  | { type: 'journal-set'; entries: any[]; selectedProfileId?: string; isJournalOpen?: boolean; isCalculatorOpen?: boolean; calculatorDisplay?: string; selectedField?: { entryId: string; field: string } | null; calculatorTarget?: { entryId: string; field: string } | null; journalScroll?: { top: number; left: number } | null }
  | { type: 'journal-profile'; profileId: string }
  | { type: 'journal-panel'; isOpen: boolean }
  | { type: 'calculator-open'; isOpen: boolean }
  | { type: 'calculator-state'; display: string }
  | { type: 'journal-select-field'; entryId: string; field: string }
  | { type: 'calculator-result'; value: string }
  | { type: 'calculator-target'; target: { entryId: string; field: string } | null }
  | { type: 'journal-scroll'; top: number; left: number };

type JournalSyncHandlers = {
  getState?: () => JournalSyncState | null;
  onAction?: (action: JournalSyncAction) => void;
  onState?: (state: JournalSyncState) => void;
};

type BoardSyncHandlers = {
  getState?: () => BoardSyncState | null;
  onState?: (state: BoardSyncState) => void;
};

export type SyncActions = {
  joinRoom: (roomId: string, nickname?: string, ipAddress?: string) => void;
  leaveRoom: () => void;
  disconnect: () => void;
  sendJournalAction: (action: JournalSyncAction) => void;
  sendJournalState: (state: JournalSyncState) => void;
  sendBoardState: (state: BoardSyncState) => void;
  sendCanvasFullState: () => void;
};

export type SyncRefs = {
  wsRef: RefObject<WebSocket | null>;
  clientIdRef: RefObject<string>;
  currentRoomRef: RefObject<string | null>;
  isApplyingRemoteChangeRef: RefObject<boolean>;
};

// Funzione per generare clientId univoco
const generateClientId = () => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  const clientId = `client-${timestamp}-${random}`;
  console.log('🆔 [SYNC] Generated new clientId:', clientId);
  console.log('🆔 [SYNC] Timestamp:', timestamp, 'Random:', random);
  return clientId;
};

type CanvasUpdate = {
  type: 'object:added' | 'object:modified' | 'object:removed' | 'canvas:cleared';
  data: any;
  timestamp: number;
};

function isCanvasUsable(canvas: any | null): boolean {
  if (!canvas) return false;
  if ((canvas as any)._isDisposed) return false;
  const hasCoreApi =
    typeof (canvas as any).add === 'function' &&
    typeof (canvas as any).getObjects === 'function' &&
    typeof (canvas as any).loadFromJSON === 'function';
  return hasCoreApi;
}

function renderIfReady(canvas: any | null): void {
  if (!canvas) return;
  if ((canvas as any).contextContainer && typeof (canvas as any).renderAll === 'function') {
    console.log('🎨 [SYNC] Forcing canvas render with', canvas.getObjects().length, 'objects');
    canvas.renderAll();
    // Forza un render aggiuntivo per assicurarci che sia visibile
    requestAnimationFrame(() => {
      if (canvas && typeof canvas.renderAll === 'function') {
        console.log('🎨 [SYNC] Second render pass for visibility');
        canvas.renderAll();
      }
    });
  } else {
    console.warn('🎨 [SYNC] Canvas not ready for rendering');
  }
}

/**
 * Hook per sincronizzazione canvas in tempo reale con sistema multi-room
 * 
 * @param canvasRef - Ref al canvas Fabric.js da sincronizzare
 * @param serverUrl - URL del server WebSocket (es: ws://192.168.1.100:3001)
 * @returns Stato connessione e azioni per gestire le stanze
 * 
 * @example
 * const { isConnected, currentRoom, joinRoom, leaveRoom } = useCanvasSyncMultiRoom(
 *   canvasRef.current,
 *   `ws://${window.location.hostname}:3001`
 * );
 */
export function useCanvasSyncMultiRoom(
  canvasRef: RefObject<any>, // Fabric Canvas ref
  serverUrl: string,
  documentId?: string, // ID documento per MBD
  journalSync?: JournalSyncHandlers,
  boardSync?: BoardSyncHandlers
): SyncState & SyncActions & SyncRefs {
  const wsRef = useRef<WebSocket | null>(null);
  const clientIdRef = useRef<string>(generateClientId());
  const currentRoomRef = useRef<string | null>(null);
  const isApplyingRemoteChangeRef = useRef(false);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const heartbeatIntervalRef = useRef<number | null>(null);
  const journalSyncRef = useRef<JournalSyncHandlers | null>(journalSync ?? null);
  const boardSyncRef = useRef<BoardSyncHandlers | null>(boardSync ?? null);
  const handleMessageRef = useRef<((data: string) => void) | null>(null);
  const sendFullStateRef = useRef<(() => void) | null>(null);
  const pendingCanvasUpdatesRef = useRef<CanvasUpdate[]>([]);
  const pendingCanvasFullStateRef = useRef<any | null>(null);
  const pendingFlushTimeoutRef = useRef<number | null>(null);
  const forceSendEmptyRef = useRef(false);

  // Stati MBD
  const [mbdDocument, setMbdDocument] = useState<MBDDocument | null>(null);
  const [isSyncingWithMBD, setIsSyncingWithMBD] = useState(false);

  const [isConnected, setIsConnected] = useState(false);
  const [currentRoom, setCurrentRoom] = useState<string | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [connectedUsers, setConnectedUsers] = useState<ConnectedUser[]>([]);

  const notifyRemoteApplied = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('sync-canvas-remote-applied'));
  }, []);
  
  useEffect(() => {
    journalSyncRef.current = journalSync ?? null;
  }, [journalSync]);

  useEffect(() => {
    boardSyncRef.current = boardSync ?? null;
  }, [boardSync]);

  useEffect(() => {
    currentRoomRef.current = currentRoom;
  }, [currentRoom]);

  // Funzioni MBD
  const saveToMBD = useCallback(() => {
    const activeCanvas = canvasRef.current;
    if (!activeCanvas || !documentId) return;

    const canvasData = mbdService.exportCanvasData(activeCanvas);
    const document: Omit<MBDDocument, 'lastModified'> = {
      id: documentId!,
      fileName: `document-${documentId}`,
      canvasData,
      journalData: {}, // TODO: Aggiungere dati journal
      deviceId: clientIdRef.current
    };

    mbdService.saveDocument(document);
    console.log('[MBD] Document saved to MBD:', documentId);
  }, [documentId]);

  const loadFromMBD = useCallback(() => {
    const activeCanvas = canvasRef.current;
    if (!activeCanvas || !documentId) return;

    const doc = mbdService.getMostRecentDocument(documentId);
    if (!doc) {
      console.log('[MBD] No document found for ID:', documentId);
      return;
    }

    setIsSyncingWithMBD(true);
    isApplyingRemoteChangeRef.current = true;

    try {
      const canvasData = mbdService.importCanvasData(doc.canvasData);
      activeCanvas.loadFromJSON(canvasData, () => {
        activeCanvas.renderAll();
        console.log('[MBD] Document loaded from MBD:', documentId);
        setMbdDocument(doc);
      });
    } catch (error) {
      console.error('[MBD] Error loading document:', error);
    } finally {
      setIsSyncingWithMBD(false);
      isApplyingRemoteChangeRef.current = false;
    }
  }, [documentId]);

  // Auto-salvataggio MBD quando ci sono modifiche
  useEffect(() => {
    const activeCanvas = canvasRef.current;
    if (!activeCanvas || !documentId) return;

    const handleObjectModified = () => {
      // Debounce salvataggio MBD
      setTimeout(() => saveToMBD(), 1000);
    };

    activeCanvas.on('object:modified', handleObjectModified);
    activeCanvas.on('object:added', handleObjectModified);

    return () => {
      activeCanvas.off('object:modified', handleObjectModified);
      activeCanvas.off('object:added', handleObjectModified);
    };
  }, [documentId, saveToMBD, canvasRef]);

  // Connessione WebSocket
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    console.log('[Sync] Connecting to', serverUrl);
    
    try {
      const ws = new WebSocket(serverUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[Sync] Connected to server');
        setIsConnected(true);
      };

      ws.onclose = (event) => {
        console.log('[Sync] Disconnected from server', {
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean
        });
        setIsConnected(false);
        setCurrentRoom(null);
        setConnectedUsers([]);
        
        // Auto-retry dopo 2 secondi se non è una disconnessione pulita
        if (!event.wasClean && event.code !== 1000) {
          console.log('[Sync] Will retry in 2 seconds...');
          setTimeout(connect, 2000);
        }
      };

      ws.onerror = (error) => {
        console.error('[Sync] WebSocket error:', error);
        console.error('[Sync] WebSocket state:', ws?.readyState);
        console.error('[Sync] Server URL:', serverUrl);
        console.error('[Sync] Browser supports WebSocket:', typeof WebSocket !== 'undefined');
      };

      ws.onmessage = (event) => {
        handleMessageRef.current?.(event.data);
      };
    } catch (error) {
      console.error('[Sync] Failed to create WebSocket:', error);
    }
  }, [serverUrl]);

  // Join room
  const joinRoom = useCallback((roomId: string, nickname?: string, ipAddress?: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      connect();
      setTimeout(() => joinRoom(roomId, nickname, ipAddress), 500);
      return;
    }

    // nickname non è più necessario con il nuovo sistema
    // nicknameRef.current = nickname;

    wsRef.current.send(JSON.stringify({
      type: 'join',
      roomId,
      clientId: clientIdRef.current,
      nickname,
      ipAddress // Inviamo anche il nostro IP
    }));

    setCurrentRoom(roomId);
    console.log(`[Sync] Joined room: ${roomId}`);
  }, [connect]);

  // Leave room
  const leaveRoom = useCallback(() => {
    if (!wsRef.current || !currentRoom) return;

    wsRef.current.send(JSON.stringify({
      type: 'leave',
      roomId: currentRoom,
      clientId: clientIdRef.current
    }));

    setCurrentRoom(null);
    setConnectedUsers([]);
    console.log('[Sync] Left room');
  }, [currentRoom]);

  // Disconnect
  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
    setCurrentRoom(null);
    setConnectedUsers([]);
  }, []);

  const sendJournalAction = useCallback((action: JournalSyncAction) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    if (!currentRoom) return;

    wsRef.current.send(JSON.stringify({
      type: 'journal-action',
      action,
      clientId: clientIdRef.current
    }));
  }, [currentRoom]);

  const sendJournalState = useCallback((state: JournalSyncState) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    if (!currentRoom) return;

    wsRef.current.send(JSON.stringify({
      type: 'journal-state',
      state,
      clientId: clientIdRef.current
    }));
  }, [currentRoom]);

  const sendBoardState = useCallback((state: BoardSyncState) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    if (!currentRoom) return;

    wsRef.current.send(JSON.stringify({
      type: 'board-state',
      state,
      clientId: clientIdRef.current
    }));
  }, [currentRoom]);

  // Applica stato iniziale
  const applyInitialState = useCallback((state: any) => {
    const currentCanvas = canvasRef.current;
    if (!state || !isCanvasUsable(currentCanvas)) return;

    isApplyingRemoteChangeRef.current = true;
    
    try {
      currentCanvas.loadFromJSON(state, () => {
        renderIfReady(currentCanvas);
        console.log('[Sync] Initial state loaded');
        notifyRemoteApplied();
        isApplyingRemoteChangeRef.current = false;
      });
    } catch (error) {
      console.error('[Sync] Error loading initial state:', error);
      isApplyingRemoteChangeRef.current = false;
    }
  }, []);

  // Applica stato completo
  const applyFullState = useCallback((state: any) => {
    const currentCanvas = canvasRef.current;
    if (!state || !isCanvasUsable(currentCanvas)) return;

    isApplyingRemoteChangeRef.current = true;
    
    try {
      // 🚫 Disabilita temporaneamente gli eventi per prevenire loop
      const originalEventListeners = currentCanvas.__eventListeners;
      currentCanvas.__eventListeners = {};
      
      currentCanvas.loadFromJSON(state, () => {
        // 🔄 Ripristina gli eventi dopo il caricamento
        currentCanvas.__eventListeners = originalEventListeners;
        renderIfReady(currentCanvas);
        notifyRemoteApplied();
        
        // � RITARDA il ripristino del flag per evitare loop con pushHistoryState
        setTimeout(() => {
          isApplyingRemoteChangeRef.current = false;
        }, 25);
        
        // �📐 Applica backgroundMode DOPO il render finale per evitare multi-render
        if (state.backgroundMode && (window as any).setBackgroundMode) {
          console.log('📐 [SYNC] Applying backgroundMode:', state.backgroundMode);
          // 🚨 Imposta un flag per evitare che setBackgroundMode scateni nuova sincronizzazione
          (window as any).isApplyingRemoteBackgroundMode = true;
          (window as any).setBackgroundMode(state.backgroundMode);
          // 🔄 Resetta il flag dopo un breve ritardo
          setTimeout(() => {
            (window as any).isApplyingRemoteBackgroundMode = false;
          }, 100);
        }
      });
    } catch (error) {
      console.error('[Sync] Error applying full state:', error);
      // 🔄 Assicurati di ripristinare gli eventi anche in caso di errore
      isApplyingRemoteChangeRef.current = false;
    }
  }, []);

  // Applica update remoto
  const applyRemoteUpdate = useCallback((update: CanvasUpdate) => {
    const currentCanvas = canvasRef.current;
    if (!isCanvasUsable(currentCanvas)) return;

    isApplyingRemoteChangeRef.current = true;

    try {
      switch (update.type) {
        case 'object:added': {
          console.log('[Sync] Adding object to canvas:', update.data);
          console.log('[Sync] Object ID from remote:', update.data.id);
          const fabricGlobal = (window as any).fabric;
          const fabricPromise = fabricGlobal?.util?.enlivenObjects
            ? Promise.resolve(fabricGlobal)
            : lazyImportFabric();
          fabricPromise
            .then((fabricModule) => {
              fabricModule.util.enlivenObjects([update.data], (objects: any[]) => {
                const [enlivened] = objects ?? [];
                if (!enlivened) {
                  isApplyingRemoteChangeRef.current = false;
                  return;
                }
                const exists = currentCanvas.getObjects().some((o: any) => o.id === update.data.id);
                if (!exists) {
                  currentCanvas.add(enlivened);
                  renderIfReady(currentCanvas);
                  console.log('[Sync] Object added and rendered with ID:', update.data.id);
                }
                notifyRemoteApplied();
                isApplyingRemoteChangeRef.current = false;
              });
            })
            .catch((error) => {
              console.error('[Sync] Error enlivening object:', error);
              isApplyingRemoteChangeRef.current = false;
            });
          return;
        }

        case 'object:modified':
          const obj = currentCanvas.getObjects().find((o: any) => o.id === update.data.id);
          if (obj) {
            obj.set(update.data);
            renderIfReady(currentCanvas);
            notifyRemoteApplied();
          }
          break;

        case 'object:removed':
          console.log('[Sync] Removing object:', update.data.id);
          console.log('[Sync] Current objects in canvas:', currentCanvas.getObjects().map((o: any) => ({ id: o.id, type: o.type })));
          const toRemove = currentCanvas.getObjects().find((o: any) => o.id === update.data.id);
          if (toRemove) {
            console.log('[Sync] Object found and removed:', update.data.id);
            currentCanvas.remove(toRemove);
            renderIfReady(currentCanvas);
            notifyRemoteApplied();
          } else {
            console.log('[Sync] Object not found for removal (ignoring):', update.data.id);
            // Non è un errore - potrebbe essere un oggetto temporaneo del disegno
          }
          break;

        default:
          console.warn('[Sync] Unknown update type:', update.type);
      }
      isApplyingRemoteChangeRef.current = false;
    } catch (error) {
      console.error('[Sync] Error applying remote update:', error);
      isApplyingRemoteChangeRef.current = false;
    }
  }, []);

  // Handler messaggi
  const handleMessage = useCallback((data: string) => {
    console.log('[Sync] Raw message received:', data);

    try {
      const message = JSON.parse(data);
      console.log('[Sync] Parsed message:', message);

      switch (message.type) {
        case 'user-list':
          console.log('[Sync] Received user list:', message.users);
          setConnectedUsers(message.users || []);
          break;

        case 'client-joined':
          console.log(`[Sync] ${message.nickname || message.clientId} joined`);
          
          if (isCanvasUsable(canvasRef.current)) {
            // 🔄 Permetti l'invio di canvas vuoti quando un nuovo client si connette
            forceSendEmptyRef.current = true;
            sendFullStateRef.current?.();
          }

          if (journalSyncRef.current?.getState) {
            const journalState = journalSyncRef.current.getState();
            if (journalState) {
              sendJournalState(journalState);
            }
          }

          if (boardSyncRef.current?.getState) {
            const boardState = boardSyncRef.current.getState();
            if (boardState) {
              sendBoardState(boardState);
            }
          }
          
          // Se siamo un nuovo utente, carichiamo dal MBD
          if (documentId && connectedUsers.length > 0) {
            loadFromMBD();
          }
          break;

        case 'client-disconnected':
          console.log(`[Sync] ${message.clientId} left`);
          break;

        case 'pong':
          const latencyMs = Date.now() - message.timestamp;
          setLatency(latencyMs);
          break;

        case 'initial-state':
          if (canvasRef.current) applyInitialState(message.state);
          break;

        case 'canvas-update':
          console.log('[Sync] canvas-update received:', {
            from: message.clientId,
            local: clientIdRef.current,
            sameClient: message.clientId === clientIdRef.current,
            hasCanvas: isCanvasUsable(canvasRef.current),
            canvasId: (canvasRef.current as any)?.lowerCanvasEl?.id
          });
          if (message.clientId !== clientIdRef.current) {
            if (!isCanvasUsable(canvasRef.current)) {
              pendingCanvasUpdatesRef.current.push(message.update);
              console.log('[Sync] Canvas not ready, queued update. Pending:', pendingCanvasUpdatesRef.current.length);
              scheduleFlushPendingRef.current?.();
              break;
            }
            console.log('[Sync] Applying remote update from', message.clientId);
            applyRemoteUpdate(message.update);
          }
          break;

        case 'canvas-full':
          console.log('[Sync] canvas-full received:', {
            from: message.clientId,
            local: clientIdRef.current,
            sameClient: message.clientId === clientIdRef.current,
            hasCanvas: isCanvasUsable(canvasRef.current),
            canvasId: (canvasRef.current as any)?.lowerCanvasEl?.id,
            backgroundColor: message.state?.backgroundColor,
            backgroundMode: message.state?.backgroundMode
          });
          
          // Log dettagliato per debug clientId
          console.log('🔍 [SYNC] CLIENT ID ANALYSIS:');
          console.log('  - Message clientId:', message.clientId);
          console.log('  - Local clientId:', clientIdRef.current);
          console.log('  - Are they equal?', message.clientId === clientIdRef.current);
          console.log('  - Message clientId length:', message.clientId?.length);
          console.log('  - Local clientId length:', clientIdRef.current?.length);
          console.log('  - Message clientId type:', typeof message.clientId);
          console.log('  - Local clientId type:', typeof clientIdRef.current);
          
          if (message.clientId !== clientIdRef.current) {
            console.log('✅ [SYNC] CLIENT IDs DIFFERENT - Applying remote canvas state');
            if (!isCanvasUsable(canvasRef.current)) {
              pendingCanvasFullStateRef.current = message.state;
              console.log('[Sync] Canvas not ready, queued full state.');
              scheduleFlushPendingRef.current?.();
              break;
            }
            console.log('[Sync] Applying remote full state from', message.clientId);
            applyFullState(message.state);
          } else {
            console.log('🚫 [SYNC] SAME CLIENT ID - Skipping own canvas state');
          }
          break;

        case 'journal-action':
          if (message.clientId !== clientIdRef.current) {
            journalSyncRef.current?.onAction?.(message.action);
          }
          break;

        case 'journal-state':
          if (message.clientId !== clientIdRef.current) {
            if (journalSyncRef.current?.onState) {
              journalSyncRef.current.onState(message.state);
            } else if (journalSyncRef.current?.onAction) {
              journalSyncRef.current.onAction({
                type: 'journal-set',
                entries: message.state?.entries ?? [],
                selectedProfileId: message.state?.selectedProfileId,
                isJournalOpen: message.state?.isJournalOpen,
                isCalculatorOpen: message.state?.isCalculatorOpen,
                calculatorDisplay: message.state?.calculatorDisplay,
                selectedField: message.state?.selectedField ?? null,
                calculatorTarget: message.state?.calculatorTarget ?? null,
                journalScroll: message.state?.journalScroll ?? null
              });
            }
          }
          break;

        case 'board-state':
          if (message.clientId !== clientIdRef.current) {
            boardSyncRef.current?.onState?.(message.state);
          }
          break;

        default:
          console.warn('Unknown message type:', message.type);
      }
    } catch (error) {
      console.error('[Sync] Error handling message:', error);
    }
  }, [
    applyFullState,
    applyInitialState,
    applyRemoteUpdate,
    connectedUsers.length,
    documentId,
    loadFromMBD,
    sendJournalState,
    sendBoardState
  ]);

  useEffect(() => {
    handleMessageRef.current = handleMessage;
  }, [handleMessage]);

  const flushPendingUpdates = useCallback(() => {
    const activeCanvas = canvasRef.current;
    if (!isCanvasUsable(activeCanvas)) {
      return false;
    }
    if (pendingCanvasFullStateRef.current) {
      applyFullState(pendingCanvasFullStateRef.current);
      pendingCanvasFullStateRef.current = null;
    }
    if (pendingCanvasUpdatesRef.current.length > 0) {
      const updates = pendingCanvasUpdatesRef.current.splice(0, pendingCanvasUpdatesRef.current.length);
      updates.forEach(applyRemoteUpdate);
    }
    return true;
  }, [applyFullState, applyRemoteUpdate]);

  const scheduleFlushPendingRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    scheduleFlushPendingRef.current = () => {
      if (pendingFlushTimeoutRef.current !== null) return;
      pendingFlushTimeoutRef.current = window.setTimeout(() => {
        pendingFlushTimeoutRef.current = null;
        const flushed = flushPendingUpdates();
        if (!flushed && (pendingCanvasUpdatesRef.current.length > 0 || pendingCanvasFullStateRef.current)) {
          scheduleFlushPendingRef.current?.();
        }
      }, 150);
    };
  }, [flushPendingUpdates]);

  useEffect(() => {
    return () => {
      if (pendingFlushTimeoutRef.current !== null) {
        clearTimeout(pendingFlushTimeoutRef.current);
        pendingFlushTimeoutRef.current = null;
      }
    };
  }, []);

  // Invia stato completo
  const sendFullState = useCallback(() => {
    console.log('📤 [SYNC] sendFullState called');
    const activeCanvas = canvasRef.current;
    if (!isCanvasUsable(activeCanvas)) {
      console.log('❌ [SYNC] Canvas not usable');
      return;
    }
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.log('❌ [SYNC] WebSocket not ready');
      return;
    }
    if (!currentRoom) {
      console.log('❌ [SYNC] No current room');
      return;
    }

    const state = activeCanvas.toJSON(['id', 'selectable', 'evented']);
    
    // 🎨 Includi backgroundColor per sincronizzare lo sfondo
    state.background = state.background || activeCanvas.backgroundColor;
    if (activeCanvas.backgroundColor) {
      state.backgroundColor = activeCanvas.backgroundColor;
    }
    
    // 📐 Includi backgroundMode per sincronizzare sfondo a quadretti
    const backgroundMode = (window as any).appBackgroundMode;
    if (backgroundMode) {
      state.backgroundMode = backgroundMode;
    }
    
    // � Non inviare canvas vuoti a meno che non sia esplicitamente richiesto
    if ((!state.objects || state.objects.length === 0) && !forceSendEmptyRef.current) {
      console.log('❌ [SYNC] Skipping empty canvas send');
      return;
    }
    
    console.log('📤 [SYNC] Sending canvas-full with', state.objects?.length || 0, 'objects', 'backgroundColor:', state.backgroundColor, 'backgroundMode:', state.backgroundMode);

    wsRef.current.send(JSON.stringify({
      type: 'canvas-full',
      state,
      clientId: clientIdRef.current
    }));
    
    // Resetta il flag dopo l'invio
    forceSendEmptyRef.current = false;
  }, [currentRoom, canvasRef]);

  useEffect(() => {
    sendFullStateRef.current = sendFullState;
  }, [sendFullState]);

  useEffect(() => {
    if (!currentRoom || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    if (!isCanvasUsable(canvasRef.current)) return;
    wsRef.current.send(JSON.stringify({
      type: 'request-state',
      roomId: currentRoom
    }));
  }, [currentRoom]);

  // Ping per latenza
  useEffect(() => {
    if (!isConnected || !wsRef.current) return;

    const interval = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'ping',
          timestamp: Date.now()
        }));
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [isConnected]);

  // Connessione automatica al mount
  useEffect(() => {
    console.log('[Sync] Hook mounted, will connect in 1 second...');
    const timeoutId = setTimeout(() => {
      console.log('[Sync] Connecting now...');
      connect();
    }, 1000);

    return () => {
      clearTimeout(timeoutId);
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  return {
    isConnected,
    currentRoom,
    latency,
    connectedUsers,
    joinRoom,
    leaveRoom,
    disconnect,
    wsRef,
    clientIdRef,
    currentRoomRef,
    sendJournalAction,
    sendJournalState,
    sendBoardState,
    sendCanvasFullState: sendFullState,
    isApplyingRemoteChangeRef
  };
}

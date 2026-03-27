// ============================================================
// useCanvasSyncMultiRoom.ts
// Hook per sincronizzazione canvas multi-room via WebSocket
// ============================================================
// Path: apps/web/src/hooks/useCanvasSyncMultiRoom.ts

import { useEffect, useRef, useCallback, useState } from 'react';

export type ConnectedUser = {
  clientId: string;
  nickname?: string;
  connectedAt: number;
};

export type SyncState = {
  isConnected: boolean;
  currentRoom: string | null;
  latency: number | null;
  connectedUsers: ConnectedUser[];
};

export type SyncActions = {
  joinRoom: (roomId: string, nickname?: string) => void;
  leaveRoom: () => void;
  disconnect: () => void;
};

type CanvasUpdate = {
  type: 'object:added' | 'object:modified' | 'object:removed' | 'canvas:cleared';
  data: any;
  timestamp: number;
};

/**
 * Hook per sincronizzazione canvas in tempo reale con sistema multi-room
 * 
 * @param canvas - Istanza Fabric.js canvas da sincronizzare
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
  canvas: any | null, // Fabric Canvas type
  serverUrl: string
): SyncState & SyncActions {
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [currentRoom, setCurrentRoom] = useState<string | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [connectedUsers, setConnectedUsers] = useState<ConnectedUser[]>([]);
  
  const clientIdRef = useRef<string>(
    `client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  const nicknameRef = useRef<string | undefined>(undefined);
  const isApplyingRemoteChangeRef = useRef(false);
  const lastSyncRef = useRef<number>(0);
  const pendingUpdatesRef = useRef<CanvasUpdate[]>([]);

  // Connessione WebSocket
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    console.log('[Sync] Connecting to', serverUrl);
    const ws = new WebSocket(serverUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[Sync] Connected to server');
      setIsConnected(true);
    };

    ws.onclose = () => {
      console.log('[Sync] Disconnected from server');
      setIsConnected(false);
      setCurrentRoom(null);
      setConnectedUsers([]);
    };

    ws.onerror = (error) => {
      console.error('[Sync] WebSocket error:', error);
    };

    ws.onmessage = (event) => {
      handleMessage(event.data);
    };
  }, [serverUrl]);

  // Join room
  const joinRoom = useCallback((roomId: string, nickname?: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      connect();
      setTimeout(() => joinRoom(roomId, nickname), 500);
      return;
    }

    nicknameRef.current = nickname;

    wsRef.current.send(JSON.stringify({
      type: 'join',
      roomId,
      clientId: clientIdRef.current,
      nickname
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

  // Handler messaggi
  const handleMessage = useCallback((data: string) => {
    if (!canvas) return;

    try {
      const message = JSON.parse(data);

      switch (message.type) {
        case 'initial-state':
          applyInitialState(message.state);
          break;

        case 'canvas-update':
          if (message.clientId !== clientIdRef.current) {
            applyRemoteUpdate(message.update);
          }
          break;

        case 'canvas-full':
          if (message.clientId !== clientIdRef.current) {
            applyFullState(message.state);
          }
          break;

        case 'pong':
          const latencyMs = Date.now() - message.timestamp;
          setLatency(latencyMs);
          break;

        case 'user-list':
          setConnectedUsers(message.users || []);
          break;

        case 'client-joined':
          console.log(`[Sync] ${message.nickname || message.clientId} joined`);
          sendFullState();
          break;

        case 'client-disconnected':
          console.log(`[Sync] ${message.clientId} left`);
          break;
      }
    } catch (error) {
      console.error('[Sync] Error handling message:', error);
    }
  }, [canvas]);

  // Applica stato iniziale
  const applyInitialState = useCallback((state: any) => {
    if (!canvas || !state) return;

    isApplyingRemoteChangeRef.current = true;
    
    try {
      canvas.loadFromJSON(state, () => {
        canvas.renderAll();
        console.log('[Sync] Initial state loaded');
        isApplyingRemoteChangeRef.current = false;
      });
    } catch (error) {
      console.error('[Sync] Error loading initial state:', error);
      isApplyingRemoteChangeRef.current = false;
    }
  }, [canvas]);

  // Applica stato completo
  const applyFullState = useCallback((state: any) => {
    if (!canvas || !state) return;

    isApplyingRemoteChangeRef.current = true;
    
    try {
      canvas.loadFromJSON(state, () => {
        canvas.renderAll();
        isApplyingRemoteChangeRef.current = false;
      });
    } catch (error) {
      console.error('[Sync] Error applying full state:', error);
      isApplyingRemoteChangeRef.current = false;
    }
  }, [canvas]);

  // Applica update remoto
  const applyRemoteUpdate = useCallback((update: CanvasUpdate) => {
    if (!canvas) return;

    isApplyingRemoteChangeRef.current = true;

    try {
      switch (update.type) {
        case 'object:added':
          canvas.loadFromJSON({ objects: [update.data] }, () => {
            canvas.renderAll();
          });
          break;

        case 'object:modified':
          const obj = canvas.getObjects().find((o: any) => o.id === update.data.id);
          if (obj) {
            obj.set(update.data);
            canvas.renderAll();
          }
          break;

        case 'object:removed':
          const toRemove = canvas.getObjects().find((o: any) => o.id === update.data.id);
          if (toRemove) {
            canvas.remove(toRemove);
            canvas.renderAll();
          }
          break;

        case 'canvas:cleared':
          canvas.clear();
          canvas.renderAll();
          break;
      }
    } catch (error) {
      console.error('[Sync] Error applying remote update:', error);
    } finally {
      isApplyingRemoteChangeRef.current = false;
    }
  }, [canvas]);

  // Invia update
  const sendUpdate = useCallback((update: CanvasUpdate) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    if (isApplyingRemoteChangeRef.current) return;
    if (!currentRoom) return;

    const now = Date.now();
    if (now - lastSyncRef.current < 16) {
      pendingUpdatesRef.current.push(update);
      return;
    }

    lastSyncRef.current = now;

    wsRef.current.send(JSON.stringify({
      type: 'canvas-update',
      update,
      clientId: clientIdRef.current
    }));

    // Invia pending
    if (pendingUpdatesRef.current.length > 0) {
      pendingUpdatesRef.current.forEach(u => {
        wsRef.current?.send(JSON.stringify({
          type: 'canvas-update',
          update: u,
          clientId: clientIdRef.current
        }));
      });
      pendingUpdatesRef.current = [];
    }
  }, [currentRoom]);

  // Invia stato completo
  const sendFullState = useCallback(() => {
    if (!canvas || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    if (!currentRoom) return;

    const state = canvas.toJSON(['id', 'selectable', 'evented']);

    wsRef.current.send(JSON.stringify({
      type: 'canvas-full',
      state,
      clientId: clientIdRef.current
    }));
  }, [canvas, currentRoom]);

  // Setup event listeners canvas
  useEffect(() => {
    if (!canvas || !currentRoom) return;

    const handleObjectAdded = (e: any) => {
      if (isApplyingRemoteChangeRef.current) return;
      
      if (!e.target.id) {
        e.target.id = `obj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      }

      sendUpdate({
        type: 'object:added',
        data: e.target.toJSON(['id']),
        timestamp: Date.now()
      });
    };

    const handleObjectModified = (e: any) => {
      if (isApplyingRemoteChangeRef.current) return;

      sendUpdate({
        type: 'object:modified',
        data: e.target.toJSON(['id']),
        timestamp: Date.now()
      });
    };

    const handleObjectRemoved = (e: any) => {
      if (isApplyingRemoteChangeRef.current) return;

      sendUpdate({
        type: 'object:removed',
        data: { id: e.target.id },
        timestamp: Date.now()
      });
    };

    canvas.on('object:added', handleObjectAdded);
    canvas.on('object:modified', handleObjectModified);
    canvas.on('object:removed', handleObjectRemoved);

    return () => {
      canvas.off('object:added', handleObjectAdded);
      canvas.off('object:modified', handleObjectModified);
      canvas.off('object:removed', handleObjectRemoved);
    };
  }, [canvas, currentRoom, sendUpdate]);

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

  // Auto-connect on mount
  useEffect(() => {
    connect();
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  return {
    isConnected,
    currentRoom,
    latency,
    connectedUsers,
    joinRoom,
    leaveRoom,
    disconnect
  };
}

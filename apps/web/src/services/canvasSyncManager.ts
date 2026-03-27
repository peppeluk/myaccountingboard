export interface DiscoveredDevice {
  id: string;
  name: string;
  ip: string;
  port: number;
  lastSeen: number;
  isLocal: boolean;
}

export interface SyncData {
  type: 'canvas_update' | 'cursor_update' | 'connection_signal';
  deviceId: string;
  timestamp: number;
  data: any;
}

export class CanvasSyncManager {
  private localDeviceId: string;
  private connectedDevices: Map<string, DiscoveredDevice> = new Map();
  private onSyncDataCallback?: (data: SyncData) => void;
  private storageKey = 'myaccounting-canvas-sync';
  private lastSyncTimestamp = 0;
  private syncInterval: NodeJS.Timeout | null = null;
  private storageListener: ((e: StorageEvent) => void) | null = null;
  private pollingInterval: NodeJS.Timeout | null = null;

  constructor(localDeviceId: string) {
    this.localDeviceId = localDeviceId;
  }

  // Connette a un dispositivo remoto
  connectToDevice(device: DiscoveredDevice): void {
    console.log('🔗 Connecting to device for sync:', device.name);
    
    // Inizia a ascoltare i dati di sincronizzazione
    this.startListening();
    
    // Inizia il broadcast periodico del nostro stato
    this.startBroadcasting();
    
    // NOTIFICA l'altro dispositivo che siamo connessi
    // Scriviamo nel localStorage un segnale di connessione
    const connectionSignal = {
      type: 'connection_signal',
      fromDeviceId: this.localDeviceId,
      toDeviceId: device.id, // 🎯 USA L'ID REALE DEL DISPOSITIVO REMOTO
      timestamp: Date.now()
    };
    
    console.log('📡 Sending connection signal:', {
      from: this.localDeviceId,
      to: device.id,
      deviceName: device.name
    });
    
    console.log('🔍 Full connection signal object:', connectionSignal);
    
    try {
      const signals = this.getStoredConnectionSignals();
      signals[`${this.localDeviceId}-${device.id}`] = connectionSignal;
      localStorage.setItem('myaccounting-connection-signals', JSON.stringify(signals));
      console.log('✅ Connection signal sent to:', device.name);
    } catch (error) {
      console.error('❌ Error sending connection signal:', error);
    }
    
    // 🚨 CRITICO: Aggiungi il dispositivo SOLO DOPO aver inviato il segnale
    // Questo previene race conditions dove l'altro dispositivo vede il segnale
    // ma questo dispositivo è già considerato "connesso" e salta il segnale
    this.connectedDevices.set(device.id, device);
    
    console.log('✅ Canvas sync started with device:', device.name);
  }

  // Disconnette da un dispositivo
  disconnectFromDevice(deviceId: string): void {
    console.log('🔌 Disconnecting from device:', {
      deviceId,
      deviceName: this.connectedDevices.get(deviceId)?.name || 'Unknown',
      remainingDevices: this.connectedDevices.size - 1
    });
    
    this.connectedDevices.delete(deviceId);
    
    // Rimuovi segnali di connessione per questo dispositivo
    const signals = this.getStoredConnectionSignals();
    Object.keys(signals).forEach(key => {
      if (key.includes(deviceId)) {
        delete signals[key];
      }
    });
    
    if (Object.keys(signals).length > 0) {
      localStorage.setItem('myaccounting-connection-signals', JSON.stringify(signals));
    } else {
      localStorage.removeItem('myaccounting-connection-signals');
    }
    
    console.log('👋 Device disconnected and connection signals cleaned');
  }

  // Imposta il callback per i dati di sincronizzazione
  onSyncData(callback: (data: SyncData) => void): void {
    this.onSyncDataCallback = callback;
  }

  // Sincronizza gli oggetti del canvas
  syncCanvasObjects(objects: any[]): void {
    const syncData: SyncData = {
      type: 'canvas_update',
      deviceId: this.localDeviceId,
      timestamp: Date.now(),
      data: { objects }
    };

    this.broadcastData(syncData);
  }

  // Sincronizza la posizione del cursore
  syncCursor(x: number, y: number, isDrawing: boolean, tool: string): void {
    const syncData: SyncData = {
      type: 'cursor_update',
      deviceId: this.localDeviceId,
      timestamp: Date.now(),
      data: { x, y, isDrawing, tool }
    };

    this.broadcastData(syncData);
  }

  // Broadcast dei dati di sincronizzazione
  private broadcastData(data: SyncData): void {
    try {
      // Usa localStorage per condividere dati tra dispositivi
      const existingData = this.getStoredSyncData();
      existingData[this.localDeviceId] = data;
      
      localStorage.setItem(this.storageKey, JSON.stringify(existingData));
      
      // Pulisci i dati vecchi (più di 30 secondi)
      this.cleanupOldData();
      
    } catch (error) {
      console.error('❌ Error broadcasting sync data:', error);
    }
  }

  // Ottiene i segnali di connessione dal localStorage
  private getStoredConnectionSignals(): Record<string, any> {
    try {
      const signals = localStorage.getItem('myaccounting-connection-signals');
      return signals ? JSON.parse(signals) : {};
    } catch (error) {
      return {};
    }
  }

  // Processa i segnali di connessione
  private processConnectionSignals(): void {
    const signals = this.getStoredConnectionSignals();
    const currentTime = Date.now();
    
    if (Object.keys(signals).length === 0) {
      return;
    }
    
    console.log(`🔍 Processing ${Object.keys(signals).length} connection signals`);
    console.log('📋 All signals:', signals);
    console.log('🆔 Local device ID:', this.localDeviceId);
    
    Object.entries(signals).forEach(([key, signal]: [string, any]) => {
      console.log(`🔍 Examining signal: ${key}`, {
        signal,
        isForUs: signal.toDeviceId === this.localDeviceId,
        isFromUs: signal.fromDeviceId === this.localDeviceId,
        alreadyConnected: this.connectedDevices.has(signal.fromDeviceId),
        toDeviceId: signal.toDeviceId,
        fromDeviceId: signal.fromDeviceId,
        localDeviceId: this.localDeviceId
      });
      
      // Rimuovi segnali vecchi (più di 10 secondi)
      if (currentTime - signal.timestamp > 10000) {
        console.log(`🗑️ Removing old signal: ${key}`);
        delete signals[key];
        return;
      }
      
      const isForUs = signal.toDeviceId === this.localDeviceId;
      const isFromUs = signal.fromDeviceId === this.localDeviceId;
      const alreadyConnected = this.connectedDevices.has(signal.fromDeviceId);
      
      // Se il segnale è per noi e non è da noi stessi e non siamo già connessi
      if (isForUs && !isFromUs && !alreadyConnected) {
        console.log('🔗 Received connection signal from device:', signal.fromDeviceId);
        
        // Crea un dispositivo fittizio basato sul segnale
        const connectedDevice: DiscoveredDevice = {
          id: signal.fromDeviceId,
          name: `Device-${signal.fromDeviceId.split('-')[1]}`,
          ip: 'localhost',
          port: 5174,
          lastSeen: Date.now(),
          isLocal: false
        };
        
        // Connettiti reciprocamente
        this.connectedDevices.set(signal.fromDeviceId, connectedDevice);
        console.log('✅ Reciprocally connected to device:', signal.fromDeviceId);
        console.log('📊 Total connected devices now:', this.connectedDevices.size);
      } else if (isFromUs) {
        // Silenziosamente ignora i nostri stessi segnali
        console.log('🔄 Ignoring our own signal:', key);
        delete signals[key];
      } else {
        console.log(`⏭️ Skipping signal: ${key}`, {
          isForUs,
          isFromUs,
          alreadyConnected
        });
      }
    });
    
    // Aggiorna i segnali nel localStorage
    if (Object.keys(signals).length > 0) {
      localStorage.setItem('myaccounting-connection-signals', JSON.stringify(signals));
    } else {
      localStorage.removeItem('myaccounting-connection-signals');
    }
  }

  // Inizia ad ascoltare i dati di sincronizzazione
  private startListening(): void {
    console.log('👂 Starting to listen for sync data...');
    
    // Processa segnali di connessione esistenti
    this.processConnectionSignals();
    
    // Gestisce gli eventi di storage per sincronizzazione cross-tab
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === this.storageKey && e.newValue) {
        try {
          const data = JSON.parse(e.newValue);
          this.processSyncData();
        } catch (error) {
          console.error('❌ Error parsing sync data:', error);
        }
      } else if (e.key === 'myaccounting-connection-signals') {
        this.processConnectionSignals();
      }
    };

    window.addEventListener('storage', handleStorageChange);
    
    // Polling per fallback su browser che non supportano bene gli eventi storage
    const pollInterval = setInterval(() => {
      this.processSyncData();
      this.processConnectionSignals();
    }, 100);

    // Salva i riferimenti per cleanup
    this.storageListener = handleStorageChange;
    this.pollingInterval = pollInterval;
    
    console.log('✅ Sync listening started');
  }

  // Processa i dati di sincronizzazione dal localStorage
  private processSyncData(): void {
    try {
      const storedData = this.getStoredSyncData();
      
      Object.entries(storedData).forEach(([deviceId, data]) => {
        // Ignora i nostri dati
        if (deviceId === this.localDeviceId) {
          return;
        }
        
        // Ignora dati da dispositivi non connessi
        if (!this.connectedDevices.has(deviceId)) {
          return;
        }
        
        // Processa solo dati più recenti
        if (data.timestamp <= this.lastSyncTimestamp) {
          return;
        }
        
        this.lastSyncTimestamp = data.timestamp;
        
        // Invia i dati al callback
        if (this.onSyncDataCallback) {
          this.onSyncDataCallback(data);
        }
      });
      
    } catch (error) {
      console.error('❌ Error processing sync data:', error);
    }
  }

  // Inizia il broadcast periodico
  private startBroadcasting(): void {
    // Il broadcast è event-based, non abbiamo bisogno di broadcast periodico
    // Ma possiamo aggiungere un heartbeat per mantenere la connessione viva
    this.syncInterval = setInterval(() => {
      // Invia un heartbeat periodico
      const heartbeat: SyncData = {
        type: 'cursor_update',
        deviceId: this.localDeviceId,
        timestamp: Date.now(),
        data: { x: -1, y: -1, isDrawing: false, tool: 'heartbeat' }
      };
      
      this.broadcastData(heartbeat);
    }, 5000); // Ogni 5 secondi
  }

  // Ferma il broadcast periodico
  private stopBroadcasting(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  // Ottiene i dati di sincronizzazione dal localStorage
  private getStoredSyncData(): Record<string, SyncData> {
    try {
      const data = localStorage.getItem(this.storageKey);
      return data ? JSON.parse(data) : {};
    } catch (error) {
      console.error('❌ Error reading stored sync data:', error);
      return {};
    }
  }

  // Pulisce i dati vecchi
  private cleanupOldData(): void {
    try {
      const allData = this.getStoredSyncData();
      const now = Date.now();
      const timeout = 30000; // 30 secondi
      
      Object.keys(allData).forEach(deviceId => {
        const deviceData = allData[deviceId];
        if (deviceData && now - deviceData.timestamp > timeout) {
          delete allData[deviceId];
        }
      });
      
      localStorage.setItem(this.storageKey, JSON.stringify(allData));
    } catch (error) {
      console.error('❌ Error cleaning up old data:', error);
    }
  }

  // Ferma la sincronizzazione
  stop(): void {
    console.log('🛑 Canvas sync stopped');
    
    // Ferma l'ascolto
    if (this.storageListener) {
      window.removeEventListener('storage', this.storageListener);
      this.storageListener = null;
    }
    
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    
    // Ferma il broadcast
    this.stopBroadcasting();
    
    // Pulisci i dati
    this.connectedDevices.clear();
    this.onSyncDataCallback = undefined;
  }

  // Ottiene i dispositivi connessi
  getConnectedDevices(): DiscoveredDevice[] {
    return Array.from(this.connectedDevices.values());
  }

  // Verifica se un dispositivo è connesso
  isDeviceConnected(deviceId: string): boolean {
    return this.connectedDevices.has(deviceId);
  }
}

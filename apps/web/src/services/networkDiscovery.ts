import { v4 as uuidv4 } from 'uuid';
import { DeviceInfoAPI } from './deviceInfoAPI';

export interface DiscoveredDevice {
  id: string;
  name: string;
  ip: string;
  port: number;
  lastSeen: number;
  isLocal: boolean;
}

export interface DeviceInfo {
  id: string;
  name: string;
  port: number;
}

export class NetworkDiscovery {
  private devices: Map<string, DiscoveredDevice> = new Map();
  private localDevice: DeviceInfo;
  private wsServer: WebSocket | null = null;
  private broadcastInterval: NodeJS.Timeout | null = null;
  private scanInterval: NodeJS.Timeout | null = null;
  private onDeviceFoundCallbacks: ((device: DiscoveredDevice) => void)[] = [];
  private onDeviceLostCallbacks: ((deviceId: string) => void)[] = [];
  private httpServer: any = null;
  private deviceAPI: DeviceInfoAPI | null = null;

  constructor(deviceName: string, port: number = 5174) {
    this.localDevice = {
      id: uuidv4(),
      name: deviceName,
      port: port
    };
  }

  // Inizia la scoperta di dispositivi
  async startDiscovery(): Promise<void> {
    console.log('🔍 Starting network discovery...');
    
    try {
      // Avvia il server HTTP per essere scoperto
      await this.startHttpServer();
      
      // Avvia il server WebSocket per comunicazione
      await this.startWebSocketServer();
      
      // Inizia la scansione della rete
      this.startNetworkScanning();
      
      // Inizia il cleanup dei dispositivi persi
      this.startCleanup();
      
      console.log('✅ Network discovery started successfully');
    } catch (error) {
      console.error('❌ Error starting network discovery:', error);
      throw error;
    }
  }

  // Ferma la scoperta
  stopDiscovery(): void {
    console.log('🛑 Stopping network discovery...');
    
    if (this.broadcastInterval) {
      clearInterval(this.broadcastInterval);
      this.broadcastInterval = null;
    }
    
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
    
    if (this.wsServer) {
      this.wsServer.close();
      this.wsServer = null;
    }
    
    if (this.httpServer) {
      this.httpServer.close();
      this.httpServer = null;
    }
    
    if (this.deviceAPI) {
      this.deviceAPI.stop();
      this.deviceAPI = null;
    }
    
    this.devices.clear();
  }

  // Avvia server HTTP per essere scoperto
  private async startHttpServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // In un browser non possiamo creare un server HTTP reale
        // Ma possiamo avviare l'API per rispondere alle richieste
        this.deviceAPI = new DeviceInfoAPI(this.localDevice);
        this.deviceAPI.start();
        
        console.log(`🌐 DeviceInfo API started on port ${this.localDevice.port}`);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }

  // Avvia server WebSocket per comunicazione
  private async startWebSocketServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // In un ambiente browser, non possiamo creare un WebSocket server
        // Creiamo solo un client WebSocket per la comunicazione
        console.log(`📡 WebSocket client ready on port ${this.localDevice.port}`);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }

  // Inizia la scansione della rete
  private startNetworkScanning(): void {
    console.log('🔍 Starting network scanning...');
    
    // Scansione immediata
    this.scanNetwork();
    
    // Scansione periodica ogni 10 secondi
    this.scanInterval = setInterval(() => {
      this.scanNetwork();
    }, 10000);
  }

  // Scansiona la rete alla ricerca di dispositivi
  private async scanNetwork(): Promise<void> {
    console.log('🔍 Scanning network for devices...');
    
    const baseIP = this.getBaseIP();
    if (!baseIP) {
      console.warn('⚠️ Could not determine base IP for scanning');
      return;
    }

    // Scansiona range IP locale (es. 192.168.1.1-254)
    const scanPromises: Promise<void>[] = [];
    
    for (let i = 1; i <= 254; i++) {
      const ip = `${baseIP}.${i}`;
      scanPromises.push(this.scanDevice(ip));
    }

    try {
      await Promise.allSettled(scanPromises);
      console.log(`✅ Network scan completed. Found ${this.devices.size} devices.`);
    } catch (error) {
      console.error('❌ Error during network scan:', error);
    }
  }

  // Scansiona un singolo dispositivo
  private async scanDevice(ip: string): Promise<void> {
    try {
      // Ignora il nostro IP
      if (ip === this.getLocalIP()) {
        return;
      }

      // Prova a connetterti al dispositivo sulla porta della nostra app
      const response = await this.tryConnectToDevice(ip, this.localDevice.port);
      
      if (response) {
        const device: DiscoveredDevice = {
          id: uuidv4(),
          name: response.deviceName || `Device-${ip.split('.').pop()}`,
          ip: ip,
          port: response.port || this.localDevice.port,
          lastSeen: Date.now(),
          isLocal: this.isLocalIP(ip)
        };

        const existingDevice = this.devices.get(device.id);
        if (!existingDevice) {
          console.log('🎉 New device discovered:', device);
          this.devices.set(device.id, device);
          this.notifyDeviceFound(device);
        } else {
          existingDevice.lastSeen = Date.now();
        }
      }
    } catch (error) {
      // Silently ignore connection errors - normal during scanning
    }
  }

  // Prova a connetterti a un dispositivo
  private async tryConnectToDevice(ip: string, port: number): Promise<{ deviceName?: string; port?: number } | null> {
    try {
      // Prova connessione HTTP con timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000); // 2 secondi timeout

      const response = await fetch(`http://${ip}:${port}/api/device-info`, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'MyAccounting-Discovery/1.0'
        }
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        return {
          deviceName: data.name,
          port: data.port || port
        };
      }
    } catch (error) {
      // Expected - most devices won't have our app running
    }

    try {
      // Prova connessione WebSocket
      const ws = new WebSocket(`ws://${ip}:${port}`);
      
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          ws.close();
          resolve(null);
        }, 2000);

        ws.onopen = () => {
          clearTimeout(timeout);
          
          // Invia richiesta info dispositivo
          ws.send(JSON.stringify({
            type: 'get_device_info',
            timestamp: Date.now()
          }));

          // Ascolta risposta
          ws.onmessage = (event) => {
            try {
              const data = JSON.parse(event.data);
              if (data.type === 'device_info_response') {
                clearTimeout(timeout);
                ws.close();
                resolve({
                  deviceName: data.name,
                  port: data.port || port
                });
              }
            } catch (error) {
              // Ignore parsing errors
            }
          };

          // Fallback se non riceve risposta
          setTimeout(() => {
            clearTimeout(timeout);
            ws.close();
            resolve({
              deviceName: `Device-${ip.split('.').pop()}`,
              port: port
            });
          }, 1000);
        };

        ws.onerror = () => {
          clearTimeout(timeout);
          resolve(null);
        };
      });
    } catch (error) {
      // WebSocket non supportato o fallito
    }

    return null;
  }

  // Cleanup dei dispositivi persi
  private startCleanup(): void {
    setInterval(() => {
      const now = Date.now();
      const timeout = 30000; // 30 secondi
      
      for (const [deviceId, device] of this.devices.entries()) {
        if (now - device.lastSeen > timeout) {
          console.log('👋 Device lost:', device.name);
          this.devices.delete(deviceId);
          this.notifyDeviceLost(deviceId);
        }
      }
    }, 5000);
  }

  // Ottiene l'IP locale
  private getLocalIP(): string {
    // Tenta di ottenere l'IP locale tramite WebRTC
    if (typeof window !== 'undefined' && window.RTCPeerConnection) {
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });

      pc.createDataChannel('');
      
      return new Promise((resolve) => {
        pc.createOffer()
          .then(offer => pc.setLocalDescription(offer))
          .then(() => {
            pc.onicecandidate = (event) => {
              if (event.candidate) {
                const candidate = event.candidate.candidate;
                const match = candidate.match(/(\d+\.\d+\.\d+\.\d+)/);
                if (match && match[1] && !match[1].startsWith('127.')) {
                  resolve(match[1]);
                }
              }
            };
          });
      }) as any;
    }

    // Fallback: rileva dall'URL corrente
    if (typeof window !== 'undefined' && window.location) {
      const hostname = window.location.hostname;
      if (hostname !== 'localhost' && !hostname.startsWith('127.')) {
        return hostname;
      }
    }

    // Fallback finale
    return '192.168.1.100';
  }

  // Ottiene la base IP per scanning (es. 192.168.1 da 192.168.1.100)
  private getBaseIP(): string | null {
    const localIP = this.getLocalIP();
    const parts = localIP.split('.');
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.${parts[2]}`;
    }
    return null;
  }

  // Controlla se è un IP locale
  private isLocalIP(ip: string): boolean {
    return ip.startsWith('192.168.') || 
           ip.startsWith('10.') || 
           ip.startsWith('172.') ||
           ip === 'localhost' ||
           ip === '127.0.0.1';
  }

  // Callback per dispositivo trovato
  onDeviceFound(callback: (device: DiscoveredDevice) => void): void {
    this.onDeviceFoundCallbacks.push(callback);
  }

  // Callback per dispositivo perso
  onDeviceLost(callback: (deviceId: string) => void): void {
    this.onDeviceLostCallbacks.push(callback);
  }

  // Notifica i callback
  private notifyDeviceFound(device: DiscoveredDevice): void {
    this.onDeviceFoundCallbacks.forEach(callback => callback(device));
  }

  private notifyDeviceLost(deviceId: string): void {
    this.onDeviceLostCallbacks.forEach(callback => callback(deviceId));
  }

  // Ottiene la lista dei dispositivi scoperti
  getDiscoveredDevices(): DiscoveredDevice[] {
    return Array.from(this.devices.values());
  }

  // Ottiene info del dispositivo locale
  getLocalDevice(): DeviceInfo {
    return this.localDevice;
  }
}

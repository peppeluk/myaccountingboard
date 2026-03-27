// Sistema di scoperta basato su localStorage e polling
import { v4 as uuidv4 } from 'uuid';

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

export class SimpleNetworkDiscovery {
  private devices: Map<string, DiscoveredDevice> = new Map();
  private localDevice: DeviceInfo;
  private pollInterval: NodeJS.Timeout | null = null;
  private storageKey = 'myaccounting-devices';
  private onDeviceFoundCallbacks: ((device: DiscoveredDevice) => void)[] = [];
  private onDeviceLostCallbacks: ((deviceId: string) => void)[] = [];

  constructor(deviceName: string, port: number = 5173) {
    this.localDevice = {
      id: uuidv4(),
      name: deviceName,
      port: port
    };
  }

  async startDiscovery(): Promise<void> {
    console.log('🔍 Starting simple network discovery...');
    
    // Registra il dispositivo locale
    this.registerLocalDevice();
    
    // Inizia il polling per scoprire altri dispositivi
    this.startPolling();
    
    // Inizia il cleanup
    this.startCleanup();
    
    console.log('✅ Simple discovery started');
  }

  stopDiscovery(): void {
    console.log('🛑 Stopping discovery...');
    
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    
    // Rimuovi il dispositivo locale dal localStorage
    this.unregisterLocalDevice();
    
    this.devices.clear();
  }

  private registerLocalDevice(): void {
    try {
      const devices = this.getStoredDevices();
      const localDevice = {
        id: this.localDevice.id,
        name: this.localDevice.name,
        ip: this.getDeviceIP(),
        port: this.localDevice.port,
        lastSeen: Date.now(),
        isLocal: true
      };
      
      devices[this.localDevice.id] = localDevice;
      localStorage.setItem(this.storageKey, JSON.stringify(devices));
      
      console.log('📝 Local device registered:', localDevice);
    } catch (error) {
      console.error('❌ Error registering local device:', error);
    }
  }

  private unregisterLocalDevice(): void {
    try {
      const devices = this.getStoredDevices();
      delete devices[this.localDevice.id];
      localStorage.setItem(this.storageKey, JSON.stringify(devices));
    } catch (error) {
      console.error('❌ Error unregistering local device:', error);
    }
  }

  private getStoredDevices(): Record<string, any> {
    try {
      const stored = localStorage.getItem(this.storageKey);
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  }

  private startPolling(): void {
    // Poll immediato
    this.pollDevices();
    
    // Poll ogni 3 secondi
    this.pollInterval = setInterval(() => {
      this.pollDevices();
    }, 3000);
  }

  private pollDevices(): void {
    try {
      const devices = this.getStoredDevices();
      const now = Date.now();
      
      Object.entries(devices).forEach(([id, device]) => {
        // Ignora il nostro dispositivo
        if (id === this.localDevice.id) {
          return;
        }
        
        // Se il dispositivo è troppo vecchio, ignoralo
        if (now - device.lastSeen > 30000) { // 30 secondi
          return;
        }
        
        const discoveredDevice: DiscoveredDevice = {
          id: device.id,
          name: device.name,
          ip: device.ip,
          port: device.port,
          lastSeen: device.lastSeen,
          isLocal: this.isLocalIP(device.ip)
        };
        
        const existingDevice = this.devices.get(id);
        if (!existingDevice) {
          console.log('🎉 New device discovered:', discoveredDevice);
          this.devices.set(id, discoveredDevice);
          this.notifyDeviceFound(discoveredDevice);
        } else {
          existingDevice.lastSeen = device.lastSeen;
        }
      });
    } catch (error) {
      console.error('❌ Error polling devices:', error);
    }
  }

  private startCleanup(): void {
    setInterval(() => {
      const now = Date.now();
      const timeout = 15000; // 15 secondi
      
      for (const [deviceId, device] of this.devices.entries()) {
        if (now - device.lastSeen > timeout) {
          console.log('👋 Device lost:', device.name);
          this.devices.delete(deviceId);
          this.notifyDeviceLost(deviceId);
        }
      }
    }, 5000);
  }

  private getDeviceIP(): string {
    // In un ambiente reale, qui otterremmo l'IP reale
    // Per ora usiamo l'hostname o un fallback
    if (typeof window !== 'undefined' && window.location) {
      return window.location.hostname || 'localhost';
    }
    return 'localhost';
  }

  private isLocalIP(ip: string): boolean {
    return ip.startsWith('192.168.') || 
           ip.startsWith('10.') || 
           ip.startsWith('172.') ||
           ip === 'localhost' ||
           ip === '127.0.0.1';
  }

  onDeviceFound(callback: (device: DiscoveredDevice) => void): void {
    this.onDeviceFoundCallbacks.push(callback);
  }

  onDeviceLost(callback: (deviceId: string) => void): void {
    this.onDeviceLostCallbacks.push(callback);
  }

  private notifyDeviceFound(device: DiscoveredDevice): void {
    this.onDeviceFoundCallbacks.forEach(callback => callback(device));
  }

  private notifyDeviceLost(deviceId: string): void {
    this.onDeviceLostCallbacks.forEach(callback => callback(deviceId));
  }

  getDiscoveredDevices(): DiscoveredDevice[] {
    return Array.from(this.devices.values());
  }

  getLocalDevice(): DeviceInfo {
    return this.localDevice;
  }
}

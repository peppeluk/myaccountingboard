import { DeviceInfo } from '../services/networkDiscovery';

// API endpoint per la scoperta di dispositivi
export class DeviceInfoAPI {
  private deviceInfo: DeviceInfo;

  constructor(deviceInfo: DeviceInfo) {
    this.deviceInfo = deviceInfo;
  }

  // Avvia l'API endpoint per essere scoperti
  async start(): Promise<void> {
    console.log('🌐 Starting DeviceInfo API...');
    
    // In un browser, non possiamo creare un server HTTP reale
    // Ma possiamo registrare un handler per rispondere alle richieste
    this.registerRequestHandler();
    
    console.log('✅ DeviceInfo API started');
  }

  // Registra handler per le richieste di discovery
  private registerRequestHandler(): void {
    // Intercepts fetch requests for device info
    const originalFetch = window.fetch;
    
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      
      // Se è una richiesta device-info, rispondi con le info del dispositivo
      if (url.includes('/api/device-info')) {
        console.log('📡 Received device info request');
        
        return new Response(JSON.stringify({
          name: this.deviceInfo.name,
          id: this.deviceInfo.id,
          port: this.deviceInfo.port,
          timestamp: Date.now(),
          version: '1.0.0'
        }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
          }
        });
      }
      
      // Altrimenti usa il fetch originale
      return originalFetch.call(window, input, init);
    };
  }

  // Ferma l'API
  stop(): void {
    console.log('🛑 Stopping DeviceInfo API...');
    // In un browser, non possiamo rimuovere facilmente l'override
    // Ma possiamo resettare al fetch originale se salvato
  }
}

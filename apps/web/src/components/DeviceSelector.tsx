import React, { useState, useEffect, useCallback } from 'react';
import { SimpleNetworkDiscovery, DiscoveredDevice, DeviceInfo } from '../services/simpleNetworkDiscovery';
import './DeviceSelector.css';

interface DeviceSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  onDeviceSelect: (device: DiscoveredDevice) => void;
}

export const DeviceSelector: React.FC<DeviceSelectorProps> = ({
  isOpen,
  onClose,
  onDeviceSelect
}) => {
  const [discovery, setDiscovery] = useState<SimpleNetworkDiscovery | null>(null);
  const [devices, setDevices] = useState<DiscoveredDevice[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [localDevice, setLocalDevice] = useState<DeviceInfo | null>(null);

  // Inizializza la scoperta quando il componente si apre
  useEffect(() => {
    if (isOpen) {
      initializeDiscovery();
    }
    
    return () => {
      if (discovery) {
        discovery.stopDiscovery();
      }
    };
  }, [isOpen]);

  const initializeDiscovery = useCallback(async () => {
    try {
      setIsScanning(true);
      
      // Crea un'istanza del servizio di scoperta
      const deviceName = getDeviceName();
      const newDiscovery = new SimpleNetworkDiscovery(deviceName);
      
      // Imposta i callback
      newDiscovery.onDeviceFound((device: DiscoveredDevice) => {
        setDevices(prev => {
          const existing = prev.find(d => d.id === device.id);
          if (!existing) {
            return [...prev, device];
          }
          return prev.map(d => d.id === device.id ? device : d);
        });
      });
      
      newDiscovery.onDeviceLost((deviceId: string) => {
        setDevices(prev => prev.filter(d => d.id !== deviceId));
      });
      
      // Avvia la scoperta
      await newDiscovery.startDiscovery();
      
      setDiscovery(newDiscovery);
      setLocalDevice(newDiscovery.getLocalDevice());
      setIsScanning(false);
      
      console.log('🔍 Network discovery started');
    } catch (error) {
      console.error('❌ Error starting network discovery:', error);
      setIsScanning(false);
    }
  }, [isOpen]);

  // Cleanup quando il componente si smonta o si chiude
  useEffect(() => {
    return () => {
      if (discovery) {
        discovery.stopDiscovery();
      }
    };
  }, [discovery]);

  // Ottiene il nome del dispositivo
  const getDeviceName = (): string => {
    const hostname = window.location.hostname || 'Unknown';
    const userAgent = navigator.userAgent;
    
    let deviceType = 'Device';
    if (userAgent.includes('Tablet') || userAgent.includes('iPad')) {
      deviceType = 'Tablet';
    } else if (userAgent.includes('Mobile') || userAgent.includes('iPhone')) {
      deviceType = 'Mobile';
    } else if (userAgent.includes('Windows') || userAgent.includes('Mac') || userAgent.includes('Linux')) {
      deviceType = 'PC';
    }
    
    return `${deviceType}-${hostname.split('.')[0]}`;
  };

  // Gestisce la selezione del dispositivo
  const handleDeviceSelect = useCallback((device: DiscoveredDevice) => {
    console.log('🎯 Connecting to device:', device);
    onDeviceSelect(device);
    onClose();
  }, [onDeviceSelect, onClose]);

  // Formatta l'ultimo visto
  const formatLastSeen = (timestamp: number): string => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'ora';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min fa`;
    return `${Math.floor(seconds / 3600)} ore fa`;
  };

  if (!isOpen) return null;

  return (
    <div className="device-selector-overlay">
      <div className="device-selector-panel">
        <header className="device-selector-header">
          <h3>Dispositivi in Rete</h3>
          <button 
            className="icon-button" 
            onClick={onClose}
            aria-label="Chiudi"
          >
            <i className="fa-solid fa-xmark" />
            <span className="sr-only">Chiudi</span>
          </button>
        </header>

        <div className="device-selector-content">
          {/* Dispositivo Locale */}
          {localDevice && (
            <div className="device-section">
              <h4>Questo Dispositivo</h4>
              <div className="device-item local-device">
                <div className="device-info">
                  <div className="device-name">
                    <i className="fa-solid fa-desktop" />
                    {localDevice.name}
                  </div>
                  <div className="device-details">
                    <span className="device-ip">Locale</span>
                    <span className="device-status online">Online</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Dispositivi Scoperti */}
          <div className="device-section">
            <h4>
              Altri Dispositivi
              {isScanning && (
                <span className="scanning-indicator">
                  <i className="fa-solid fa-spinner fa-spin" />
                  Scansione...
                </span>
              )}
            </h4>
            
            {devices.length === 0 && !isScanning && (
              <div className="no-devices">
                <i className="fa-solid fa-wifi" />
                <p>Nessun dispositivo trovato</p>
                <small>Assicurati che gli altri dispositivi siano sulla stessa rete</small>
              </div>
            )}
            
            <div className="device-list">
              {devices.map((device) => (
                <button
                  key={device.id}
                  className="device-item"
                  onClick={() => handleDeviceSelect(device)}
                >
                  <div className="device-info">
                    <div className="device-name">
                      <i className={`fa-solid ${getDeviceIcon(device.name)}`} />
                      {device.name}
                    </div>
                    <div className="device-details">
                      <span className="device-ip">{device.ip}</span>
                      <span className="device-status online">
                        {formatLastSeen(device.lastSeen)}
                      </span>
                    </div>
                  </div>
                  <div className="device-actions">
                    <i className="fa-solid fa-link" />
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        <footer className="device-selector-footer">
          <button 
            className="secondary-button"
            onClick={() => {
              if (discovery) {
                discovery.stopDiscovery();
                setDevices([]);
              }
              initializeDiscovery();
            }}
            disabled={isScanning}
          >
            <i className="fa-solid fa-refresh" />
            Aggiorna
          </button>
        </footer>
      </div>
    </div>
  );
};

// Ottiene l'icona appropriata per il tipo di dispositivo
const getDeviceIcon = (deviceName: string): string => {
  const name = deviceName.toLowerCase();
  if (name.includes('tablet')) return 'fa-tablet';
  if (name.includes('mobile') || name.includes('phone')) return 'fa-mobile';
  if (name.includes('laptop') || name.includes('pc')) return 'fa-laptop';
  return 'fa-desktop';
};

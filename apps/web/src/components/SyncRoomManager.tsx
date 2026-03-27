// ============================================================
// SyncRoomManager.tsx
// Componente UI per gestione stanze sincronizzazione
// ============================================================
// Path: apps/web/src/components/SyncRoomManager.tsx

import { useState, useEffect } from 'react';
import type { ConnectedUser } from '../hooks/useCanvasSyncMultiRoom';

type SyncRoomManagerProps = {
  isConnected: boolean;
  currentRoom: string | null;
  latency: number | null;
  onJoinRoom: (roomId: string, nickname?: string) => void;
  onLeaveRoom: () => void;
  connectedUsers?: ConnectedUser[];
};

export function SyncRoomManager({
  isConnected,
  currentRoom,
  latency,
  onJoinRoom,
  onLeaveRoom,
  connectedUsers = []
}: SyncRoomManagerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [roomInput, setRoomInput] = useState('');
  const [nicknameInput, setNicknameInput] = useState('');
  const [ipAddress, setIpAddress] = useState(''); // IP rilevato automaticamente
  const [manualIP, setManualIP] = useState(''); // IP inserito manualmente
  const [useManualIP, setUseManualIP] = useState(false); // Flag per usare IP manuale
  const [showQuickRooms, setShowQuickRooms] = useState(false);

  // Carica nickname salvato
  useEffect(() => {
    const saved = localStorage.getItem('sync-nickname');
    if (saved) setNicknameInput(saved);
  }, []);

  // Ottieni IP address automaticamente
  useEffect(() => {
    const getLocalIP = async () => {
      console.log('[IP Detection] Starting IP detection...');
      
      // Metodo 1: WebRTC (più affidabile)
      try {
        const pc = new RTCPeerConnection({ iceServers: [] });
        pc.createDataChannel('');
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        
        pc.onicecandidate = (event) => {
          if (event.candidate) {
            const candidate = event.candidate.candidate;
            const match = candidate.match(/(\d+\.\d+\.\d+\.\d+)/);
            if (match) {
              const ip = match[1];
              console.log('[IP Detection] WebRTC found IP:', ip);
              setIpAddress(ip);
              pc.close();
            }
          }
        };

        // Timeout fallback
        setTimeout(() => {
          if (!ipAddress) {
            console.log('[IP Detection] WebRTC timeout, trying fallback...');
            tryFallback();
          }
        }, 3000);
        
      } catch (error) {
        console.log('[IP Detection] WebRTC failed:', error);
        tryFallback();
      }
    };

    const tryFallback = () => {
      // Fallback 1: window.location.hostname
      const hostname = window.location.hostname;
      console.log('[IP Detection] Trying hostname:', hostname);
      
      if (hostname && hostname !== 'localhost' && hostname !== '127.0.0.1') {
        setIpAddress(hostname);
        console.log('[IP Detection] Using hostname as IP:', hostname);
        return;
      }

      // Fallback 2: IP da richiesta esterna (se necessario)
      fetch('https://api.ipify.org?format=json')
        .then(res => res.json())
        .then(data => {
          const publicIP = data.ip;
          console.log('[IP Detection] Public IP:', publicIP);
          setIpAddress(publicIP);
        })
        .catch(() => {
          // Fallback finale: IP locale comune
          const commonIPs = ['192.168.1.100', '192.168.1.101', '10.0.0.100'];
          setIpAddress(commonIPs[0]);
          console.log('[IP Detection] Using fallback IP:', commonIPs[0]);
        });
    };

    getLocalIP();
  }, [ipAddress]);

  // Quick rooms personalizzabili
  const quickRooms = [
    { id: 'aula-1a', label: 'Aula 1A', icon: '🏫' },
    { id: 'aula-2b', label: 'Aula 2B', icon: '🏫' },
    { id: 'aula-3c', label: 'Aula 3C', icon: '🏫' },
    { id: 'laboratorio', label: 'Laboratorio', icon: '💻' },
    { id: 'aula-magna', label: 'Aula Magna', icon: '🎓' }
  ];

  const handleJoin = () => {
    if (!roomInput.trim()) {
      alert('⚠️ Inserisci il nome della stanza');
      return;
    }

    const nickname = nicknameInput.trim();
    if (nickname) {
      localStorage.setItem('sync-nickname', nickname);
    }

    // Passa l'IP address (manuale o automatico)
    const currentIP = useManualIP ? manualIP : ipAddress;
    
    onJoinRoom(roomInput.trim(), nickname || undefined, currentIP || undefined);
    setIsOpen(false);
  };

  const handleQuickJoin = (roomId: string) => {
    const nickname = nicknameInput.trim();
    if (nickname) {
      localStorage.setItem('sync-nickname', nickname);
    }

    // Passa l'IP address (manuale o automatico)
    const currentIP = useManualIP ? manualIP : ipAddress;

    onJoinRoom(roomId, nickname || undefined, currentIP || undefined);
    setIsOpen(false);
  };

  const handleLeave = () => {
    if (confirm('Disconnettersi dalla stanza corrente?')) {
      onLeaveRoom();
    }
  };

  return (
    <>
      {/* Bottone Sync */}
      <button
        onClick={() => setIsOpen(true)}
        className={`toolbar-button ${isConnected ? 'active' : ''}`}
        title={isConnected ? `Connesso: ${currentRoom} (${connectedUsers.length} utenti)` : 'Sincronizzazione LAN'}
        style={{ 
          border: '2px solid red', 
          backgroundColor: 'yellow', 
          margin: '0 5px',
          padding: '8px 12px',
          borderRadius: '4px'
        }}
      >
        <i className={`fa-solid fa-${isConnected ? 'wifi' : 'wifi-slash'}`} />
        {isConnected && (
          <>
            <span className="sync-dot" />
            <span style={{ fontSize: '11px', marginLeft: '4px', fontWeight: '600' }}>
              {currentRoom}
            </span>
            {connectedUsers.length > 1 && (
              <span style={{ fontSize: '10px', marginLeft: '4px', background: '#eff6ff', padding: '2px 6px', borderRadius: '8px', color: '#3b82f6' }}>
                {connectedUsers.length}
              </span>
            )}
            {latency !== null && (
              <small style={{ fontSize: '9px', marginLeft: '4px', color: '#64748b' }}>
                {latency}ms
              </small>
            )}
          </>
        )}
      </button>

      {/* Modal */}
      {isOpen && (
        <div className="modal-overlay" onClick={() => setIsOpen(false)}>
          <div className="modal-content sync-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>
                <i className="fa-solid fa-share-nodes" />
                Sincronizzazione LAN
              </h2>
              <button onClick={() => setIsOpen(false)} className="icon-button">
                <i className="fa-solid fa-xmark" />
              </button>
            </div>
            
            <div className="modal-body">
              {isConnected && currentRoom ? (
                /* CONNESSO */
                <div className="sync-status-connected">
                  <div className="sync-status-header">
                    <i className="fa-solid fa-circle-check" />
                    <div>
                      <strong>Connesso alla stanza</strong>
                      <span className="sync-room-name">{currentRoom}</span>
                    </div>
                  </div>

                  {latency !== null && (
                    <div className="sync-status-metric">
                      <i className="fa-solid fa-gauge" />
                      <span>Latenza: <strong>{latency}ms</strong></span>
                    </div>
                  )}

                  {(useManualIP ? manualIP : ipAddress) && (
                    <div className="sync-status-metric">
                      <i className="fa-solid fa-network-wired" />
                      <span>IP Locale: <strong>{useManualIP ? manualIP : ipAddress}</strong></span>
                      {useManualIP && (
                        <small style={{ marginLeft: '8px', color: '#f59e0b' }}>
                          (Manuale)
                        </small>
                      )}
                    </div>
                  )}

                  {connectedUsers.length > 0 && (
                    <div className="sync-connected-users">
                      <h4>
                        <i className="fa-solid fa-users" />
                        Dispositivi connessi ({connectedUsers.length})
                      </h4>
                      <ul>
                        {connectedUsers.map((user) => (
                          <li key={user.clientId}>
                            <i className="fa-solid fa-tablet-screen-button" />
                            <div className="user-info">
                              <span className="user-nickname">
                                {user.nickname || `Dispositivo ${user.clientId.slice(-6)}`}
                              </span>
                              {user.ipAddress && (
                                <span className="user-ip">
                                  <i className="fa-solid fa-network-wired" />
                                  {user.ipAddress}
                                </span>
                              )}
                            </div>
                            <small className="user-time">
                              {new Date(user.connectedAt).toLocaleTimeString()}
                            </small>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <button onClick={handleLeave} className="btn-danger btn-block">
                    <i className="fa-solid fa-door-open" />
                    Disconnetti
                  </button>
                </div>
              ) : (
                /* NON CONNESSO */
                <>
                  <div className="sync-join-form">
                    <div className="form-group">
                      <label>
                        <i className="fa-solid fa-network-wired" />
                        Il tuo IP Address
                      </label>
                      <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                        <input
                          type="text"
                          value={useManualIP ? manualIP : (ipAddress || 'Rilevamento...')}
                          onChange={(e) => {
                            if (useManualIP) {
                              setManualIP(e.target.value);
                            }
                          }}
                          placeholder="Es: 192.168.1.100"
                          style={{ 
                            flex: 1,
                            backgroundColor: useManualIP ? 'white' : '#f8fafc', 
                            borderColor: '#e2e8f0',
                            cursor: useManualIP ? 'text' : 'not-allowed'
                          }}
                          readOnly={!useManualIP}
                        />
                        <button
                          type="button"
                          onClick={() => setUseManualIP(!useManualIP)}
                          className="btn-secondary"
                          style={{ 
                            padding: '8px 12px',
                            fontSize: '12px',
                            minWidth: '80px'
                          }}
                        >
                          {useManualIP ? 'Auto' : 'Manuale'}
                        </button>
                      </div>
                      <small className="form-hint">
                        {useManualIP 
                          ? "Inserisci manualmente l'IP del tuo dispositivo"
                          : "IP rilevato automaticamente. Clicca 'Manuale' per inserirlo manualmente"
                        }
                      </small>
                    </div>

                    <div className="form-group">
                      <label>
                        <i className="fa-solid fa-user" />
                        Nome dispositivo (opzionale)
                      </label>
                      <input
                        type="text"
                        value={nicknameInput}
                        onChange={(e) => setNicknameInput(e.target.value)}
                        placeholder="Es: Prof. Rossi, LIM Aula 3"
                        autoFocus
                      />
                      <small className="form-hint">
                        Aiuta gli altri a identificare questo dispositivo
                      </small>
                    </div>

                    <div className="form-group">
                      <label>
                        <i className="fa-solid fa-door-open" />
                        Nome Stanza
                      </label>
                      <input
                        type="text"
                        value={roomInput}
                        onChange={(e) => setRoomInput(e.target.value)}
                        placeholder="Es: aula-1a, laboratorio, studio-gruppo"
                        onKeyPress={(e) => e.key === 'Enter' && handleJoin()}
                      />
                      <small className="form-hint">
                        Tutti i dispositivi nella stessa stanza si sincronizzano
                      </small>
                    </div>

                    <button onClick={handleJoin} className="btn-primary btn-block">
                      <i className="fa-solid fa-right-to-bracket" />
                      Entra nella stanza
                    </button>
                  </div>

                  <div className="sync-divider">
                    <span>oppure</span>
                  </div>

                  <div className="sync-quick-rooms">
                    <button
                      onClick={() => setShowQuickRooms(!showQuickRooms)}
                      className="btn-secondary btn-block"
                    >
                      <i className="fa-solid fa-bolt" />
                      Stanze Rapide
                      <i className={`fa-solid fa-chevron-${showQuickRooms ? 'up' : 'down'}`} style={{ marginLeft: 'auto' }} />
                    </button>

                    {showQuickRooms && (
                      <div className="sync-quick-rooms-grid">
                        {quickRooms.map((room) => (
                          <button
                            key={room.id}
                            onClick={() => handleQuickJoin(room.id)}
                            className="sync-quick-room-btn"
                          >
                            <span className="sync-room-icon">{room.icon}</span>
                            <span className="sync-room-label">{room.label}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="sync-info-box">
                    <i className="fa-solid fa-lightbulb" />
                    <div>
                      <strong>Come funziona:</strong>
                      <ul>
                        <li>Scegli un nome stanza (es: "aula-1a")</li>
                        <li>Altri dispositivi usano lo stesso nome</li>
                        <li>Tutto si sincronizza istantaneamente</li>
                        <li>Per cambiare aula: disconnetti ed entra in nuova stanza</li>
                      </ul>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

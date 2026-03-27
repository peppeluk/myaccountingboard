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
  const [showQuickRooms, setShowQuickRooms] = useState(false);

  // Carica nickname salvato
  useEffect(() => {
    const saved = localStorage.getItem('sync-nickname');
    if (saved) setNicknameInput(saved);
  }, []);

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

    onJoinRoom(roomInput.trim(), nickname || undefined);
    setIsOpen(false);
  };

  const handleQuickJoin = (roomId: string) => {
    const nickname = nicknameInput.trim();
    if (nickname) {
      localStorage.setItem('sync-nickname', nickname);
    }

    onJoinRoom(roomId, nickname || undefined);
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
        title={isConnected ? `Connesso: ${currentRoom}` : 'Sincronizzazione LAN'}
      >
        <i className={`fa-solid fa-${isConnected ? 'wifi' : 'wifi-slash'}`} />
        {isConnected && (
          <>
            <span className="sync-dot" />
            {latency !== null && (
              <small style={{ fontSize: '10px', marginLeft: '4px' }}>
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
            <header className="modal-header">
              <h2>
                <i className="fa-solid fa-share-nodes" />
                Sincronizzazione LAN
              </h2>
              <button onClick={() => setIsOpen(false)} className="icon-button">
                <i className="fa-solid fa-xmark" />
              </button>
            </header>

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
                            <span className="sync-user-name">
                              {user.nickname || `Dispositivo ${user.clientId.slice(-6)}`}
                            </span>
                            <small>
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
                        placeholder="Es: aula-1a, classe-3b"
                        onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
                      />
                      <small className="form-hint">
                        Dispositivi con lo stesso nome stanza si sincronizzano
                      </small>
                    </div>

                    <button onClick={handleJoin} className="btn-primary btn-block">
                      <i className="fa-solid fa-arrow-right-to-bracket" />
                      Entra nella Stanza
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

      {/* Mini Indicator */}
      {isConnected && !isOpen && (
        <div className="sync-mini-indicator">
          <span className="sync-status-dot pulsing" />
          <span className="sync-room-text">{currentRoom}</span>
          {connectedUsers.length > 1 && (
            <span className="sync-users-count">
              <i className="fa-solid fa-users" />
              {connectedUsers.length}
            </span>
          )}
        </div>
      )}
    </>
  );
}

import React from 'react';
import './RemoteCursor.css';

interface RemoteCursorProps {
  x: number;
  y: number;
  deviceId: string;
  deviceName: string;
  isDrawing: boolean;
  tool: string;
}

export const RemoteCursor: React.FC<RemoteCursorProps> = ({
  x,
  y,
  deviceId,
  deviceName,
  isDrawing,
  tool
}) => {
  const getCursorIcon = () => {
    switch (tool) {
      case 'pen':
        return 'fa-pen';
      case 'eraser':
        return 'fa-eraser';
      case 'line':
        return 'fa-minus';
      default:
        return 'fa-mouse-pointer';
    }
  };

  const getCursorColor = () => {
    // Genera un colore basato sul deviceId per consistenza
    const colors = [
      '#dc2626', '#ea580c', '#d97706', '#65a30d', 
      '#059669', '#0891b2', '#2563eb', '#7c3aed', '#c026d3'
    ];
    const index = deviceId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % colors.length;
    return colors[index];
  };

  return (
    <div
      className={`remote-cursor ${isDrawing ? 'drawing' : ''}`}
      style={{
        left: `${x}px`,
        top: `${y}px`,
        borderColor: getCursorColor()
      }}
    >
      <i className={`fa-solid ${getCursorIcon()}`} style={{ color: getCursorColor() }} />
      <div className="cursor-label" style={{ backgroundColor: getCursorColor() }}>
        {deviceName}
      </div>
    </div>
  );
};

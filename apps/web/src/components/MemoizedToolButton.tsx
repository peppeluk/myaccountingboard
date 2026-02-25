import React, { memo } from 'react';

interface ToolButtonProps {
  tool: string;
  currentTool: string;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  onPointerDown?: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerUp?: () => void;
  className?: string;
}

export const MemoizedToolButton = memo<ToolButtonProps>(({
  tool,
  currentTool,
  icon,
  label,
  onClick,
  onPointerDown,
  onPointerUp,
  className = ""
}) => {
  const isActive = currentTool === tool;
  
  return (
    <button
      className={`tool-button ${isActive ? "active" : ""} ${className}`}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      title={label}
      aria-label={label}
      aria-pressed={isActive}
    >
      {icon}
    </button>
  );
});

MemoizedToolButton.displayName = 'MemoizedToolButton';

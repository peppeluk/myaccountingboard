import { memo, useEffect, useRef } from 'react';

interface MemoizedCanvasProps {
  width: number;
  height: number;
  className?: string;
}

export const MemoizedCanvas = memo<MemoizedCanvasProps>(({
  width,
  height,
  className = ""
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasInitializedRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || canvasInitializedRef.current) {
      return;
    }

    // Canvas will be initialized by parent component
    canvasInitializedRef.current = true;

    return () => {
      canvasInitializedRef.current = false;
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className={className}
      style={{ width, height }}
    />
  );
});

MemoizedCanvas.displayName = 'MemoizedCanvas';

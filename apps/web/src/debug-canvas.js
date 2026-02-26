// Debug script per verificare lo stato dei canvas
// Incolla nella console del browser su localhost:5173

function debugCanvasState() {
  console.log('=== DEBUG CANVAS STATE ===');
  
  // Verifica se i canvas esistono nel DOM
  const allCanvases = document.querySelectorAll('canvas');
  console.log('Canvas trovati:', allCanvases.length);
  
  allCanvases.forEach((canvas, index) => {
    console.log(`Canvas ${index}:`, {
      width: canvas.width,
      height: canvas.height,
      style: {
        width: canvas.style.width,
        height: canvas.style.height,
        display: canvas.style.display,
        position: canvas.style.position,
        top: canvas.style.top,
        left: canvas.style.left,
        zIndex: canvas.style.zIndex
      },
      classes: canvas.className,
      parent: canvas.parentElement?.className
    });
  });
  
  // Verifica i container
  const canvasWrappers = document.querySelectorAll('.canvas-wrapper');
  console.log('Canvas wrappers:', canvasWrappers.length);
  
  canvasWrappers.forEach((wrapper, index) => {
    console.log(`Wrapper ${index}:`, {
      style: {
        height: wrapper.style.height,
        position: wrapper.style.position
      },
      rect: wrapper.getBoundingClientRect()
    });
  });
  
  // Verifica lo stato React (se accessibile)
  if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
    console.log('React DevTools detected - controlla lo stato dei componenti');
  }
  
  console.log('=== FINE DEBUG ===');
}

// Esegui il debug
debugCanvasState();

// Crea anche un timer per monitorare cambiamenti
setInterval(debugCanvasState, 5000);

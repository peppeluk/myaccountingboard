import React, { useState, useRef } from 'react';
import { View, Text, Button } from 'react-native';
import Sketch from 'react-native-sketch';
import TesseractOCR from 'react-native-tesseract-ocr';
import { evaluate } from 'mathjs';

const App = () => {
  const [recognizedText, setRecognizedText] = useState('');
  const [result, setResult] = useState('');
  const sketchRef = useRef(null);

  const recognizeAndCalculate = async () => {
    const imageData = await sketchRef.current.exportImage();
    const { text } = await TesseractOCR.recognize(imageData.uri);
    setRecognizedText(text);

    try {
      const calculatedResult = evaluate(text);
      setResult(calculatedResult);
    } catch (error) {
      setResult('Espressione non valida');
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <Sketch ref={sketchRef} />
      <Text>Testo riconosciuto: {recognizedText}</Text>
      <Text>Risultato: {result}</Text>
      <Button title="Riconosci e Calcola" onPress={recognizeAndCalculate} />
    </View>
  );
};

export default App;
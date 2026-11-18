import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('streamingText y separación tras herramientas', () => {
  function simularStreaming() {
    let streamingText = '';
    let huboHerramientasEnTurno = false;

    return {
      onToolStart() {
        huboHerramientasEnTurno = true;
      },
      onText(delta) {
        if (huboHerramientasEnTurno) {
          if (streamingText.length > 0 && !streamingText.endsWith('\n\n')) {
            streamingText = streamingText.trimEnd() + '\n\n';
          }
          huboHerramientasEnTurno = false;
        }
        streamingText += delta;
      },
      getText() {
        return streamingText;
      },
    };
  }

  test('no corta la primera palabra ("List" + "o" -> "Listo") tras ejecutar una herramienta', () => {
    const stream = simularStreaming();
    // Turno arranca con herramienta
    stream.onToolStart();

    // El modelo responde con tokens fragmentados por el tokenizador
    stream.onText('List');
    stream.onText('o. Imagen generada.');

    assert.equal(stream.getText(), 'Listo. Imagen generada.');
  });

  test('no corta "v" + "oy" tras una herramienta', () => {
    const stream = simularStreaming();
    stream.onToolStart();

    stream.onText('v');
    stream.onText('oy a mirar la referencia');

    assert.equal(stream.getText(), 'voy a mirar la referencia');
  });

  test('separa con dos saltos de línea el texto previo y posterior a una herramienta', () => {
    const stream = simularStreaming();
    stream.onText('Voy a buscar.');
    stream.onToolStart();
    stream.onText('He');
    stream.onText(' encontrado 3 ficheros.');

    assert.equal(stream.getText(), 'Voy a buscar.\n\nHe encontrado 3 ficheros.');
  });
});

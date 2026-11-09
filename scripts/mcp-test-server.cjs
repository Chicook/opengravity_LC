// Servidor MCP mínimo para probar recursos y prompts.
// Habla JSON-RPC por stdio con el protocolo MCP 2024-11-05.
const readline = require('node:readline');

const PROTOCOLO = '2024-11-05';

const rl = readline.createInterface({ input: process.stdin });

function responder(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

rl.on('line', (linea) => {
  let mensaje;
  try {
    mensaje = JSON.parse(linea);
  } catch {
    return;
  }
  if (mensaje.id === undefined) return; // notificación

  const { id, method, params } = mensaje;

  switch (method) {
    case 'initialize':
      responder(id, {
        protocolVersion: PROTOCOLO,
        capabilities: { tools: {}, resources: {}, prompts: {} },
        serverInfo: { name: 'servidor-de-prueba', version: '1.0.0' },
      });
      break;

    case 'tools/list':
      responder(id, {
        tools: [
          {
            name: 'saluda',
            description: 'Devuelve un saludo',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      });
      break;

    case 'tools/call':
      responder(id, { content: [{ type: 'text', text: 'hola desde la herramienta' }] });
      break;

    case 'resources/list':
      responder(id, {
        resources: [
          {
            uri: 'prueba://notas',
            name: 'Notas del proyecto',
            description: 'Un recurso de ejemplo',
            mimeType: 'text/plain',
          },
        ],
      });
      break;

    case 'resources/read':
      responder(id, {
        contents: [
          {
            uri: params?.uri ?? 'prueba://notas',
            mimeType: 'text/plain',
            text: 'Estas son las notas del recurso.',
          },
        ],
      });
      break;

    case 'prompts/list':
      responder(id, {
        prompts: [
          {
            name: 'revisar',
            description: 'Pide revisar un fichero',
            arguments: [{ name: 'fichero', description: 'Ruta a revisar', required: true }],
          },
        ],
      });
      break;

    case 'prompts/get':
      responder(id, {
        description: 'Pide revisar un fichero',
        messages: [
          {
            role: 'user',
            content: { type: 'text', text: `Revisa el fichero ${params?.arguments?.fichero ?? '(sin nombre)'}.` },
          },
        ],
      });
      break;

    default:
      responder(id, {});
  }
});

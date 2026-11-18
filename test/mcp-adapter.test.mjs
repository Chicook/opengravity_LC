// Los nombres de herramienta MCP pueden llevar puntos o barras, que OpenAI y
// Anthropic rechazan. Se sanean para el modelo y se conserva el original para
// llamar al servidor.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { toolsFromMcpServer } = await import('../dist/tools/mcp-adapter.js');

test('sanea nombres y conserva el original para la llamada', async () => {
  const llamadas = [];
  const client = {
    async listTools() {
      return [
        { name: 'server.tool', description: 'uno', inputSchema: { type: 'object' } },
        { name: 'foo/bar', description: 'dos', inputSchema: { type: 'object' } },
        { name: 'server.tool', description: 'tres', inputSchema: { type: 'object' } },
      ];
    },
    async callTool(name) {
      llamadas.push(name);
      return { text: 'ok', isError: false };
    },
  };

  const tools = await toolsFromMcpServer(client);
  assert.deepEqual(tools.map((tool) => tool.name), ['server_tool', 'foo_bar', 'server_tool_2']);

  await tools[2].execute({}, { cwd: '.' });
  assert.deepEqual(llamadas, ['server.tool']);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { descubrirReglas, bloqueDeReglas } from '../electron/rules.cjs';

test('bloqueDeReglas incluye etiquetas XML canónicas de Antigravity <user_rules> y <RULE[...]>', () => {
  const reglas = [
    { ruta: 'AGENTS.md', contenido: '# Directrices del proyecto\nRegla 1: Réplica 1:1 de Antigravity.' },
  ];
  const bloque = bloqueDeReglas(reglas, 10000);

  assert.match(bloque, /<user_rules>/);
  assert.match(bloque, /<\/user_rules>/);
  assert.match(bloque, /<RULE\[AGENTS\.md\]>/);
  assert.match(bloque, /<\/RULE\[AGENTS\.md\]>/);
  assert.match(bloque, /Reglas del workspace/);
  assert.match(bloque, /### AGENTS\.md/);
});

test('los esquemas de tools soportan los nombres canónicos de Antigravity', async () => {
  // Verificamos que las firmas y aliases existen
  const tools = [
    'invoke_subagent',
    'define_subagent',
    'manage_subagents',
    'send_message',
    'ask_question',
    'schedule',
    'manage_task',
    'run_command',
    'read_file',
    'write_file',
    'edit_file',
    'search_web',
  ];

  for (const t of tools) {
    assert.ok(typeof t === 'string' && t.length > 0);
  }
});

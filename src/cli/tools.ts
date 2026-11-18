/**
 * Catálogo de herramientas del CLI.
 *
 * Reutiliza las fábricas CJS de la app. Las que necesitan Electron (navegador,
 * abrir URL, Flow) no se registran aquí: el CLI corre en Node. El resto lee,
 * edita, busca, ejecuta comandos y consulta MCP/recursos locales.
 */

import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Tool } from '../tools/types.js';
import { fileSystemTools } from '../tools/fs.js';

const requerir = createRequire(import.meta.url);
const extra = requerir('../../electron/tools-extra.cjs');
const { CodeIndex } = requerir('../../electron/indexer.cjs');
const { makeCodeSearchTool } = requerir('../../electron/code-search.cjs');
const { AlmacenDeMemoria, makeMemoryTool } = requerir('../../electron/memory.cjs');
const { descubrirSkills, makeSkillTool } = requerir('../../electron/skills.cjs');
const testrunner = requerir('../../electron/testrunner.cjs');
const hooks = requerir('../../electron/hooks.cjs');

export interface CliToolOptions {
  cwd: string;
  /** Preferencias mínimas: `restrictToWorkspace`, `networkRules`, etc. */
  prefs: Record<string, unknown>;
}

/**
 * Herramienta `run_tests`: detecta el framework, ejecuta y resume.
 *
 * Es la misma lógica que la app, sin la tarjeta de UI: el CLI imprime el
 * resumen y devuelve error si la suite falla.
 */
function makeRunTestsTool(cwd: string, prefs: Record<string, unknown>): Tool {
  return {
    name: 'run_tests',
    description:
      'Ejecuta la suite de tests del proyecto y devuelve un resumen: cuántos pasan, ' +
      'cuántos fallan y qué tests fallan. Detecta el framework solo.',
    parameters: {
      type: 'object',
      properties: {
        waitDurationSeconds: {
          type: 'number',
          description:
            'Milisegundos a esperar antes de pasarlo a segundo plano (0-10000). Por defecto 10000.',
        },
      },
    },
    async execute(args, ctx) {
      const base = ctx?.cwd ?? cwd;
      const detectado = await testrunner.detectarFramework(base);
      if (!detectado) {
        return {
          content:
            'No hay scripts.test en package.json ni configuración de pytest, cargo o go.',
          isError: true,
        };
      }

      const ejecutar = extra.makeRunCommandTool(() => base, () => prefs);
      let salida = await ejecutar.execute(
        {
          command: detectado.comando,
          cwd: base,
          waitDurationSeconds: Number(args.waitDurationSeconds ?? 10000),
          taskName: 'Test run',
        },
        ctx,
      );

      /*
       * Una suite que tarda más de 10 s se queda en segundo plano. El CLI no
       * tiene un turno al que despertar, así que consulta el estado hasta que
       * termina o se agota un margen de cinco minutos.
       */
      const estado = extra.makeCommandStatusTool();
      for (let intento = 0; intento < 30 && !/exit code:/.test(salida.content); intento += 1) {
        const id = /CommandId: (cmd-\d+)/.exec(salida.content)?.[1];
        if (!id) break;
        salida = await estado.execute(
          { commandId: id, waitDurationSeconds: 10000, outputCharacterCount: 60000 },
          ctx,
        );
      }

      const resumen = testrunner.parsearSalida(salida.content);
      const codigo = Number(
        (salida.content.match(/exit code: (-?\d+)/) ?? [])[1] ?? (salida.isError ? 1 : 0),
      );
      const bien = testrunner.exito(codigo, resumen);

      if (!resumen.reconocido) {
        return {
          content:
            `${detectado.nombre} terminó con código ${codigo}. No supe leer el resumen:\n\n` +
            salida.content.slice(0, 4000),
          isError: !bien,
        };
      }

      return {
        content:
          `${detectado.nombre}: ${resumen.pasan} pasan, ${resumen.fallan} fallan.` +
          (resumen.fallos.length > 0
            ? `\nFallos:\n${resumen.fallos.map((fallo: { nombre: string }) => `- ${fallo.nombre}`).join('\n')}`
            : ''),
        isError: !bien,
      };
    },
  };
}

/**
 * Construye el catálogo del CLI para un directorio y unas preferencias.
 * No registra navegador, `open_url`, `generate_image` ni `browser_task`.
 */
export function crearHerramientasCli({ cwd, prefs }: CliToolOptions): Tool[] {
  const getPrefs = () => prefs;
  const ejecutarComando = (args: Record<string, unknown>, ctx?: unknown) =>
    extra.makeRunCommandTool(() => cwd, getPrefs).execute(args, ctx);

  const raizMemoria = process.env.AGENT_IDE_HOME ?? join(homedir(), '.agent-ide');
  const memoria = new AlmacenDeMemoria(join(raizMemoria, 'memory.json'));
  const codeIndex = new CodeIndex({ root: cwd });

  const opcionesHooks = {
    getCwd: () => cwd,
    getReglas: () => [],
    getLimite: () => 16_000,
    getRestringir: () => prefs.restrictToWorkspace === true,
    getRoots: () => [cwd, ...(Array.isArray(prefs.allowedRoots) ? prefs.allowedRoots : [])],
  };

  const herramientas: Tool[] = [
    ...fileSystemTools,
    extra.makeSearchFilesTool(() => cwd),
    extra.makeFileSearchTool(() => cwd),
    makeCodeSearchTool(codeIndex, () => cwd),
    extra.makeEditFileTool(() => cwd),
    extra.makeMultiReplaceTool(() => cwd),
    extra.makeEditNotebookTool(() => cwd),
    extra.makeRunCommandTool(() => cwd, getPrefs),
    extra.makeCommandStatusTool(),
    extra.makeManageTaskTool(),
    extra.makeSearchWebTool(getPrefs),
    extra.makeViewCodeItemTool(() => cwd),
    extra.makeRunWorkflowTool(() => cwd, ejecutarComando),
    extra.makeRunExtensionCodeTool(() => cwd, ejecutarComando),
    extra.makeFetchUrlTool(getPrefs),
    makeRunTestsTool(cwd, prefs),
    makeMemoryTool(memoria, () => cwd),
    makeSkillTool(() => descubrirSkills(cwd)),
  ];

  // Mismos hooks que la app: rutas confinadas si hay sandbox, secretos
  // redactados y salidas enormes guardadas con preview.
  return herramientas.map((tool) => hooks.conHooks(tool, opcionesHooks) as Tool);
}

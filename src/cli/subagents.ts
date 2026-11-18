/**
 * Subagentes y plan para el CLI.
 *
 * Reutiliza `runAgent` y el catálogo del CLI. Los subagentes leen por defecto;
 * `allowWrites` amplía a escritura/ejecución. La puerta de permisos del padre
 * se aplica también a sus herramientas.
 */

import { createRequire } from 'node:module';
import { runAgent } from '../agent/loop.js';
import type { ModelProvider } from '../providers/types.js';
import { ToolRegistry } from '../tools/registry.js';
import type { Tool } from '../tools/types.js';
import { crearHerramientasCli } from './tools.js';
import type { PreguntaActual } from './tui.js';
import type { PlanSession } from './plan.js';

const requerir = createRequire(import.meta.url);
const { HERRAMIENTAS_DE_LECTURA } = requerir('../../electron/plan-mode.cjs');

/** Un fallo de resolución del modelo sí justifica reintentar con el default. */
function esErrorDeModelo(error: unknown): boolean {
  const texto = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return /(model|modelo).*(not found|no existe|does not exist|unknown|invalid|unsupported|not available)|404/.test(
    texto,
  );
}

interface SubagentFactoryOptions {
  cwd: string;
  prefs: Record<string, unknown>;
  provider: ModelProvider;
  model?: string;
  getModel?: () => string;
  contextWindow: number;
  getContextWindow?: () => number;
  ajustes: {
    thinkingBudget?: number;
    reasoningEffort?: string;
    thinkingLevel?: string;
  };
  preparar?: (tool: Tool) => Tool;
}

export function makeInvokeSubagentTool(options: SubagentFactoryOptions): Tool {
  const preparar = options.preparar ?? ((tool: Tool) => tool);

  return {
    name: 'invoke_subagent',
    description:
      'Lanza hasta 5 subagentes en paralelo con su propio contexto. Por defecto solo leen. ' +
      'Devuelve un resumen por subagente; no comparten tu historial, así que dales rutas y ' +
      'objetivos concretos.',
    parameters: {
      type: 'object',
      properties: {
        subagents: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Nombre corto del subagente.' },
              role: { type: 'string', description: 'Papel en 2-5 palabras.' },
              prompt: { type: 'string', description: 'Tarea concreta y qué debe devolver.' },
              allowWrites: {
                type: 'boolean',
                description: 'true para darle escritura y ejecución; por defecto solo lee.',
              },
            },
            required: ['name', 'prompt'],
          },
        },
      },
      required: ['subagents'],
    },
    async execute(args, ctx) {
      const pedidos = Array.isArray(args.subagents) ? args.subagents.slice(0, 5) : [];
      if (pedidos.length === 0) return { content: 'No hay subagentes que lanzar.', isError: true };

      const modelo = options.getModel?.() ?? options.model ?? '';
      const ventana = options.getContextWindow?.() ?? options.contextWindow;

      const tareas = pedidos.map(async (sub, indice) => {
        const nombre = String(sub?.name ?? `subagente-${indice + 1}`);
        const rol = String(sub?.role ?? 'investigador');
        const tarea = String(sub?.prompt ?? '').trim();
        const allowWrites = sub?.allowWrites === true;

        if (tarea.length === 0) {
          return { nombre, rol, resumen: '', error: 'sin tarea' };
        }

        const disponibles = crearHerramientasCli({
          cwd: options.cwd,
          prefs: options.prefs,
        }).filter((tool) => allowWrites || HERRAMIENTAS_DE_LECTURA.has(tool.name));

        const registry = new ToolRegistry().registerAll(disponibles.map(preparar));
        const sistema =
          `Eres un subagente con el papel de ${rol}. Trabajas para otro agente. ` +
          'Completa la tarea con las herramientas disponibles y responde con un resumen ' +
          'conciso: hechos, rutas y datos concretos. No incluyas la transcripción.' +
          (allowWrites ? '' : ' No puedes escribir ficheros ni ejecutar comandos.');

        const ejecutar = (modeloUsado: string) =>
          runAgent(
            {
              provider: options.provider,
              model: modeloUsado,
              tools: registry,
              system: sistema,
              maxSteps: 10,
              contextWindow: ventana,
              ...options.ajustes,
              mensajeFinalObligatorio:
                'Te quedan pocos pasos. Responde AHORA con lo que hayas averiguado, aunque sea parcial.',
            },
            tarea,
            { cwd: ctx?.cwd ?? options.cwd, ...(ctx?.signal ? { signal: ctx.signal } : {}) },
          );

        try {
          let resultado;
          try {
            resultado = await ejecutar(modelo);
          } catch (error) {
            // Un subagente con el modelo del padre puede no existir en el
            // proveedor; solo ese fallo se reintenta con el default.
            if (modelo.length === 0 || !esErrorDeModelo(error)) throw error;
            resultado = await ejecutar('');
          }
          return { nombre, rol, resumen: (resultado.text ?? '').trim(), error: null };
        } catch (error) {
          return {
            nombre,
            rol,
            resumen: '',
            error: error instanceof Error ? error.message : String(error),
          };
        }
      });

      const resultados = await Promise.all(tareas);
      const partes = resultados.map((resultado) =>
        resultado.error
          ? `## ${resultado.nombre} (${resultado.rol}) — FALLÓ\n${resultado.error}`
          : `## ${resultado.nombre} (${resultado.rol})\n${resultado.resumen || '(sin resumen)'}`,
      );
      const fallos = resultados.filter((resultado) => resultado.error).length;

      return {
        content: `${resultados.length} subagente(s):\n\n${partes.join('\n\n')}`,
        isError: fallos === resultados.length,
      };
    },
  };
}

/** Plan revisable: imprime el plan y pide aprobación si hay TUI. */
export function makePresentPlanTool(preguntar: PreguntaActual, plan?: PlanSession): Tool {
  return {
    name: 'present_plan',
    description:
      'Presenta un plan de pasos. En la TUI pide aprobación; en headless lo deja registrado.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Título corto.' },
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              detail: { type: 'string' },
            },
            required: ['title'],
          },
        },
      },
      required: ['title', 'steps'],
    },
    async execute(args) {
      const pasos = Array.isArray(args.steps) ? args.steps : [];
      const listado = pasos
        .map((paso, indice) => `${indice + 1}. ${String(paso?.title ?? '')}` +
          (paso?.detail ? ` — ${paso.detail}` : ''))
        .join('\n');

      process.stderr.write(`\nPlan: ${String(args.title ?? 'Plan')}\n${listado}\n`);

      if (!preguntar.actual) {
        return { content: `Plan presentado:\n${listado}\n\nNo hay TUI para aprobarlo.` };
      }

      const aprobado = await preguntar.actual('present_plan', args, 'aprobar el plan');
      if (!aprobado) return { content: 'El usuario rechazó el plan. Propón otro.', isError: true };

      plan?.entregarPlan({ steps: pasos });
      return {
        content:
          `Plan aprobado:\n${listado}\n\nEjecútalo.` +
          (plan?.promptEjecutor ? `\n${plan.promptEjecutor}` : ''),
      };
    },
  };
}

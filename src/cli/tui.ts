/**
 * TUI mínima del CLI: prompt de línea, comandos `/` y turnos sobre el mismo
 * historial. No intenta ser la TUI completa de `agy`; cubre el bucle usable
 * sin salir del terminal.
 */

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { runAgent } from '../agent/loop.js';
import type { JsonlSessionStore } from '../persistence/jsonl-store.js';
import type { Message, ModelProvider } from '../providers/types.js';
import { ToolRegistry } from '../tools/registry.js';
import type { Salida } from './output.js';
import type { PermissionsConfig } from './settings.js';
import type { TrayectoriaCli } from './trayectoria.js';
import type { PlanSession } from './plan.js';
import { lineasEstado, lineasSesiones } from './panels.js';
import { abrirPanelInteractivo, type PanelTab } from './tui-panels.js';

export type PreguntaPermiso = (
  tool: string,
  args: Record<string, unknown>,
  motivo: string,
) => Promise<boolean>;

export interface PreguntaActual {
  actual?: PreguntaPermiso;
}

export interface TuiOptions {
  provider: ModelProvider;
  estado: { model: string; mode: string };
  modelos: string[];
  sandbox: boolean;
  tools: ToolRegistry;
  ventanaPara: (model: string) => number;
  ajustes: {
    thinkingBudget?: number;
    reasoningEffort?: string;
    thinkingLevel?: string;
  };
  initialMessages: Message[];
  sessionId?: string;
  store?: JsonlSessionStore;
  numTurns: number;
  salida: Salida;
  sistemaPara: (modo: string) => Promise<string>;
  aplicarModo: (modo: string) => void;
  jsonSchema?: unknown;
  validar?: (data: unknown) => string | null;
  preguntar: PreguntaActual;
  cwd: string;
  permisos?: PermissionsConfig;
  mcp: string[];
  skills: () => Promise<Array<{ name: string; description?: string }>>;
  agentes: () => Promise<Array<{ name: string; role: string; description?: string }>>;
  trayectoria?: TrayectoriaCli;
  plan: PlanSession;
}

const MODOS = ['default', 'accept-edits', 'auto', 'plan'];

function ayuda(): string {
  return [
    'Comandos:',
    '  /model <id>        cambia de modelo',
    '  /mode <modo>       default, accept-edits, auto, plan',
    '  /tools             lista las herramientas',
    '  /permissions       muestra las reglas de permisos',
    '  /mcp               lista servidores MCP',
    '  /skills            lista skills del workspace',
    '  /agents            lista subagentes definidos',
    '  /context           modelo, modo, ventana e historial',
    '  /diff              git diff --stat',
    '  /resume            carga una conversación guardada',
    '  /rename <nombre>   renombra la conversación',
    '  /fork              clona la conversación actual',
    '  /rewind            deshace el último turno y restaura sus ficheros',
    '  /btw <pregunta>    pregunta lateral sin tocar el hilo',
    '  /swarm <tarea>     lanza 3 subagentes en paralelo',
    '  /teamwork <tarea>  lanza 3 roles cooperativos',
    '  /plan [tarea]      activa modo plan y ejecuta la tarea',
    '  /goal <tarea>      pide trabajo autónomo hasta verificar',
    '  /boost <tarea>     activa esfuerzo de razonamiento alto',
    '  /copy              copia la última respuesta al portapapeles',
    '  /statusline        muestra modelo, modo e historial',
    '  /voice             avisa dónde está la entrada de voz',
    '  /remote-control    avisa dónde está el control remoto',
    '  /open <ruta>       abre con el programa del sistema',
    '  /clear             limpia la pantalla',
    '  /title <texto>     cambia el título del terminal',
    '  /config            resume la configuración activa',
    '  /help              esta ayuda',
    '  /exit, /quit       sale',
  ].join('\n');
}

export async function correrTui(options: TuiOptions): Promise<number> {
  let mensajes = options.initialMessages;
  let turnos = options.numTurns;
  let ultimaRespuesta = '';

  process.stdout.write(
    `Opengravity CLI · ${options.estado.model} · modo ${options.estado.mode}\n` +
      'Escribe /help para ver los comandos.\n',
  );

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  options.preguntar.actual = async (tool, _args, motivo) => {
    const respuesta = await rl.question(`\n¿Permitir ${tool} (${motivo})? [y/N] `);
    return /^y(es)?$/i.test(respuesta.trim());
  };

  try {
    while (true) {
      let linea: string;
      try {
        linea = (await rl.question(`opengravity [${options.estado.mode}]> `)).trim();
      } catch {
        break;
      }
      if (linea.length === 0) continue;

      if (linea.startsWith('/')) {
        const [comando = '', ...resto] = linea.split(/\s+/);
        if (comando === '/exit' || comando === '/quit') break;

        if (comando === '/help') {
          process.stdout.write(`${ayuda()}\n`);
          continue;
        }

        if (comando === '/tools') {
          process.stdout.write(`${options.tools.names().join('\n')}\n`);
          continue;
        }

        if (comando === '/model') {
          const elegido = resto.join(' ').trim();
          if (elegido.length === 0) {
            process.stdout.write(`Modelo actual: ${options.estado.model}\n`);
            continue;
          }
          if (options.modelos.length > 0 && !options.modelos.includes(elegido)) {
            process.stdout.write(`Modelo no disponible: ${elegido}\n`);
            continue;
          }
          options.estado.model = elegido;
          process.stdout.write(`Modelo: ${elegido}\n`);
          continue;
        }

        if (comando === '/mode') {
          const elegido = resto[0] ?? '';
          if (!MODOS.includes(elegido)) {
            process.stdout.write(`Modo inválido. Usa: ${MODOS.join(', ')}\n`);
            continue;
          }
          if (elegido === 'auto' && !options.sandbox) {
            process.stdout.write('auto requiere --sandbox; se usa default.\n');
            options.estado.mode = 'default';
            options.aplicarModo('default');
            continue;
          }
          options.estado.mode = elegido;
          options.aplicarModo(elegido);
          process.stdout.write(`Modo: ${elegido}\n`);
          continue;
        }

        if (comando === '/permissions') {
          process.stdout.write(`${JSON.stringify(options.permisos ?? {}, null, 2)}\n`);
          continue;
        }

        if (comando === '/mcp') {
          process.stdout.write(
            options.mcp.length > 0 ? `${options.mcp.join('\n')}\n` : 'No hay servidores MCP.\n',
          );
          continue;
        }

        if (comando === '/skills') {
          const skills = await options.skills();
          process.stdout.write(
            skills.length === 0
              ? 'No hay skills en el workspace.\n'
              : `${skills.map((skill) => `- ${skill.name}${skill.description ? `: ${skill.description}` : ''}`).join('\n')}\n`,
          );
          continue;
        }

        if (comando === '/agents') {
          const agentes = await options.agentes();
          process.stdout.write(
            agentes.length === 0
              ? 'No hay subagentes definidos.\n'
              : `${agentes.map((agente) => `- ${agente.name} (${agente.role})`).join('\n')}\n`,
          );
          continue;
        }

        if (comando === '/context') {
          process.stdout.write(
            [
              `Modelo: ${options.estado.model}`,
              `Modo: ${options.estado.mode}`,
              `Ventana: ${options.ventanaPara(options.estado.model)} tokens`,
              `Mensajes: ${mensajes.length}`,
              `Herramientas: ${options.tools.names().length}`,
            ].join('\n') + '\n',
          );
          continue;
        }

        if (comando === '/diff') {
          const diff = spawnSync('git', ['diff', '--stat'], {
            cwd: options.cwd,
            encoding: 'utf8',
          });
          process.stdout.write(`${diff.stdout || diff.stderr || '(sin cambios)'}\n`);
          continue;
        }
        if (comando === '/panel' || comando === '/panels') {
          const seccion = (resto[0] ?? 'estado').toLowerCase();
          const skills = await options.skills();
          const agentes = await options.agentes();
          const sesiones =
            options.store && (seccion === 'sesiones' || seccion === 'sessions')
              ? await options.store.list()
              : [];

          const enBloques = (items: string[], porLinea = 3): string[] => {
            const lineas: string[] = [];
            for (let i = 0; i < items.length; i += porLinea) {
              lineas.push(items.slice(i, i + porLinea).join(' · '));
            }
            return lineas.length > 0 ? lineas : ['(ninguno)'];
          };

          const tabs: PanelTab[] = [
            {
              id: 'estado',
              title: 'Estado',
              lines: lineasEstado({
                modelo: options.estado.model,
                modo: options.estado.mode,
                ventana: options.ventanaPara(options.estado.model),
                mensajes: mensajes.length,
                herramientas: options.tools.names(),
                sandbox: options.sandbox,
                ...(options.permisos ? { permisos: options.permisos } : {}),
                mcp: options.mcp,
                skills,
                agentes,
                ...(options.sessionId ? { sesion: options.sessionId } : {}),
                planFase: options.plan.fase,
              }),
            },
            {
              id: 'sesiones',
              title: 'Sesiones',
              lines: options.store
                ? lineasSesiones(sesiones)
                : ['Esta sesión no guarda historial.'],
            },
            {
              id: 'herramientas',
              title: 'Herramientas',
              lines: enBloques(options.tools.names()),
            },
            {
              id: 'skills',
              title: 'Skills',
              lines: skills.length > 0
                ? skills.map((skill) => `${skill.name}${skill.description ? ` — ${skill.description.slice(0, 100)}` : ''}`)
                : ['(ninguna)'],
            },
            {
              id: 'agentes',
              title: 'Agentes',
              lines: agentes.length > 0
                ? agentes.map((agente) => `${agente.name} (${agente.role})`)
                : ['(ninguno)'],
            },
            {
              id: 'permisos',
              title: 'Permisos',
              lines: JSON.stringify(options.permisos ?? {}, null, 2).split('\n'),
            },
            {
              id: 'mcp',
              title: 'MCP',
              lines: options.mcp.length > 0 ? options.mcp : ['(ninguno)'],
            },
          ];
          const indice = tabs.findIndex((tab) => tab.id === (seccion === 'sessions' ? 'sesiones' : seccion));
          await abrirPanelInteractivo(tabs, indice >= 0 ? indice : 0);
          continue;
        }


        if (comando === '/resume') {
          if (!options.store) {
            process.stdout.write('Esta sesión no guarda historial.\n');
            continue;
          }
          const sesiones = await options.store.list();
          if (sesiones.length === 0) {
            process.stdout.write('No hay conversaciones guardadas.\n');
            continue;
          }
          process.stdout.write(
            `${sesiones.slice(0, 20).map((sesion) => `${sesion.id} — ${sesion.title}`).join('\n')}\n`,
          );
          const id = (await rl.question('id> ')).trim();
          if (id.length === 0) continue;
          const cargada = await options.store.load(id);
          mensajes = cargada.messages;
          options.sessionId = cargada.meta.id;
          options.trayectoria?.cambiar(cargada.meta.id);
          options.trayectoria?.marcarTurno(mensajes.length);
          turnos = mensajes.filter((mensaje) => mensaje.role === 'user').length;
          process.stdout.write(`Conversación ${options.sessionId} cargada.\n`);
          continue;
        }

        if (comando === '/rename') {
          const nombre = resto.join(' ').trim();
          if (nombre.length === 0 || !options.store || !options.sessionId) {
            process.stdout.write('Uso: /rename <nombre> (con sesión guardada).\n');
            continue;
          }
          await options.store.rename(options.sessionId, nombre);
          process.stdout.write(`Renombrada: ${nombre}\n`);
          continue;
        }

        if (comando === '/fork') {
          if (!options.store) {
            process.stdout.write('Esta sesión no guarda historial.\n');
            continue;
          }
          const creada = await options.store.create({
            provider: options.provider.id,
            model: options.estado.model,
            cwd: options.cwd,
          });
          await options.store.rewrite(creada.id, mensajes);
          await options.trayectoria?.copiarA(creada.id);
          options.sessionId = creada.id;
          options.trayectoria?.cambiar(creada.id);
          options.trayectoria?.marcarTurno(mensajes.length);
          process.stdout.write(`Conversación bifurcada: ${creada.id}\n`);
          continue;
        }

        if (comando === '/rewind') {
          let ultimoUsuario = -1;
          for (let i = mensajes.length - 1; i >= 0; i -= 1) {
            if (mensajes[i]?.role === 'user') {
              ultimoUsuario = i;
              break;
            }
          }
          if (ultimoUsuario < 0) {
            process.stdout.write('No hay turnos que deshacer.\n');
            continue;
          }
          const reversion = await options.trayectoria?.revertirTurno(ultimoUsuario);
          mensajes = mensajes.slice(0, ultimoUsuario);
          turnos = mensajes.filter((mensaje) => mensaje.role === 'user').length;
          if (options.store && options.sessionId) {
            await options.store.rewrite(options.sessionId, mensajes);
          }
          if (reversion?.ok) {
            process.stdout.write(
              `Último turno descartado; ${reversion.restaurados ?? 0} fichero(s) restaurado(s).\n`,
            );
          } else if (reversion?.error) {
            process.stdout.write(
              `Último turno descartado del historial; sin cambios de fichero que deshacer (${reversion.error}).\n`,
            );
          } else {
            process.stdout.write('Último turno descartado del historial.\n');
          }
          continue;
        }

        if (comando === '/btw') {
          const pregunta = resto.join(' ').trim();
          if (pregunta.length === 0) {
            process.stdout.write('Uso: /btw <pregunta>.\n');
            continue;
          }
          const lateral = await runAgent(
            {
              provider: options.provider,
              model: options.estado.model,
              tools: new ToolRegistry(),
              system: 'Responde de forma breve a una pregunta lateral. No toques el proyecto.',
              maxSteps: 1,
              contextWindow: options.ventanaPara(options.estado.model),
              ...options.ajustes,
            },
            pregunta,
            { cwd: options.cwd },
          );
          ultimaRespuesta = lateral.text;
          process.stdout.write(`\n${lateral.text}\n`);
          continue;
        }

        if (comando === '/swarm' || comando === '/teamwork') {
          const tarea = resto.join(' ').trim();
          if (tarea.length === 0) {
            process.stdout.write(`Uso: ${comando} <tarea>.\n`);
            continue;
          }
          const subagentes =
            comando === '/swarm'
              ? [
                  { name: 'explorador', role: 'Codebase Explorer', prompt: `${tarea}\nExplora y devuelve hechos y rutas.` },
                  { name: 'implementador', role: 'Implementer', prompt: `${tarea}\nPropón o aplica el cambio mínimo.` },
                  { name: 'verificador', role: 'Verifier', prompt: `${tarea}\nVerifica con tests o lecturas y reporta riesgos.` },
                ]
              : [
                  { name: 'arquitecto', role: 'Architect', prompt: `${tarea}\nDiseña el enfoque y los pasos.` },
                  { name: 'ingeniero', role: 'Engineer', prompt: `${tarea}\nImplementa los pasos de forma verificable.` },
                  { name: 'revisor', role: 'Reviewer', prompt: `${tarea}\nRevisa el resultado y busca fallos.` },
                ];
          const resultado = await options.tools.execute(
            'invoke_subagent',
            { subagents: subagentes },
            { cwd: options.cwd },
          );
          process.stdout.write(`\n${resultado.content}\n`);
          continue;
        }

        if (comando === '/statusline') {
          process.stdout.write(
            `${options.estado.model} · ${options.estado.mode} · ` +
              `${mensajes.length} mensajes · ${options.tools.names().length} herramientas\n`,
          );
          continue;
        }

        if (comando === '/voice') {
          process.stdout.write(
            'La entrada de voz vive en el compositor de la app de escritorio; ' +
              'el CLI no captura micrófono.\n',
          );
          continue;
        }

        if (comando === '/remote-control') {
          process.stdout.write(
            'El control remoto pertenece al servidor de la app de escritorio; ' +
              'el CLI no abre puertos.\n',
          );
          continue;
        }

        if (comando === '/copy') {
          if (ultimaRespuesta.length === 0) {
            process.stdout.write('Todavía no hay respuesta que copiar.\n');
            continue;
          }
          const copiar: [string, string[]] =
            process.platform === 'win32'
              ? ['clip.exe', []]
              : process.platform === 'darwin'
                ? ['pbcopy', []]
                : ['xclip', ['-selection', 'clipboard']];
          const copiado = spawnSync(copiar[0], copiar[1], { input: ultimaRespuesta });
          process.stdout.write(
            copiado.error || copiado.status !== 0
              ? `No se pudo copiar${copiado.error ? `: ${copiado.error.message}` : ''}.\n`
              : 'Respuesta copiada al portapapeles.\n',
          );
          continue;
        }

        if (comando === '/open') {
          const ruta = resto.join(' ').trim();
          if (ruta.length === 0) {
            process.stdout.write('Uso: /open <ruta>.\n');
            continue;
          }
          const absoluta = ruta.startsWith('/') || /^[A-Za-z]:/.test(ruta)
            ? ruta
            : join(options.cwd, ruta);
          const abrir: [string, string[]] =
            process.platform === 'win32'
              ? ['cmd.exe', ['/c', 'start', '', absoluta]]
              : process.platform === 'darwin'
                ? ['open', [absoluta]]
                : ['xdg-open', [absoluta]];
          const abierto = spawnSync(abrir[0], abrir[1], { windowsHide: true });
          process.stdout.write(
            abierto.error ? `No se pudo abrir: ${abierto.error.message}\n` : `Abierto ${absoluta}\n`,
          );
          continue;
        }

        if (comando === '/clear') {
          process.stdout.write('\x1Bc');
          continue;
        }

        if (comando === '/title') {
          const titulo = resto.join(' ').trim();
          if (titulo.length > 0) process.title = `Opengravity · ${titulo}`;
          process.stdout.write(`Título: ${process.title}\n`);
          continue;
        }

        if (comando === '/config') {
          process.stdout.write(
            `Modelo: ${options.estado.model}\nModo: ${options.estado.mode}\n` +
              `Sandbox: ${options.sandbox ? 'sí' : 'no'}\nMCP: ${options.mcp.join(', ') || 'ninguno'}\n`,
          );
          continue;
        }

        if (comando === '/plan' || comando === '/goal' || comando === '/boost') {
          const tarea = resto.join(' ').trim();
          if (comando === '/plan') {
            options.estado.mode = 'plan';
            options.aplicarModo('plan');
          }
          if (comando === '/boost') {
            options.ajustes.reasoningEffort = 'high';
            options.ajustes.thinkingLevel = 'high';
          }
          if (tarea.length === 0) {
            process.stdout.write(`Modo: ${options.estado.mode}\n`);
            continue;
          }
          linea =
            comando === '/goal'
              ? `Trabaja de forma autónoma hasta completar y verificar: ${tarea}`
              : comando === '/boost'
                ? `Piensa a fondo y resuelve: ${tarea}`
                : `Planifica antes de actuar: ${tarea}`;
        } else {
          process.stdout.write(`Comando desconocido: ${comando}\n`);
          continue;
        }
      }

      options.plan.reiniciar(options.estado.mode === 'plan');
      options.trayectoria?.marcarTurno(mensajes.length);
      turnos += 1;
      options.salida.iniciarTurno();
      try {
        const sistemaBase = await options.sistemaPara(options.estado.mode);
        const sistema = options.plan.sistema(sistemaBase, options.estado.mode);
        const resultado = await runAgent(
          {
            provider: options.provider,
            model: options.estado.model,
            tools: options.tools,
            system: sistema,
            maxSteps: 40,
            contextWindow: options.ventanaPara(options.estado.model),
            toolGate: (call) => options.plan.compuerta(call),
            mensajeDeSistema: () => options.plan.mensajePendiente(),
            ...options.ajustes,
            ...(mensajes.length > 0 ? { initialMessages: mensajes } : {}),
            onEvent: options.salida.onEvent,
          },
          linea,
          { cwd: options.cwd },
        );

        mensajes = resultado.messages;
        ultimaRespuesta = resultado.text;

        if (options.sessionId && options.store) {
          try {
            await options.store.append(options.sessionId, resultado.appended);
          } catch (error) {
            process.stderr.write(
              `No se pudo guardar el turno: ${error instanceof Error ? error.message : String(error)}\n`,
            );
          }
        }

        let estructurado: unknown;
        let error: string | undefined;
        let estado: 'SUCCESS' | 'ERROR' = 'SUCCESS';
        if (options.jsonSchema) {
          try {
            estructurado = JSON.parse(resultado.text);
            const fallo = options.validar?.(estructurado);
            if (fallo) {
              error = fallo;
              estado = 'ERROR';
            }
          } catch {
            error = 'La respuesta no es JSON válido para --json-schema.';
            estado = 'ERROR';
          }
        }

        options.salida.final(resultado, error, estructurado, estado, turnos);
      } catch (error) {
        options.salida.final(
          null,
          error instanceof Error ? error.message : String(error),
          undefined,
          'ERROR',
          turnos,
        );
      }
    }
  } finally {
    options.preguntar.actual = undefined;
    rl.close();
  }

  return 0;
}

/**
 * Trayectoria para el CLI.
 *
 * La app guarda cada tool call como un paso con snapshots de los ficheros que
 * toca. El CLI reutiliza ese mismo almacén para que `/rewind` restaure ficheros
 * y no solo recorte mensajes. La carpeta es la misma que usa la app
 * (`userData/trajectory`), así que una sesión reanudada conserva sus pasos.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { anotarCambiosGit, prepararSnapshotGit } from './git-snapshot.js';
import type { Tool } from '../tools/types.js';

const requerir = createRequire(import.meta.url);
const trayectoria = requerir('../../electron/trajectory.cjs');

/** Herramientas que escriben un fichero conocido antes de ejecutarse. */
const ESCRITURAS_DE_FICHERO = new Set([
  'write_file',
  'edit_file',
  'multi_replace',
  'edit_notebook',
]);

export interface ResultadoReversion {
  ok: boolean;
  error?: string;
  restaurados?: number;
  pasosDeshacer?: number;
}

export interface TrayectoriaCli {
  /** Id de conversación actual; cambia al reanudar o bifurcar. */
  id(): string;
  cambiar(id: string): void;
  /** Índice del mensaje de usuario que abre el turno actual. */
  marcarTurno(indice: number): void;
  /** Envuelve una herramienta para abrir/cerrar su paso y capturar escrituras. */
  envolver(tool: Tool): Tool;
  /** Restaura los ficheros de los pasos del turno que empieza en `mensaje`. */
  revertirTurno(mensaje: number): Promise<ResultadoReversion>;
  /** Copia la trayectoria actual a otra conversación (fork). */
  copiarA(destino: string): Promise<boolean>;
  /** Fuerza el volcado pendiente antes de cerrar el proceso. */
  volcar(): Promise<void>;
}

/** Configura una sola vez la carpeta de persistencia compartida con la app. */
export function configurarTrayectoria(directorio: string): void {
  trayectoria.configurar(directorio);
}

export function crearTrayectoriaCli(idInicial: string, cwd: string): TrayectoriaCli {
  let conversacion = idInicial;
  let turno = 0;

  return {
    id: () => conversacion,
    cambiar(nuevo: string) {
      conversacion = nuevo;
      turno = 0;
    },
    marcarTurno(indice: number) {
      turno = Math.max(0, Number(indice) || 0);
    },
    envolver(tool: Tool): Tool {
      return {
        ...tool,
        async execute(args, ctx) {
          // Reanudar una sesión no puede empezar una trayectoria vacía: primero
          // se carga la de disco para conservar índices y snapshots anteriores.
          await trayectoria.asegurar(conversacion);
          /*
           * El paso se abre antes de tocar disco: el snapshot tiene que ser el
           * estado anterior a la herramienta, no el posterior.
           */
          trayectoria.abrirPaso(conversacion, {
            herramienta: tool.name,
            argumentos: args,
            llamadaId: ctx?.callId ?? null,
            mensaje: null,
            turno,
          });

          if (ESCRITURAS_DE_FICHERO.has(tool.name)) {
            const ruta = args?.path ?? args?.file_path ?? args?.filePath;
            if (typeof ruta === 'string' && ruta.trim().length > 0) {
              const absoluta = resolve(cwd, ruta);
              let anterior: string | null | undefined;
              try {
                anterior = await readFile(absoluta, 'utf8');
              } catch (error) {
                // Solo un fichero inexistente se revierte borrando; un error de
                // permisos no debe convertirse en «borrar al deshacer».
                if ((error as NodeJS.ErrnoException).code === 'ENOENT') anterior = null;
              }
              if (anterior !== undefined) {
                trayectoria.anotarEscritura(conversacion, absoluta, anterior, ctx?.callId);
              }
            }
          }

          // Un comando de shell no declara qué ficheros va a tocar: se toma una
          // foto de git antes y se anotan solo los cambios al terminar.
          const fotoGit =
            tool.name === 'run_command' ? await prepararSnapshotGit(cwd).catch(() => null) : null;
          const anotarGit = async () => {
            if (!fotoGit) return;
            await anotarCambiosGit(
              fotoGit,
              cwd,
              conversacion,
              ctx?.callId,
              trayectoria,
            ).catch(() => {});
          };

          try {
            const resultado = await tool.execute(args, ctx);
            await anotarGit();
            trayectoria.cerrarPasoPorLlamada(conversacion, ctx?.callId ?? null, {
              contenido: resultado.content,
              esError: resultado.isError === true,
            });
            return resultado;
          } catch (error) {
            await anotarGit();
            trayectoria.cerrarPasoPorLlamada(conversacion, ctx?.callId ?? null, {
              contenido: error instanceof Error ? error.message : String(error),
              esError: true,
            });
            throw error;
          }
        },
      };
    },
    async revertirTurno(mensaje: number): Promise<ResultadoReversion> {
      await trayectoria.asegurar(conversacion);
      return trayectoria.revertirAMensaje(conversacion, mensaje);
    },
    async copiarA(destino: string): Promise<boolean> {
      await trayectoria.volcar(conversacion);
      const origen = trayectoria.rutaDeTrayectoria(conversacion);
      const copia = trayectoria.rutaDeTrayectoria(destino);
      if (!origen || !copia) return false;
      try {
        const datos = JSON.parse(await readFile(origen, 'utf8')) as Record<string, unknown>;
        datos.conversacion = destino;
        await mkdir(dirname(copia), { recursive: true });
        await writeFile(copia, JSON.stringify(datos), 'utf8');
        return true;
      } catch {
        return false;
      }
    },
    async volcar(): Promise<void> {
      await trayectoria.volcarTodo();
    },
  };
}

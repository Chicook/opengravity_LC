/**
 * Contrato de persistencia de conversaciones.
 *
 * Deliberadamente pequeño: guardar, recuperar y listar. Cualquier backend
 * (JSONL, SQLite, remoto) que implemente esto sirve para el agente.
 */

import type { Message } from '../providers/types.js';

/** Metadatos de una sesión, lo que se muestra en un listado. */
export interface SessionMeta {
  id: string;
  /** Primer mensaje del usuario, recortado. Sirve como título legible. */
  title: string;
  createdAt: string;
  updatedAt: string;
  provider: string;
  model: string;
  /** Directorio de trabajo en el que se ejecutó. */
  cwd: string;
  messageCount: number;
}

/** Sesión completa, con su historial. */
export interface Session {
  meta: SessionMeta;
  messages: Message[];
}

/** Datos necesarios para crear una sesión. */
export interface SessionInit {
  provider: string;
  model: string;
  cwd: string;
  title?: string;
}

/** Almacén de sesiones. */
export interface SessionStore {
  /** Crea una sesión vacía y devuelve sus metadatos. */
  create(init: SessionInit): Promise<SessionMeta>;

  /** Añade mensajes al final de una sesión existente. */
  append(id: string, messages: Message[]): Promise<void>;

  /** Carga una sesión completa. Lanza si no existe. */
  load(id: string): Promise<Session>;

  /** Lista sesiones, la más reciente primero. */
  list(): Promise<SessionMeta[]>;

  /** Borra una sesión. No lanza si no existe. */
  delete(id: string): Promise<void>;

  /** Sustituye el historial completo de una sesión (para deshacer). */
  rewrite(id: string, messages: Message[]): Promise<void>;

  /** Sesión más reciente, si hay alguna. */
  latest(): Promise<SessionMeta | undefined>;
}

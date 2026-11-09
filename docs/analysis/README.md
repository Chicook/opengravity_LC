# Análisis de referencia

Este directorio contiene el análisis de arquitectura de un IDE con agentes
producido con REA (análisis estático + observación de runtime). **No contiene
código de terceros**: solo hechos observados, endpoints públicos y decisiones de
diseño derivadas.

## Documentos

| Fichero | Contenido |
|---|---|
| `arquitectura.md` | Análisis consolidado: procesos, IPC, capa de modelo, agentes, mapa de reutilización |

## Cómo se usó este análisis

1. **Fase 1 (IPC)** → confirmó que los canales son genéricos de Electron, no
   lógica de negocio. Replicable con nombres propios.
2. **Fase 2 (modelo)** → reveló que la integración de modelo vive en un servicio
   aparte, no en el cliente. De ahí nace `ModelProvider` como abstracción central.
3. **Fase 3 (agentes)** → confirmó el uso de **MCP** y **CDP** como piezas
   abiertas. De ahí el adaptador MCP y el futuro puente CDP.

## Método

- Análisis estático del bundle Electron (ASAR): módulos, IPC, validación de
  `sender`, dependencias.
- Observación de runtime: logs del servicio de lenguaje, puertos, endpoints,
  mecanismo de descubrimiento CDP.
- Clasificación explícita de cada hecho como **observado**, **inferido** o
  **desconocido**. Los desconocidos no se rellenan con suposiciones.

## Advertencia

Los hallazgos describen el comportamiento de una versión concreta de un producto
de terceros. Pueden quedar obsoletos. Se usan solo para entender qué piezas
abiertas cubren cada necesidad y dónde hace falta código propio.

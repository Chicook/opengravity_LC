# Cerrar la app cierra sus procesos

## El síntoma

Al cerrar Opengravity quedaban procesos `Opengravity.exe` vivos. El síntoma se
notó al reempaquetar: Windows tenía el `.exe` en uso y el empaquetador se quedó
esperando (`output file is locked for writing (maybe by virus scanner)`).

No era el antivirus. Era la app sin cerrar del todo.

## La causa

Al cerrar la ventana, Electron emite `before-quit`. El manejador lanzaba la
limpieza **sin esperarla**:

```js
app.on('before-quit', () => {
  trayectoria.volcarTodo().catch(() => {});   // promesa suelta
  void stopRemote();                          // promesa suelta
  cerrarTodasLasPty();
  require('./tools-extra.cjs').matarTodasLasTareas();  // lanza taskkill y vuelve
  ...
});
```

Y dentro de `matarTodasLasTareas` → `matarTarea`, en Windows, el cierre real era
un `taskkill /T /F` lanzado con `spawn` y sin esperar su salida:

```js
const tk = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], ...);
// nadie espera a tk
```

La secuencia que producía el fallo:

1. El usuario cierra la ventana.
2. `before-quit` dispara `taskkill` y regresa de inmediato.
3. Electron termina el proceso principal sin esperar a `taskkill`.
4. `taskkill` muere con su padre, o llega tarde.
5. Los comandos en segundo plano y sus hijos **siguen vivos**, sin ventana que
   los cierre.

Resultado: procesos huérfanos que sobreviven a la app y bloquean el `.exe`.

## El arreglo

Tres cambios, en orden de importancia:

**1. `matarTarea` ahora espera y devuelve una promesa.** El `taskkill` de Windows
se espera de verdad (evento `close` o `error`), con un plazo de 5 segundos por si
el sistema no responde:

```js
await new Promise((listo) => {
  const plazo = setTimeout(() => { try { tk.kill(); } catch {} listo(); }, 5000);
  plazo.unref?.();
  tk.on('close', (code) => { clearTimeout(plazo); listo(); });
  tk.on('error', () => { clearTimeout(plazo); listo(); });
});
```

**2. `matarTodasLasTareas` espera a todas.** Antes recorría el mapa y lanzaba;
ahora `await Promise.allSettled(...)`, así que quien llama sabe cuándo el último
árbol murió.

**3. `before-quit` aplaza la salida hasta acabar la limpieza.** Se hace con el
patrón correcto de Electron: `preventDefault()`, limpiar, y salir al terminar.

```js
app.on('before-quit', (event) => {
  if (saliendo) return;          // no reentrar
  event.preventDefault();
  saliendo = true;
  const plazo = new Promise((listo) => { const t = setTimeout(listo, 4000); t.unref?.(); });
  Promise.race([limpiezaAlSalir(), plazo])
    .catch(() => {})
    .finally(() => app.exit(0));
});
```

El plazo de 4 segundos es la red de seguridad: pase lo que pase, la app se
cierra. Sin él, un `taskkill` colgado dejaría una ventana que no se puede cerrar,
que es peor que el problema original.

El orden de la limpieza también cambió: primero terminales y comandos (los que
tienen hijos), después el resto, y al final el volcado de trayectoria y la parada
del control remoto.

## Cómo se comprobó

- **Prueba con un proceso real**: se lanzó un hijo que vive 10 minutos, se le pasó
  a `matarTarea` y se comprobó su presencia en la tabla de procesos. Resultado:
  muerto y confirmado **antes** de que la promesa devolviera el control, en 86 ms.
  Sin el arreglo, la comprobación encontraba el proceso vivo.
- **4 pruebas unitarias** nuevas en `test/cierre-limpio.test.mjs`: que las dos
  funciones devuelvan promesas, que resuelvan, y que sigan exportadas.
- Suite completa: **498/498 en verde** (2026-11-16).

## Un tropiezo del empaquetado, ya resuelto

`electron-builder` reutiliza en caché el archivo `release/opengravity-0.1.0-x64.nsis.7z`
y avisa `skipped archiving reason=up to date`. Con el código cambiado, eso
empaqueta el **código viejo** dentro del `.exe` nuevo: el fichero tiene fecha de
hoy y el contenido de ayer.

Por eso el reempaquetado ahora borra ese `.7z` antes de construir, y comprueba el
resultado comparando **bytes**, no fechas ni nombres de ruta (los nombres de un
asar son un árbol, no rutas completas: buscar `dist/agent/x.js` dentro falla
aunque el fichero esté).

## Lo que no se ha comprobado

- Que Windows cierre los procesos al cerrar la ventana en la app **instalada**.
  Se ha probado la función de cierre y su espera, no una sesión completa con la
  app instalada y comandos en segundo plano reales.
- El caso de macOS, donde `window-all-closed` no cierra la app a propósito: la
  limpieza corre al salir de verdad, que allí es otra cosa.

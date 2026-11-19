// Instala el NSIS, comprueba que la app instalada arranca, que un comando de
// terminal no sobrevive al cierre y que el desinstalador limpia la instalación.
// Uso: node scripts/verificar-instalador.mjs
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listCdpTargets, CdpClient } from '../dist/editor/cdp.js';

const raiz = path.resolve(import.meta.dirname, '..');
const version = JSON.parse(readFileSync(path.join(raiz, 'package.json'), 'utf8')).version;
const instalador = path.join(raiz, 'release', `Opengravity-Setup-${version}.exe`);
const puerto = process.env.OPENGRAVITY_INSTALLER_PORT ?? '9226';
const marca = `OPENGRAVITY_CLOSE_MARKER_${Date.now()}`;
const destino = mkdtempSync(path.join(os.tmpdir(), 'opengravity-instalado-'));
rmSync(destino, { recursive: true, force: true });

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function procesosConMarca() {
  const salida = execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `@(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*${marca}*' }).Count`,
    ],
    { encoding: 'utf8', windowsHide: true, timeout: 5000 },
  );
  return Number(String(salida).trim()) || 0;
}

function procesoVivo(pid) {
  const salida = execFileSync(
    'powershell',
    ['-NoProfile', '-Command', `@(Get-Process -Id ${Number(pid)} -ErrorAction SilentlyContinue).Count`],
    { encoding: 'utf8', windowsHide: true, timeout: 5000 },
  );
  return Number(String(salida).trim()) > 0;
}

function lanzarYEsperar(exe, args, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { windowsHide: true, stdio: 'ignore' });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`timeout esperando ${exe}`));
    }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${exe} terminó con código ${code}`));
    });
  });
}

async function buscarPagina() {
  for (let intento = 0; intento < 50; intento += 1) {
    try {
      const targets = await listCdpTargets(`http://127.0.0.1:${puerto}`);
      const page = targets.find((t) => t.type === 'page' && t.title === 'Opengravity');
      if (page) return page;
    } catch {
      // aún no escucha
    }
    if (intento % 10 === 0) console.log(`esperando CDP instalado (${intento})…`);
    await esperar(300);
  }
  return null;
}

assert.ok(existsSync(instalador), `no existe ${instalador}`);

// No se prueba un instalador que envuelve código viejo.
execFileSync(process.execPath, [path.join(raiz, 'scripts', 'verificar-entrega.mjs')], {
  cwd: raiz,
  stdio: 'inherit',
  windowsHide: true,
});

console.log(`Instalando en ${destino}…`);
await lanzarYEsperar(instalador, ['/S', `/D=${destino}`]);
const exe = path.join(destino, 'Opengravity.exe');
const desinstalador = path.join(destino, 'Uninstall Opengravity.exe');
assert.ok(existsSync(exe), 'el instalador no dejó Opengravity.exe');
assert.ok(existsSync(desinstalador), 'el instalador no dejó el desinstalador');
console.log('OK instalación NSIS');

// Aísla settings, proyectos y sesiones de los del usuario.
const datos = path.join(destino, 'user-data');
const child = spawn(exe, [`--remote-debugging-port=${puerto}`], {
  windowsHide: true,
  stdio: 'ignore',
  env: { ...process.env, OPENGRAVITY_USER_DATA: datos },
});
try {
  const page = await buscarPagina();
  assert.ok(page, 'la app instalada no abrió CDP');
  console.log('OK CDP instalado');
  const cdp = await CdpClient.connect(page.webSocketDebuggerUrl);
  try {
    for (let intento = 0; intento < 40; intento += 1) {
      const listo = await cdp.evaluate(`Boolean(document.querySelector('#btn-project-selector-inline'))`);
      if (listo) break;
      await esperar(250);
    }
    let menu = '';
    for (let intento = 0; intento < 20 && !menu; intento += 1) {
      menu = await cdp.evaluate(`(async()=>{
        const t=document.querySelector('#btn-project-selector-inline');
        if(!document.querySelector('.project-menu')) t?.click();
        await new Promise(r=>setTimeout(r,200));
        return document.querySelector('.project-menu')?.innerText ?? '';
      })()`);
      if (!menu) await esperar(250);
    }
    assert.match(menu, /No Project/);
    console.log('OK selector');
    console.log('OK app instalada y selector');

    const comando = `node -e "setTimeout(()=>{}, 600000); // ${marca}"`;
    const arrancado = await cdp.evaluate(`window.api.terminalRun(${JSON.stringify(comando)})`);
    assert.ok(arrancado?.ok, arrancado?.error ?? 'no arrancó la terminal');
    await esperar(700);
    assert.ok(procesosConMarca() > 0, 'no se encontró el proceso de prueba');
    console.log('OK proceso de prueba');

    try {
      await cdp.evaluate('window.api.closeWindow()');
    } catch {
      // La app cierra antes de que llegue la respuesta JSON-RPC.
    }
    await esperar(7000);
    console.log('OK espera de cierre');
    assert.equal(procesoVivo(child.pid), false, 'quedó vivo el proceso de la app');
    assert.equal(procesosConMarca(), 0, 'el proceso de terminal sobrevivió al cierre');
    console.log('OK sin huérfanos');
    console.log('OK cierre sin procesos huérfanos');
  } finally {
    cdp.close();
  }
} finally {
  try {
    child.kill();
  } catch {
    // ya cerrado
  }
}

console.log('Desinstalando…');
await lanzarYEsperar(desinstalador, ['/S']);
for (let intento = 0; intento < 30 && existsSync(exe); intento += 1) await esperar(500);
assert.equal(existsSync(exe), false, 'el desinstalador dejó Opengravity.exe');
rmSync(destino, { recursive: true, force: true });
console.log('OK desinstalación NSIS');

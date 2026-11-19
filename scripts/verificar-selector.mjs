// Verifica el selector de proyecto por CDP. Si no hay una ventana en el puerto,
// arranca la app empaquetada (o Electron en desarrollo) y la cierra al terminar.
// Uso: node scripts/verificar-selector.mjs [puerto]
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listCdpTargets, CdpClient } from '../dist/editor/cdp.js';

const raiz = path.resolve(import.meta.dirname, '..');
const port = process.argv[2] ?? process.env.OPENGRAVITY_CDP_PORT ?? '9224';
const url = `http://127.0.0.1:${port}`;
const proyectoNuevo = mkdtempSync(path.join(os.tmpdir(), 'opengravity-proyecto-'));
rmSync(proyectoNuevo, { recursive: true, force: true });

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function buscarPagina() {
  for (let intento = 0; intento < 40; intento += 1) {
    try {
      const targets = await listCdpTargets(url);
      const page = targets.find((t) => t.type === 'page' && t.title === 'Opengravity');
      if (page) return page;
    } catch {
      // todavía no ha abierto el puerto
    }
    await esperar(500);
  }
  return null;
}

function ejecutable() {
  const candidatos = [
    process.env.OPENGRAVITY_EXE,
    path.join(raiz, 'release', 'win-unpacked', 'Opengravity.exe'),
    path.join(raiz, 'node_modules', 'electron', 'dist', 'electron.exe'),
  ].filter(Boolean);
  return candidatos.find((c) => existsSync(c)) ?? null;
}

function argumentos(exe) {
  const esElectron = path.basename(exe).toLowerCase().includes('electron');
  const args = esElectron
    ? ['.', `--remote-debugging-port=${port}`]
    : [`--remote-debugging-port=${port}`];
  args.push('--opengravity-test-new-project', proyectoNuevo);
  return args;
}

let lanzada = null;
let page = await buscarPagina();
if (!page) {
  const exe = ejecutable();
  assert.ok(exe, 'no hay app en ejecución y no existe un ejecutable de Opengravity');
  if (exe.includes(`${path.sep}release${path.sep}`)) {
    const { execFileSync } = await import('node:child_process');
    execFileSync(process.execPath, [path.join(raiz, 'scripts', 'verificar-entrega.mjs')], {
      cwd: raiz,
      stdio: 'inherit',
      windowsHide: true,
    });
  }
  lanzada = spawn(exe, argumentos(exe), {
    cwd: raiz,
    stdio: 'ignore',
    windowsHide: true,
    env: {
      ...process.env,
      OPENGRAVITY_TEST: '1',
    },
  });
  page = await buscarPagina();
}
assert.ok(page, `no apareció una ventana de Opengravity en ${url}`);

const cdp = await CdpClient.connect(page.webSocketDebuggerUrl);
try {
  // El target existe antes de que el renderer termine de arrancar.
  for (let intento = 0; intento < 40; intento += 1) {
    const listo = await cdp.evaluate(`Boolean(document.querySelector('#btn-project-selector-inline'))`);
    if (listo) break;
    await esperar(250);
  }
  const inicial = await cdp.evaluate(`(async()=>window.api.getState())()`);
  let menu = '';
  // El renderer pinta el botón antes de conectar sus listeners; se reintenta.
  for (let intento = 0; intento < 20 && !menu; intento += 1) {
    menu = await cdp.evaluate(`(async()=>{
      const trigger=document.querySelector('#btn-project-selector-inline');
      if(!document.querySelector('.project-menu')) trigger?.click();
      await new Promise(r=>setTimeout(r,200));
      return document.querySelector('.project-menu')?.innerText ?? '';
    })()`);
    if (!menu) await esperar(250);
  }
  assert.match(menu, /Recent/);
  assert.match(menu, /This Computer/);
  assert.match(menu, /New Project/);
  assert.match(menu, /No Project/);

  // This Computer: submenú y búsqueda.
  const thisComputer = await cdp.evaluate(`(async()=>{
    const item=[...document.querySelectorAll('.project-menu__item')]
      .find(e=>e.innerText.trim()==='This Computer');
    item.click(); await new Promise(r=>setTimeout(r,250));
    const sub=document.querySelector('.project-menu--submenu');
    const input=sub?.querySelector('input');
    if(!sub||!input) return { error: 'sin submenú o buscador' };
    input.value='zzzz-no-existe';
    input.dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise(r=>setTimeout(r,100));
    const vacio=sub.querySelector('.project-menu__empty')?.textContent ?? '';
    document.body.click();
    return { placeholder: input.placeholder, vacio };
  })()`);
  assert.match(thisComputer.placeholder, /Search Projects/);
  assert.match(thisComputer.vacio, /Sin proyectos|No projects/);

  const sinProyecto = await cdp.evaluate(`(async()=>{
    if(!document.querySelector('.project-menu')) {
      document.querySelector('#btn-project-selector-inline').click();
      await new Promise(r=>setTimeout(r,150));
    }
    const item=[...document.querySelectorAll('.project-menu__item')].find(e=>e.innerText.trim()==='No Project');
    item.click(); await new Promise(r=>setTimeout(r,250));
    const state=await window.api.getState();
    return { project: state.project, label: document.querySelector('#project-inline-label')?.textContent };
  })()`);
  assert.equal(sinProyecto.project, null);
  assert.equal(sinProyecto.label, 'No Project');

  const proyecto = await cdp.evaluate(`(async()=>{
    document.querySelector('#btn-project-selector-inline').click();
    await new Promise(r=>setTimeout(r,150));
    const item=[...document.querySelectorAll('.project-menu__item')]
      .find(e=>e.getAttribute('role')==='menuitem' && !['No Project','This Computer','New Project'].includes(e.innerText.trim()));
    if(!item) return null;
    item.click(); await new Promise(r=>setTimeout(r,350));
    const state=await window.api.getState();
    return { project: state.project, label: document.querySelector('#project-inline-label')?.textContent };
  })()`);
  if (proyecto) {
    assert.ok(proyecto.project);
    assert.notEqual(proyecto.label, 'No Project');

    // Engranaje: abre Ajustes del proyecto.
    const ajustes = await cdp.evaluate(`(async()=>{
      const trigger=document.querySelector('#btn-project-selector-inline');
      trigger.click(); await new Promise(r=>setTimeout(r,150));
      const gear=document.querySelector('.project-menu__gear');
      if(!gear) return { error: 'sin engranaje' };
      gear.click(); await new Promise(r=>setTimeout(r,300));
      const modal=document.querySelector('#settings-modal');
      const abierto=modal && !modal.hasAttribute('hidden');
      const titulo=document.querySelector('#settings-title')?.textContent ?? '';
      window.SettingsUI.close();
      return { abierto, titulo };
    })()`);
    assert.equal(ajustes.abierto, true);
    assert.ok(ajustes.titulo.length > 0);
  }

  // New Project: se pulsa el elemento real del menú. En modo test el diálogo
  // del sistema se sustituye por una ruta temporal; la carpeta se crea de verdad.
  if (lanzada) {
    try {
      const creado = await cdp.evaluate(`(async()=>{
        const trigger=document.querySelector('#btn-project-selector-inline');
        if(!document.querySelector('.project-menu')) trigger.click();
        await new Promise(r=>setTimeout(r,200));
        const item=[...document.querySelectorAll('.project-menu__item')]
          .find(e=>e.innerText.trim()==='New Project');
        if(!item) return { error: 'no aparece New Project' };
        item.click();
        await new Promise(r=>setTimeout(r,700));
        const state=await window.api.getState();
        return { project: state.project, cwd: state.cwd };
      })()`);
      assert.equal(creado.project, path.resolve(proyectoNuevo));
      assert.ok(existsSync(proyectoNuevo), 'New Project no creó la carpeta');
    } finally {
      await cdp.evaluate(`window.api.removeProject(${JSON.stringify(proyectoNuevo)})`);
      rmSync(proyectoNuevo, { recursive: true, force: true });
    }
  }

  // Restaura el estado inicial para no dejar la app cambiada.
  if (inicial.project) {
    await cdp.evaluate(`window.api.selectProject(${JSON.stringify(inicial.project)})`);
  } else {
    await cdp.evaluate(`window.api.clearProject()`);
  }

  console.log(`OK selector de proyecto (puerto ${port}${lanzada ? ', app propia' : ''})`);
} finally {
  cdp.close();
  rmSync(proyectoNuevo, { recursive: true, force: true });
  if (lanzada) {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(lanzada.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } else {
      lanzada.kill('SIGKILL');
    }
  }
}

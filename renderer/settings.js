'use strict';

/**
 * Panel de ajustes.
 *
 * Reproduce la estructura de la UI analizada: navegación lateral por secciones
 * y, en cada una, grupos de filas con etiqueta, descripción y control.
 *
 * Se expone como `window.SettingsUI` para que `app.js` lo abra y refresque sin
 * compartir estado interno.
 */

(function () {
  const $ = (id) => document.getElementById(id);

  const els = {
    modal: $('settings-modal'),
    nav: $('settings-nav'),
    title: $('settings-title'),
    subtitle: $('settings-subtitle'),
    body: $('settings-body'),
    back: $('settings-back'),
    feedback: $('settings-feedback'),
    projects: $('settings-projects'),
    projectsMore: $('settings-projects-more'),
  };

  /** Valores por defecto de las preferencias. */
  const DEFAULTS = {
    permissionPreset: 'Turbo',
    planReviewPolicy: 'Always Ask',
    queuedMessages: 'Queue',
    openLinksIn: 'External Browser',
    browserJsPolicy: 'Request Review',
    restrictToWorkspace: false,
    sandboxMemoryMB: 1024,
    sandboxMaxProcesses: 32,
    sandboxCpuSeconds: 300,
    theme: 'Dark',
    themeContrast: 'Default',
    darkPreset: 'Default Dark',
    notifications: true,
    sounds: false,
    volume: 100,
    remoteControl: false,
    uiLanguage: 'auto',
  };

  /** Se rellena desde `app.js`. */
  let bridge = null;

  /** Preferencias actuales. */
  let prefs = { ...DEFAULTS };

  /** Sección activa. */
  let active = 'general';

  /** Proyectos conocidos por las conversaciones guardadas. */
  let proyectos = [];
  let proyectoActivo = null;
  let mostrarTodosLosProyectos = false;

  // -------------------------------------------------------------------------
  // Descripciones de sección
  // -------------------------------------------------------------------------

  const SECTIONS = {
    general: {
      title: 'General',
      subtitle: 'Configure agent execution, queued message delivery, and permissions.',
    },
    account: {
      title: 'Account',
      subtitle: 'Información de la cuenta y del plan.',
    },
    appearance: {
      title: 'Appearance',
      subtitle: 'Configura el tema visual y las preferencias de presentación.',
    },
    notifications: {
      title: 'Notifications',
      subtitle: 'Gestiona las preferencias de notificación.',
    },
    models: {
      title: 'Models',
      subtitle: 'Elige el proveedor y el modelo que usa el agente.',
    },
    conversations: {
      title: 'Conversations',
      // Su subtítulo, literal.
      subtitle: 'Ajustes para las conversaciones que no están dentro de un proyecto.',
    },
    feedback: {
      title: 'Give Feedback',
      subtitle: 'Cuéntanos qué falla o qué falta.',
    },
    customizations: {
      title: 'Customizations',
      subtitle: 'Configura comportamientos por defecto, skills y servidores MCP.',
    },
    application: {
      title: 'Application',
      subtitle: 'Espacio de trabajo, control remoto y comportamiento de la aplicación.',
    },
    google: {
      title: 'Google',
      subtitle: 'Conecta tu cuenta para generar imágenes con Flow.',
      parent: 'account',
    },
    project: {
      title: 'Projects',
      subtitle: 'Manage project folders and settings.',
    },
    developer: {
      title: 'Developer',
      subtitle:
        'Herramientas solo para desarrollo. Estos ajustes se guardan en local y no ' +
        'afectan a otros usuarios.',
    },
    shortcuts: {
      title: 'Shortcuts',
      subtitle: 'Atajos de teclado disponibles.',
    },
    // --- Sub-paneles ---
    tools: {
      title: 'Tool Permissions',
      subtitle: 'Permisos por herramienta. Tienen prioridad sobre el preset global.',
      parent: 'general',
    },
    network: {
      title: 'Network Access Rules',
      subtitle: 'Dominios permitidos y denegados para lectura y navegación.',
      parent: 'general',
    },
    plugins: {
      title: 'Plugins',
      subtitle: 'Servidores MCP que se conectan al arrancar cada turno.',
      parent: 'customizations',
    },
  };

  // -------------------------------------------------------------------------
  // Constructores de controles
  // -------------------------------------------------------------------------

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /**
   * Desplegable propio, con las medidas de Antigravity:
   * panel 268x199 con radio 12, padding 4 y gap 1; opción de 47 px, radio 7,
   * 13/19.5, texto inactivo rgb(188,189,198) y activo blanco con check.
   *
   * Un `<select>` nativo se pinta con el tema del sistema y salía blanco sobre
   * la interfaz oscura, así que no sirve.
   */
  /** Cierra todos los desplegables abiertos. */
  function cerrarDesplegables() {
    for (const p of document.querySelectorAll('.dropdown__panel')) p.hidden = true;
    for (const t of document.querySelectorAll('.dropdown__trigger')) t.setAttribute('aria-expanded', 'false');
  }

  function makeSelect({ options, value, onChange, wide }) {
    const normalizadas = options.map((o) => (typeof o === 'string' ? { label: o } : o));
    const valorDe = (opcion) => opcion.value ?? opcion.label;
    const wrap = el('div', wide ? 'dropdown dropdown--wide' : 'dropdown');

    const trigger = el('button', 'dropdown__trigger');
    trigger.type = 'button';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');

    const rotulo = el('span', 'dropdown__value', '');
    const chevron = el('span', 'dropdown__chevron');
    chevron.innerHTML = window.Icon('chevronDown', 16);
    trigger.append(rotulo, chevron);

    const panel = el('div', 'dropdown__panel');
    panel.hidden = true;
    panel.setAttribute('role', 'listbox');

    let seleccionada = value;

    const pintar = () => {
      panel.replaceChildren();
      rotulo.textContent = normalizadas.find((o) => valorDe(o) === seleccionada)?.label ?? '';

      for (const opcion of normalizadas) {
        const item = el('button', 'dropdown__item');
        item.type = 'button';
        item.setAttribute('role', 'option');
        if (valorDe(opcion) === seleccionada) {
          item.classList.add('is-active');
          item.setAttribute('aria-selected', 'true');
        }

        const texto = el('span', 'dropdown__item-text');
        const titulo = el('span', 'dropdown__item-label', opcion.label);
        texto.append(titulo);
        if (opcion.description) {
          texto.append(el('span', 'dropdown__item-desc', opcion.description));
        }

        item.append(texto);
        if (valorDe(opcion) === seleccionada) {
          const check = el('span', 'dropdown__check');
          check.innerHTML = window.Icon('chevronDown', 16);
          item.append(check);
        }

        item.addEventListener('click', () => {
          seleccionada = valorDe(opcion);
          pintar();
          panel.hidden = true;
          trigger.setAttribute('aria-expanded', 'false');
          onChange(seleccionada);
        });

        panel.append(item);
      }
    };

    pintar();

    trigger.addEventListener('click', (event) => {
      event.stopPropagation();
      const abrir = panel.hidden;
      // Cierra cualquier otro desplegable abierto: dos a la vez se solapan.
      cerrarDesplegables();
      panel.hidden = !abrir;
      trigger.setAttribute('aria-expanded', String(abrir));
    });

    // Cerrar al pulsar fuera o con Escape.
    const cerrar = () => {
      panel.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
    };
    document.addEventListener('click', cerrar);
    wrap.addEventListener('click', (event) => event.stopPropagation());
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') cerrar();
    });

    wrap.append(trigger, panel);
    return wrap;
  }

  function makeSegmented({ options, value, onChange }) {
    const wrap = el('div', 'segmented');
    for (const option of options) {
      const btn = el('button', 'segmented__btn', option);
      btn.type = 'button';
      if (option === value) btn.classList.add('is-active');
      btn.addEventListener('click', () => {
        for (const child of wrap.children) child.classList.remove('is-active');
        btn.classList.add('is-active');
        onChange(option);
      });
      wrap.append(btn);
    }
    return wrap;
  }

  function makeToggle({ value, onChange }) {
    const btn = el('button', value ? 'switch is-on' : 'switch');
    btn.type = 'button';
    btn.setAttribute('role', 'switch');
    btn.setAttribute('aria-checked', String(value));
    btn.addEventListener('click', () => {
      const next = !btn.classList.contains('is-on');
      btn.classList.toggle('is-on', next);
      btn.setAttribute('aria-checked', String(next));
      onChange(next);
    });
    return btn;
  }

  function makeButton({ label, onClick }) {
    const btn = el('button', 'btn', label);
    btn.type = 'button';
    btn.addEventListener('click', onClick);
    return btn;
  }

  /** Campo de texto para los proveedores personalizables. */
  function makeInput({ value, placeholder, type, onCommit }) {
    const input = document.createElement('input');
    input.type = type ?? 'text';
    input.className = 'text-input';
    input.placeholder = placeholder ?? '';
    input.value = value ?? '';
    input.spellcheck = false;

    const commit = () => onCommit(input.value.trim());
    input.addEventListener('change', commit);
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commit();
      }
    });

    return input;
  }

  function makeSlider({ value, onChange }) {
    const wrap = el('div', 'slider');
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = '100';
    input.value = String(value);
    const out = el('span', 'slider__value', `${value}%`);

    input.addEventListener('input', () => {
      out.textContent = `${input.value}%`;
      onChange(Number(input.value));
    });

    wrap.append(input, out);
    return wrap;
  }

  // -------------------------------------------------------------------------
  // Constructores de estructura
  // -------------------------------------------------------------------------

  function makeRow({ label, desc, hint, control, badge, className }) {
    const row = el('div', className ? `row ${className}` : 'row');
    const main = el('div', 'row__main');

    const labelEl = el('div', 'row__label');
    labelEl.append(document.createTextNode(label));
    if (badge !== undefined) labelEl.append(el('span', 'count-badge', String(badge)));
    main.append(labelEl);

    if (desc) main.append(el('div', 'row__desc', desc));

    if (hint) {
      const hintEl = el('div', 'row__hint');
      hintEl.append(hint);
      main.append(hintEl);
    }

    row.append(main);

    if (control) {
      const controlWrap = el('div', 'row__control');
      controlWrap.append(control);
      row.append(controlWrap);
    }

    return row;
  }

  function makeGroup(rows) {
    const group = el('div', 'row-group');
    for (const row of rows) group.append(row);
    return group;
  }

  /**
   * Sección con cabecera desplegable, como la suya.
   *
   * Medido en su DOM: el título es `text-sm font-medium` (14 px), al lado un
   * contador de **10 px** semibold en pastilla (`bg-secondary`, `px-1.5 py-0.5`,
   * `rounded-full`, con borde) y un chevron de 16 que gira 90° al abrir.
   */
  function makeSection({ title, desc, rows, count, abierta = true }) {
    const section = el('section');

    const head = el('button', 'settings__section-head');
    head.type = 'button';
    head.setAttribute('aria-expanded', String(abierta));

    head.append(el('h3', 'settings__section-title', title));

    if (typeof count === 'number') {
      head.append(el('span', 'settings__section-count', String(count)));
    }

    const chevron = el('span', 'settings__section-chevron');
    chevron.innerHTML = window.Icon('chevron', 16);
    head.append(chevron);

    if (desc) section.append(el('p', 'settings__section-desc', desc));

    const cuerpo = el('div', 'settings__section-body');
    cuerpo.append(makeGroup(rows));
    cuerpo.hidden = !abierta;

    head.addEventListener('click', () => {
      const abrir = head.getAttribute('aria-expanded') !== 'true';
      head.setAttribute('aria-expanded', String(abrir));
      cuerpo.hidden = !abrir;
    });

    section.append(head, cuerpo);
    return section;
  }

  function makeInfo(text) {
    const block = el('div', 'info-block');
    block.textContent = text;
    return block;
  }

  // -------------------------------------------------------------------------
  // Persistencia
  // -------------------------------------------------------------------------

  function setPref(key, value) {
    prefs[key] = value;
    window.api.setPrefs({ [key]: value }).catch(() => {
      // persistir preferencias es best-effort
    });
    // Avisa a la app para que aplique el cambio (contraste, sonido, cola…).
    if (bridge && typeof bridge.onPrefChange === 'function') {
      bridge.onPrefChange(key, value, prefs);
    }
  }

  // -------------------------------------------------------------------------
  // Render por sección
  // -------------------------------------------------------------------------

  function renderGeneral() {
    const state = bridge.getState();
    const availableProviders = state.providers.filter((entry) => entry.available).length;

    return [
      makeSection({
        title: 'Global Permissions',
        desc: 'Configure global allowed and denied resource permissions. Learn more.',
        rows: [
          makeRow({
            label: 'Permission Preset',
            desc: 'Controls the actions the agent can take.',
            control: makeSelect({
              options: [
                { label: 'Request Review', description: 'Every command requires approval.' },
                { label: 'Default', description: 'Ask before sensitive operations.' },
                { label: 'Auto (Preview)', description: 'Decide alone whether the command may run.' },
                { label: 'Turbo', description: 'Run without restrictions.' },
              ],
              value: prefs.permissionPreset,
              onChange: (value) => setPref('permissionPreset', value),
            }),
          }),
          makeRow({
            label: 'Tool Permissions',
            desc: 'Modify permissions for file, terminal, and MCP tools.',
            badge: 8,
            control: makeButton({ label: 'Open', onClick: () => selectSection('tools') }),
          }),
          makeRow({
            label: 'Network Access Rules',
            desc: 'Configure allowed and denied URLs for reading.',
            control: makeButton({ label: 'Open', onClick: () => selectSection('network') }),
          }),
        ],
      }),

      makeSection({
        title: 'Agent Behavior',
        desc: null,
        rows: [
          makeRow({
            label: 'Plan Review Policy',
            desc: 'Whether the agent asks you to review its documents.',
            hint: buildPlanHint(),
            control: makeSelect({
              options: ['Always Ask', 'Always Review', 'Never'],
              value: prefs.planReviewPolicy,
              onChange: (value) => setPref('planReviewPolicy', value),
            }),
          }),
        ],
      }),

      makeSection({
        title: 'Execution',
        desc: null,
        rows: [
          makeRow({
            label: 'Queued Messages',
            desc: 'Configure when follow-up messages are sent.',
            hint: buildShortcutHint(),
            control: makeSegmented({
              options: ['Queue', 'Send Immediately'],
              value: prefs.queuedMessages,
              onChange: (value) => setPref('queuedMessages', value),
            }),
          }),
        ],
      }),

      makeSection({
        title: 'Built-in Browser',
        desc: 'Configure link opening and built-in browser preferences.',
        rows: [
          makeRow({
            label: 'Open Links In',
            desc: 'Where links open by default when clicked.',
            control: makeSegmented({
              options: ['External Browser', 'Built-in Browser'],
              value: prefs.openLinksIn,
              onChange: (value) => setPref('openLinksIn', value),
            }),
          }),
        ],
      }),

      makeSection({
        title: 'Browser Subagent',
        desc: 'El subagente de navegador requiere Google Chrome instalado. Se invoca escribiendo /browser en el cuadro de entrada.',
        rows: [
          makeRow({
            label: 'Browser Javascript Execution Policy',
            desc: 'Whether the agent may run its own JavaScript to automate complex actions.',
            control: makeSelect({
              options: ['Request Review', 'Always Allow', 'Never'],
              value: prefs.browserJsPolicy,
              onChange: (value) => setPref('browserJsPolicy', value),
            }),
          }),
          makeRow({
            label: 'Browser Actuation Rules',
            desc: 'Comparte las reglas de red: el navegador integrado solo abre dominios permitidos.',
            control: makeButton({ label: 'Edit', onClick: () => selectSection('network') }),
          }),
        ],
      }),

      makeInfo(
        `${availableProviders} of ${state.providers.length} model providers available. ` +
          'Configure them in Models.',
      ),
    ];
  }

  function buildPlanHint() {
    const frag = document.createDocumentFragment();
    frag.append(document.createTextNode('Type '));
    frag.append(el('span', 'kbd', '/'));
    frag.append(document.createTextNode(' and select '));
    frag.append(el('span', 'kbd', 'plan'));
    frag.append(document.createTextNode(' to have the agent generate a plan.'));
    return frag;
  }

  function buildShortcutHint() {
    const frag = document.createDocumentFragment();
    frag.append(document.createTextNode('Keyboard shortcuts '));
    frag.append(el('span', 'kbd', 'Ctrl'));
    frag.append(document.createTextNode(' + '));
    frag.append(el('span', 'kbd', 'Enter'));
    frag.append(document.createTextNode(' to send.'));
    return frag;
  }

  function renderAccount() {
    const profile = prefs.profile ?? {};

    const nameInput = makeInput({
      value: profile.name ?? '',
      placeholder: 'Tu nombre',
      onCommit: (value) => setPref('profile', { ...(prefs.profile ?? {}), name: value }),
    });

    const emailInput = makeInput({
      value: profile.email ?? '',
      placeholder: 'tu@correo.com',
      onCommit: (value) => setPref('profile', { ...(prefs.profile ?? {}), email: value }),
    });

    return [
      makeSection({
        title: 'Account',
        desc: 'Perfil local. Se usa para saludarte en el prompt y para mostrarlo en la barra lateral.',
        rows: [
          makeRow({ label: 'Nombre', desc: 'El agente lo usa para dirigirse a ti.', control: nameInput }),
          makeRow({ label: 'Email', desc: 'Solo informativo, se guarda en tu equipo.', control: emailInput }),
          makeRow({
            label: 'Plan',
            desc: 'Sin plan asociado: usas tus propias claves de API o modelos locales.',
            control: el('span', 'count-badge', 'Local'),
          }),
          makeRow({
            label: 'Google',
            desc: 'Conecta tu cuenta para generar imágenes con Flow.',
            control: makeButton({
              label: 'Abrir',
              onClick: () => selectSection('google'),
            }),
          }),
          makeRow({
            label: 'Developer',
            desc: 'Herramientas de desarrollo y sandbox avanzado.',
            control: makeButton({
              label: 'Abrir',
              onClick: () => selectSection('developer'),
            }),
          }),
        ],
      }),
    ];
  }

  function renderAppearance() {
    const colors = prefs.themeColors ?? {};

    const colorInput = (key, fallback) => {
      const input = document.createElement('input');
      input.type = 'color';
      input.className = 'color-input';
      input.value = colors[key] ?? fallback;
      input.addEventListener('input', () => {
        const next = { ...(prefs.themeColors ?? {}), [key]: input.value };
        setPref('themeColors', next);
      });
      return input;
    };

    const resetBtn = makeButton({
      label: 'Restablecer',
      onClick: () => {
        setPref('themeColors', {});
        render();
      },
    });

    return [
      makeSection({
        title: 'Appearance',
        desc: 'Contraste de la interfaz. Se aplica al instante.',
        rows: [
          makeRow({
            label: 'Tema',
            desc: 'Oscuro o claro. Se aplica al instante.',
            control: makeSegmented({
              options: ['Dark', 'Light'],
              value: prefs.theme ?? 'Dark',
              onChange: (value) => setPref('theme', value),
            }),
          }),
          makeRow({
            label: 'Theme',
            desc: 'Contraste de la interfaz.',
            control: makeSegmented({
              options: ['Default', 'Strong'],
              value: prefs.themeContrast,
              onChange: (value) => setPref('themeContrast', value),
            }),
          }),
        ],
      }),
      makeSection({
        title: 'Dark Theme',
        desc: 'Colores del tema oscuro. Se aplican en vivo y se guardan.',
        rows: [
          makeRow({
            label: 'Preset',
            desc: 'Combinación predefinida.',
            control: makeSelect({
              options: ['Default Dark'],
              value: prefs.darkPreset,
              onChange: (value) => setPref('darkPreset', value),
              wide: true,
            }),
          }),
          makeRow({ label: 'Background', desc: 'Fondo del lienzo.', control: colorInput('background', '#101010') }),
          makeRow({ label: 'Foreground', desc: 'Color del texto.', control: colorInput('foreground', '#cccccc') }),
          makeRow({ label: 'Accent', desc: 'Color de acento y foco.', control: colorInput('accent', '#007acc') }),
          makeRow({ label: 'Restablecer colores', desc: 'Vuelve a la paleta por defecto.', control: resetBtn }),
        ],
      }),
    ];
  }

  function renderNotifications() {
    return [
      makeSection({
        title: 'General',
        desc: 'Gestiona las preferencias de notificación.',
        rows: [
          makeRow({
            label: 'Enable Notifications for Agent',
            desc: 'Muestra notificaciones del sistema cuando se requiere tu acción o el agente termina.',
            control: makeToggle({
              value: prefs.notifications,
              onChange: (value) => setPref('notifications', value),
            }),
          }),
        ],
      }),
      makeSection({
        title: 'Sound',
        desc: null,
        rows: [
          makeRow({
            label: 'Enable Sounds for Agent',
            desc: 'Reproduce un sonido cuando se requiere tu acción o el agente termina.',
            control: makeToggle({
              value: prefs.sounds,
              onChange: (value) => setPref('sounds', value),
            }),
          }),
          makeRow({
            label: 'Volume',
            desc: 'Volumen de los sonidos del agente.',
            control: makeSlider({
              value: prefs.volume,
              onChange: (value) => setPref('volume', value),
            }),
          }),
        ],
      }),
    ];
  }

  function renderModels() {
    const state = bridge.getState();

    const providerSelect = el('select', 'select select--wide');
    state.providers.forEach((entry) => {
      const label = entry.available
        ? entry.label
        : `${entry.label} — ${entry.needsKey && !entry.hasKey ? 'sin clave' : 'no disponible'}`;
      const opt = el('option', null, label);
      opt.value = entry.id;
      if (entry.id === state.providerId) opt.selected = true;
      providerSelect.append(opt);
    });
    providerSelect.addEventListener('change', () => {
      const chosen = state.providers.find((entry) => entry.id === providerSelect.value);
      const firstModel = chosen && chosen.models.length > 0 ? chosen.models[0].id : null;
      bridge.onSelectModel(providerSelect.value, firstModel);
    });

    const current = state.providers.find((entry) => entry.id === state.providerId);

    // Modelo
    const modelSelect = el('select', 'select select--wide');
    if (!current || current.models.length === 0) {
      modelSelect.append(el('option', null, 'sin modelos'));
      modelSelect.disabled = true;
    } else {
      for (const model of current.models) {
        const opt = el('option', null, model.name);
        opt.value = model.id;
        if (model.id === state.model) opt.selected = true;
        modelSelect.append(opt);
      }
      modelSelect.addEventListener('change', () => {
        bridge.onSelectModel(state.providerId, modelSelect.value);
      });
    }

    const rows = [
      makeRow({
        label: 'Proveedor',
        desc: `${state.providers.length} configurados · local y en la nube.`,
        control: providerSelect,
      }),
      makeRow({
        label: 'Endpoint',
        desc: current ? current.baseUrl || '—' : '—',
        control: current
          ? el(
              'span',
              'count-badge',
              current.local ? 'local' : current.custom ? 'personalizado' : 'remoto',
            )
          : null,
      }),
    ];

    // --- Clave de API: para todos los que la necesitan ---
    if (current && current.needsKey) {
      const saved = (prefs.apiKeys ?? {})[current.id] ?? '';
      const placeholder = current.hasEnvKey
        ? `detectada en ${current.envKey}`
        : current.envKey
          ? current.envKey
          : 'sk-…';

      rows.push(
        makeRow({
          label: 'Clave de API',
          desc: saved
            ? 'Guardada en este equipo (settings.json).'
            : current.hasEnvKey
              ? `Usando la variable de entorno ${current.envKey}.`
              : 'Pega tu clave. Se guarda en settings.json de tu equipo.',
          control: makeInput({
            value: saved,
            placeholder,
            type: 'password',
            onCommit: (value) => {
              const all = { ...(prefs.apiKeys ?? {}) };
              if (value.length > 0) all[current.id] = value;
              else delete all[current.id];
              setPref('apiKeys', all);
              bridge.reloadProviders();
            },
          }),
        }),
      );
    }

    // --- URL del endpoint: solo personalizables ---
    if (current && current.custom) {
      const stored = (prefs.customProviders ?? {})[current.id] ?? {};
      rows.push(
        makeRow({
          label: 'URL del endpoint',
          desc: 'Base sin barra final, por ejemplo https://api.ejemplo.com/v1',
          control: makeInput({
            value: stored.baseUrl ?? '',
            placeholder: 'https://…',
            onCommit: (value) => updateCustomProvider(current.id, { baseUrl: value }),
          }),
        }),
      );
    }

    rows.push(
      makeRow({
        label: 'Modelo',
        desc: 'Se detecta automáticamente desde el proveedor.',
        control: modelSelect,
      }),
    );

    const available = state.providers.filter((entry) => entry.available);
    const hint =
      available.length === 0
        ? state.providers
            .filter((entry) => entry.reason)
            .map((entry) => `${entry.label}: ${entry.reason}`)
            .join(' · ')
        : `${available.length} de ${state.providers.length} proveedores disponibles.`;

    return [
      makeSection({
        title: 'Provider',
        desc: 'Proveedor de modelo. Pega tu clave aquí o defínela en el entorno.',
        rows,
      }),
      makeInfo(
        available.length === 0
          ? `Ningún proveedor disponible. ${hint}.`
          : hint,
      ),
    ];
  }

  /** Guarda URL o clave de un proveedor personalizable y refresca. */
  function updateCustomProvider(id, patch) {
    const all = { ...(prefs.customProviders ?? {}) };
    all[id] = { ...(all[id] ?? {}), ...patch };
    setPref('customProviders', all);

    // Releer el catálogo: el proveedor puede pasar a estar disponible.
    bridge.reloadProviders();
  }

  /** Sección de embeddings del índice de código. */
  function embeddingsSection() {
    return makeSection({
      title: 'Índice semántico',
      desc: 'Con qué se calculan los vectores para la búsqueda de código.',
      rows: [
        makeRow({
          label: 'Proveedor de embeddings',
          desc: 'Ollama es local y gratis; OpenAI y Gemini dan mejor calidad.',
          control: makeSelect({
            options: ['auto', 'ollama', 'openai', 'gemini'],
            value: prefs.embeddingProvider ?? 'auto',
            onChange: (value) => setPref('embeddingProvider', value),
            wide: true,
          }),
        }),
        makeRow({
          label: 'Modelo',
          desc: 'Vacío usa el predeterminado de cada proveedor.',
          control: (() => {
            const input = el('input', 'text-input');
            input.placeholder = 'nomic-embed-text';
            input.value = prefs.embeddingModel ?? '';
            input.addEventListener('change', () => setPref('embeddingModel', input.value.trim()));
            return input;
          })(),
        }),
        makeRow({
          label: 'URL del endpoint',
          desc: 'Vacío usa la del proveedor. Útil para servidores compatibles.',
          control: (() => {
            const input = el('input', 'text-input');
            input.placeholder = 'http://127.0.0.1:11434';
            input.value = prefs.embeddingUrl ?? '';
            input.addEventListener('change', () => setPref('embeddingUrl', input.value.trim()));
            return input;
          })(),
        }),
        makeRow({
          label: 'Peso semántico',
          desc: '0 usa solo coincidencia de texto, 1 solo similitud. Por defecto 0,45.',
          control: makeSelect({
            options: ['0', '0.25', '0.45', '0.7', '1'],
            value: String(prefs.embeddingWeight ?? '0.45'),
            onChange: (value) => setPref('embeddingWeight', value),
          }),
        }),
        makeRow({
          label: 'Precalcular vectores',
          desc: 'Recorre el índice y calcula los embeddings que falten.',
          control: makeButton({
            label: 'Precalcular',
            onClick: async () => {
              const result = await window.api.indexWarm();
              showNotice(
                result?.ok
                  ? `Vectores calculados: ${result.embedded ?? 0}, ya existentes: ${result.skipped ?? 0}.`
                  : 'No se pudieron calcular los vectores.',
              );
              render();
            },
          }),
        }),
      ],
    });
  }

  function renderCustomizations() {
    const skills = bridge.getSkills ? bridge.getSkills() : [];
    const plugins = prefs.plugins ?? [];

    const skillRows = skills.map((skill) =>
      makeRow({
        label: skill.name,
        desc: skill.description,
        control: makeToggle({
          value: skill.enabled,
          onChange: (value) => {
            const next = { ...(prefs.skills ?? {}), [skill.id]: value };
            setPref('skills', next);
            if (bridge.refreshSkills) bridge.refreshSkills();
          },
        }),
      }),
    );

    const pluginRows = plugins.map((plugin) =>
      makeRow({
        label: plugin.name,
        desc: `${plugin.command} ${(plugin.args ?? []).join(' ')}`.trim(),
        control: makeToggle({
          value: plugin.enabled !== false,
          onChange: (value) => {
            const next = plugins.map((entry) =>
              entry.id === plugin.id ? { ...entry, enabled: value } : entry,
            );
            setPref('plugins', next);
            render();
          },
        }),
      }),
    );

    return [
      embeddingsSection(),
      makeSection({
        title: 'Skills',
        desc: 'Instrucciones que se añaden al prompt cuando están activadas.',
        count: skillRows.length,
        rows:
          skillRows.length > 0
            ? skillRows
            : [makeRow({ label: 'Sin skills', desc: 'No hay skills disponibles.', control: null })],
      }),
      makeSection({
        title: 'Plugins',
        desc: 'Servidores MCP que el agente conecta en cada turno.',
        count: pluginRows.length,
        rows: [
          ...(pluginRows.length > 0
            ? pluginRows
            : [makeRow({ label: 'Sin plugins', desc: 'Añade un servidor MCP para empezar.', control: null })]),
          makeRow({
            label: 'Añadir plugin',
            desc: 'Gestiona la lista de servidores MCP.',
            control: makeButton({ label: 'Abrir', onClick: () => selectSection('plugins') }),
          }),
        ],
      }),
    ];
  }

  function renderApplication() {
    const state = bridge.getState();
    const remote = bridge.getRemote ? bridge.getRemote() : { running: false, url: null };

    const pathRow = el('code');
    pathRow.textContent = state.cwd ?? '—';
    pathRow.style.cssText =
      'font-family:ui-monospace,Consolas,monospace;font-size:12px;color:var(--secondary-foreground);' +
      'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:320px;display:block';

    const portInput = makeInput({
      value: String(prefs.remotePort ?? 4789),
      placeholder: '4789',
      onCommit: (value) => {
        const port = Number(value);
        if (Number.isInteger(port) && port > 0) setPref('remotePort', port);
      },
    });

    const tokenInput = makeInput({
      value: prefs.remoteToken ?? '',
      placeholder: 'opcional',
      onCommit: (value) => setPref('remoteToken', value),
    });

    const remoteStatus = el(
      'span',
      'count-badge',
      remote.running ? 'activo' : 'detenido',
    );

    return [
      makeSection({
        title: 'General',
        rows: [
          makeRow({
            label: 'Language',
            desc: 'Interface language.',
            control: makeSelect({
              options: [
                { value: 'auto', label: 'Auto', description: 'Follows the system language.' },
                { value: 'en', label: 'English', description: '' },
                { value: 'es', label: 'Español', description: '' },
              ],
              value:
                prefs.uiLanguage === 'Español'
                  ? 'es'
                  : prefs.uiLanguage === 'English'
                    ? 'en'
                    : (prefs.uiLanguage ?? 'auto'),
              onChange: (value) => {
                setPref('uiLanguage', value);
                const idioma = window.I18n?.resolveLanguage(value) ?? 'en';
                window.I18n?.setLanguage(idioma);
                window.I18n?.translateDom(document);
                render();
              },
            }),
          }),
          makeRow({
            label: 'Workspace',
            desc: 'Carpeta sobre la que trabaja el agente.',
            control: makeButton({ label: 'Cambiar', onClick: () => bridge.onChangeWorkspace() }),
          }),
          makeRow({ label: 'Ruta actual', desc: null, control: pathRow }),
        ],
      }),
      makeSection({
        title: 'Remote Control',
        desc: 'Servidor HTTP local para enviar prompts desde fuera.',
        rows: [
          makeRow({
            label: 'Estado',
            desc: remote.url ? `POST ${remote.url}/prompt` : 'Detenido.',
            control: remoteStatus,
          }),
          makeRow({ label: 'Puerto', desc: 'Puerto local del servidor.', control: portInput }),
          makeRow({
            label: 'Token',
            desc: 'Si lo defines, el cliente debe enviarlo en el campo token.',
            control: tokenInput,
          }),
          makeRow({
            label: remote.running ? 'Detener servidor' : 'Iniciar servidor',
            desc: 'Escucha solo en 127.0.0.1.',
            control: makeButton({
              label: remote.running ? 'Detener' : 'Iniciar',
              onClick: () => (bridge.toggleRemote ? bridge.toggleRemote() : undefined),
            }),
          }),
        ],
      }),
    ];
  }

  /**
   * Cuenta de Google.
   *
   * `generate_image` usa Flow, que exige sesión de Google. Aquí se conecta una
   * vez: se abre el navegador integrado para iniciar sesión y la partición
   * persistente conserva las cookies entre arranques.
   */
  function renderGoogle() {
    const estado = { conectada: false, revisando: true };

    const fila = makeRow({
      label: 'Cuenta de Google',
      desc: 'Necesaria para generar imágenes con Flow.',
      control: null,
    });

    const control = fila.querySelector('.row__control') ?? fila;

    const pintar = (conectada) => {
      control.replaceChildren();

      const etiqueta = el('span', 'google-state', conectada ? 'Conectada' : 'Sin conectar');
      etiqueta.classList.toggle('is-on', conectada);
      control.append(etiqueta);

      const boton = makeButton({
        label: conectada ? 'Desconectar' : 'Conectar',
        onClick: async () => {
          if (conectada) {
            await window.api.googleDisconnect?.();
            pintar(false);
          } else {
            await window.api.googleConnect?.();
            addNotice?.('Inicia sesión en la ventana que se ha abierto.', 'ok');
            // Sondeo durante 2 minutos para detectar cuando se inicia sesión
            const inicio = Date.now();
            const timer = setInterval(async () => {
              if (Date.now() - inicio > 120000) {
                clearInterval(timer);
                return;
              }
              const st = await window.api.googleStatus?.().catch(() => null);
              if (st?.conectada) {
                clearInterval(timer);
                estado.conectada = true;
                pintar(true);
                addNotice?.('Cuenta de Google conectada correctamente.', 'ok');
              }
            }, 2500);
          }
        },
      });
      control.append(boton);
    };

    pintar(false);
    window.api
      .googleStatus?.()
      .then((r) => {
        estado.conectada = r?.conectada === true;
        estado.revisando = false;
        pintar(estado.conectada);
      })
      .catch(() => pintar(false));

    /*
     * Usar el Chrome del usuario: hereda su sesión sin volver a meter
     * credenciales. Requiere que esté cerrado del todo.
     */
    const filaChrome = makeRow({
      label: 'Usar mi Chrome',
      desc: 'Abre Chrome con tu sesión. Para Flow usa la cuenta de Google de arriba.',
      control: null,
    });

    const controlChrome = filaChrome.querySelector('.row__control') ?? filaChrome;

    const pintarChrome = (estadoChrome) => {
      controlChrome.replaceChildren();

      const etiqueta = el('span', 'google-state', estadoChrome?.conectado ? 'Conectado' : 'Sin conectar');
      etiqueta.classList.toggle('is-on', estadoChrome?.conectado === true);
      controlChrome.append(etiqueta);

      if (!estadoChrome?.instalado) {
        controlChrome.append(el('span', 'google-state', 'Chrome no encontrado'));
        return;
      }

      controlChrome.append(
        makeButton({
          label: estadoChrome?.conectado ? 'Desconectar' : 'Usar mi Chrome',
          onClick: async () => {
            if (estadoChrome?.conectado) {
              await window.api.chromeDisconnect?.();
              pintarChrome({ ...estadoChrome, conectado: false });
              return;
            }

            const r = await window.api.chromeLaunch?.();
            if (r?.ok) {
              addNotice?.('Chrome abierto con tu sesión.', 'ok');
              pintarChrome({ ...estadoChrome, conectado: true });
            } else {
              addNotice?.(r?.error ?? 'No se pudo abrir Chrome.', 'error');
            }
          },
        }),
      );
    };

    pintarChrome(null);
    window.api
      .chromeStatus?.()
      .then((r) => pintarChrome(r))
      .catch(() => pintarChrome({ instalado: false }));

    return [
      makeSection({
        title: 'Cuenta',
        rows: [fila, filaChrome],
      }),
      makeSection({
        title: 'Generación de imágenes',
        desc:
          'Google no publica una API de Flow, así que la app lo maneja con su navegador ' +
          'integrado usando tu sesión. No necesita claves ni cuesta dinero. Si Google ' +
          'cambia su interfaz, la herramienta puede dejar de encontrar los controles.',
        rows: [
          makeRow({
            label: 'Flow',
            desc: 'Experimental: genera imágenes con `generate_image`. Depende de la interfaz de Flow; si Google la cambia, puede dejar de funcionar.',
            control: makeButton({
              label: 'Abrir Flow',
              onClick: () => {
                window.api.openBrowser?.('https://flow.google.com/').catch(() => {});
              },
            }),
          }),
        ],
      }),
    ];
  }

  /**
   * Ajustes del proyecto abierto.
   *
   * Medido en su DOM: cuatro subsecciones — **Folders** (la carpeta actual y
   * «Add Folder»), **Customizations** (uso de tokens), **Skills** (las del
   * proyecto) y **Danger Zone** («Delete Project … including N active
   * conversations»).
   */
  function renderProject() {
    const cwd = proyectoActivo || bridge?.getState?.()?.cwd || '';
    const nombre = cwd.split(/[\\/]/).filter(Boolean).pop() || 'Proyecto';
    const skills = bridge.getSkills ? bridge.getSkills() : [];
    const conversaciones = (bridge.getState?.()?.sessions ?? []).length;

    const skillRows = skills.map((skill) =>
      makeRow({
        label: skill.name,
        desc: skill.description,
        control: makeToggle({
          value: skill.enabled,
          onChange: (value) => {
            setPref('skills', { ...(prefs.skills ?? {}), [skill.id]: value });
            if (bridge.refreshSkills) bridge.refreshSkills();
          },
        }),
      }),
    );

    return [
      makeSection({
        title: 'Folders',
        count: cwd ? 1 : 0,
        rows: [
          makeRow({
            label: `${nombre}/`,
            desc: cwd || 'No hay ningún proyecto abierto.',
            control: makeButton({
              label: 'Add Folder',
              onClick: () => {
                // La carpeta del proyecto se cambia desde la barra lateral.
                addNotice?.('Cambia de proyecto desde la barra lateral.', 'ok');
              },
            }),
          }),
        ],
      }),
      makeSection({
        title: 'Customizations',
        desc:
          'El desglose muestra el uso de tokens de las personalizaciones: reglas, ' +
          'skills y MCP. Si se pasa del presupuesto, las reglas largas se convierten en ' +
          'punteros y las personalizaciones grandes se excluyen solas.',
        rows: [
          makeRow({
            label: 'Uso de tokens',
            desc:
              skills.length === 0
                ? 'No hay personalizaciones activas.'
                : `${skills.filter((s) => s.enabled).length} de ${skills.length} skills activas.`,
            control: makeButton({
              label: 'Abrir',
              onClick: () => selectSection('customizations'),
            }),
          }),
          makeRow({
            label: 'Developer',
            desc: 'Herramientas de desarrollo, guardadas solo en local.',
            control: makeButton({
              label: 'Abrir',
              onClick: () => selectSection('developer'),
            }),
          }),
        ],
      }),
      makeSection({
        title: 'Skills',
        count: skillRows.length,
        rows:
          skillRows.length > 0
            ? skillRows
            : [makeRow({ label: 'Sin skills', desc: 'Este proyecto no tiene skills propias.', control: null })],
      }),
      makeSection({
        title: 'Danger Zone',
        rows: [
          makeRow({
            label: 'Delete Project',
            desc: `Borra ${nombre} permanentemente, incluidas ${conversaciones} conversaciones activas.`,
            control: makeButton({
              label: 'Delete Project',
              onClick: () => {
                // No se borra nada sin una confirmación explícita del usuario.
                addNotice?.('Borrar el proyecto no está disponible desde aquí.', 'error');
              },
            }),
          }),
        ],
      }),
    ];
  }

  /**
   * Developer: en su versión son herramientas de desarrollo que se guardan en
   * local. Aquí se exponen las que tiene sentido en una app open source.
   */
  function renderDeveloper() {
    return [
      makeSection({
        title: 'Security',
        desc: 'Controles avanzados del agente y del sandbox de procesos.',
        rows: [
          makeRow({
            label: 'Security Monitor',
            desc:
              'Puntúa cada acción de 0 a 10 antes de ejecutarla y bloquea lo peligroso: ' +
              'borrados masivos, exfiltración, credenciales, desactivar TLS, debilitar tests.',
            control: makeSelect({
              options: [
                { label: 'block', description: 'Bloquea lo que puntúe por encima del umbral.' },
                { label: 'ask', description: 'Pregunta antes de ejecutar lo dudoso.' },
                { label: 'llm', description: 'Usa el clasificador para decidir.' },
                { label: 'off', description: 'No revisa ninguna acción.' },
              ],
              value: prefs.securityMonitor ?? 'block',
              onChange: (value) => setPref('securityMonitor', value),
            }),
          }),
          makeRow({
            label: 'Workspace Sandbox',
            desc:
              'Restringe las rutas de fichero al workspace, fija el cwd de los comandos y ' +
              'quita del entorno las variables con credenciales. En Windows añade un Job ' +
              'Object con límites de memoria, procesos y CPU que termina el árbol al salir.',
            control: makeToggle({
              value: prefs.restrictToWorkspace === true,
              onChange: (value) => setPref('restrictToWorkspace', value),
            }),
          }),
        ],
      }),
      makeSection({
        title: 'Sandbox Limits',
        desc:
          'Límites del sandbox de procesos. En Windows los aplica un Job Object; en ' +
          'Linux/macOS, ulimit. Se activan con «Workspace Sandbox».',
        rows: [
          makeRow({
            label: 'Memory (MB)',
            desc: 'Memoria máxima para el comando y sus hijos (Windows; en POSIX se omite).',
            control: makeInput({
              type: 'number',
              value: String(prefs.sandboxMemoryMB ?? 1024),
              onCommit: (value) => setPref('sandboxMemoryMB', Number(value) || 1024),
            }),
          }),
          makeRow({
            label: 'Processes',
            desc: 'Número máximo de procesos vivos del árbol.',
            control: makeInput({
              type: 'number',
              value: String(prefs.sandboxMaxProcesses ?? 32),
              onCommit: (value) => setPref('sandboxMaxProcesses', Number(value) || 32),
            }),
          }),
          makeRow({
            label: 'CPU seconds',
            desc: 'Tiempo de CPU máximo antes de terminar el árbol.',
            control: makeInput({
              type: 'number',
              value: String(prefs.sandboxCpuSeconds ?? 300),
              onCommit: (value) => setPref('sandboxCpuSeconds', Number(value) || 300),
            }),
          }),
        ],
      }),

      makeSection({
        title: 'Depuración',
        rows: [
          makeRow({
            label: 'Mostrar el prompt del sistema',
            desc: 'Incluye en el hilo el prompt que recibe el modelo en cada turno.',
            control: makeToggle({
              value: prefs.debugShowSystemPrompt === true,
              onChange: (value) => setPref('debugShowSystemPrompt', value),
            }),
          }),
          makeRow({
            label: 'Mostrar el uso de tokens por turno',
            desc: 'Añade entradas y salidas del modelo al pie de cada respuesta.',
            control: makeToggle({
              value: prefs.debugShowTokens === true,
              onChange: (value) => setPref('debugShowTokens', value),
            }),
          }),
        ],
      }),
      makeSection({
        title: 'Trayectoria',
        rows: [
          makeRow({
            label: 'Ruta de las trayectorias',
            desc: 'Ficheros de snapshot por conversación, en la carpeta de datos.',
            control: makeButton({
              label: 'Abrir carpeta',
              onClick: () => {
                // No hay API para revelar la carpeta: se avisa en vez de fingir.
                window.api.notify?.('Las trayectorias están en userData/trajectory.') ??
                  alert('Las trayectorias están en userData/trajectory.');
              },
            }),
          }),
        ],
      }),
    ];
  }

  function renderShortcuts() {
    const rows = [
      ['Enviar mensaje', ['Ctrl', 'Enter']],
      ['Nueva línea', ['Shift', 'Enter']],
      ['Cerrar ajustes', ['Esc']],
      ['Nueva conversación', ['Ctrl', 'N']],
      ['Cambiar de modelo', ['Ctrl', 'M']],
    ];

    return [
      makeSection({
        title: 'Conversation',
        desc: 'Atajos del cuadro de entrada.',
        rows: rows.map(([label, keys]) => {
          const frag = document.createDocumentFragment();
          keys.forEach((key, index) => {
            if (index > 0) frag.append(document.createTextNode(' + '));
            frag.append(el('span', 'kbd', key));
          });
          return makeRow({ label, desc: null, control: frag });
        }),
      }),
    ];
  }

  /** Textarea simple con commit al cambiar. */
  function makeTextarea({ value, placeholder, rows, onCommit }) {
    const area = document.createElement('textarea');
    area.className = 'text-area';
    area.rows = rows ?? 5;
    area.placeholder = placeholder ?? '';
    area.value = value ?? '';
    area.spellcheck = false;
    area.addEventListener('change', () => onCommit(area.value));
    area.addEventListener('blur', () => onCommit(area.value));
    return area;
  }

  function renderTools() {
    const tools = bridge.getTools ? bridge.getTools() : [];

    const rows = tools.map((tool) => {
      const current = tool.permission ?? 'inherit';
      return makeRow({
        label: tool.name,
        desc: tool.description,
        control: makeSegmented({
          options: ['inherit', 'allow', 'ask', 'deny'],
          value: current,
          onChange: (value) => {
            const next = { ...(prefs.toolPermissions ?? {}) };
            if (value === 'inherit') delete next[tool.name];
            else next[tool.name] = value;
            setPref('toolPermissions', next);
          },
        }),
      });
    });

    return [
      makeSection({
        title: 'Permisos por herramienta',
        desc: 'inherit usa el preset global. allow nunca pregunta. ask siempre pregunta. deny bloquea.',
        rows:
          rows.length > 0
            ? rows
            : [makeRow({ label: 'Sin herramientas', desc: 'No se pudo leer el catálogo.', control: null })],
      }),
    ];
  }

  function renderNetwork() {
    const rules = prefs.networkRules ?? { allow: [], deny: [] };

    const allowArea = makeTextarea({
      value: (rules.allow ?? []).join('\n'),
      placeholder: 'github.com\napi.openai.com',
      onCommit: (value) =>
        setPref('networkRules', {
          ...rules,
          allow: value.split('\n').map((line) => line.trim()).filter(Boolean),
        }),
    });

    const denyArea = makeTextarea({
      value: (rules.deny ?? []).join('\n'),
      placeholder: 'example.com',
      onCommit: (value) =>
        setPref('networkRules', {
          ...rules,
          deny: value.split('\n').map((line) => line.trim()).filter(Boolean),
        }),
    });

    return [
      makeSection({
        title: 'Dominios permitidos',
        desc: 'Uno por línea. Si la lista está vacía, se permite todo lo que no esté denegado.',
        rows: [makeRow({ label: 'Allow', desc: 'Subdominios incluidos.', control: allowArea })],
      }),
      makeSection({
        title: 'Dominios denegados',
        desc: 'Tienen prioridad sobre las permitidas.',
        rows: [makeRow({ label: 'Deny', desc: 'Se aplica antes que allow.', control: denyArea })],
      }),
    ];
  }

  /** Catálogo local de MCP: se carga una vez por sesión de ajustes. */
  let catalogoMcp = null;
  let catalogoMcpCargando = false;

  function renderPlugins() {
    const plugins = prefs.plugins ?? [];

    if (!catalogoMcp && !catalogoMcpCargando && window.api.marketplaceList) {
      catalogoMcpCargando = true;
      window.api
        .marketplaceList()
        .then((lista) => {
          catalogoMcp = Array.isArray(lista) ? lista : [];
        })
        .catch(() => {
          catalogoMcp = [];
        })
        .finally(() => {
          catalogoMcpCargando = false;
          render();
        });
    }

    const nameInput = el('input', 'text-input');
    nameInput.placeholder = 'filesystem';

    const commandInput = el('input', 'text-input');
    commandInput.placeholder = 'npx';

    const argsInput = el('input', 'text-input');
    argsInput.placeholder = '-y @modelcontextprotocol/server-filesystem .';

    const envInput = el('input', 'text-input');
    envInput.placeholder = 'TOKEN=abc, RUTA=/tmp';

    const addBtn = makeButton({
      label: 'Añadir',
      onClick: () => {
        const name = nameInput.value.trim();
        const command = commandInput.value.trim();

        if (name.length === 0 || command.length === 0) {
          showNotice('Nombre y comando son obligatorios.');
          return;
        }

        // Variables de entorno: "CLAVE=valor, CLAVE2=valor2".
        const env = {};
        for (const pair of envInput.value.split(',')) {
          const [key, ...rest] = pair.split('=');
          if (key && key.trim()) env[key.trim()] = rest.join('=').trim();
        }

        setPref('plugins', [
          ...plugins,
          {
            id: `plugin-${Date.now().toString(36)}`,
            name,
            command,
            args: argsInput.value.trim().split(/\s+/).filter(Boolean),
            env,
            enabled: true,
          },
        ]);
        render();
      },
    });

    /** Fila de un servidor con su estado, interruptor y acciones. */
    const serverRow = (plugin) => {
      const status = el('span', 'plugin-status');
      status.textContent = plugin.enabled === false ? 'desactivado' : 'sin probar';

      const toggle = makeToggle({
        value: plugin.enabled !== false,
        onChange: (value) => {
          setPref(
            'plugins',
            plugins.map((entry) => (entry.id === plugin.id ? { ...entry, enabled: value } : entry)),
          );
          render();
        },
      });

      const probe = makeButton({
        label: 'Probar',
        onClick: async () => {
          status.textContent = 'probando…';
          status.classList.remove('is-ok', 'is-error');

          const result = await window.api.probeMcp({
            command: plugin.command,
            args: plugin.args ?? [],
            env: plugin.env ?? {},
          });

          if (result.ok) {
            status.textContent = `${result.tools.length} herramienta(s)`;
            status.classList.add('is-ok');
            status.title = result.tools.map((tool) => tool.name).join(', ');
          } else {
            status.textContent = 'error';
            status.classList.add('is-error');
            status.title = result.error;
          }
        },
      });

      const remove = makeButton({
        label: 'Quitar',
        onClick: () => {
          setPref('plugins', plugins.filter((entry) => entry.id !== plugin.id));
          render();
        },
      });

      const controls = el('div', 'inline-fields');
      controls.append(status, probe, toggle, remove);

      return makeRow({
        label: plugin.name,
        desc: `${plugin.command} ${(plugin.args ?? []).join(' ')}`.trim(),
        control: controls,
      });
    };

    const rows = plugins.map(serverRow);

    const instalados = new Set(plugins.map((entrada) => String(entrada.name)));
    const catalogo = (catalogoMcp ?? []).filter((entrada) => !instalados.has(entrada.name));
    const catalogoRows = catalogo.map((entrada) =>
      makeRow({
        label: entrada.name,
        desc: `${entrada.description} · ${entrada.command} ${entrada.args.join(' ')}`,
        control: makeButton({
          label: 'Instalar',
          onClick: () => {
            setPref('plugins', [
              ...plugins,
              {
                id: `mcp-${entrada.id}`,
                name: entrada.name,
                command: entrada.command,
                args: [...entrada.args],
                env: { ...entrada.env },
                enabled: true,
              },
            ]);
            render();
          },
        }),
      }),
    );

    const addRow = makeRow({
      label: 'Nuevo servidor',
      desc: 'Nombre, comando, argumentos y variables de entorno opcionales.',
      control: el('div', 'inline-fields'),
      className: 'row--stacked',
    });
    addRow
      .querySelector('.inline-fields')
      .append(nameInput, commandInput, argsInput, envInput, addBtn);

    return [
      makeSection({
        title: 'Servidores MCP',
        desc: 'Se lanzan por stdio al empezar cada turno y se cierran al terminar. «Probar» arranca el servidor, cuenta sus herramientas y lo cierra.',
        rows: rows.length > 0 ? rows : [makeRow({ label: 'Sin servidores', desc: null, control: null })],
      }),
      makeSection({
        title: 'Marketplace',
        desc:
          'Catálogo local de servidores MCP open source. Se instalan como plugins ' +
          'normales; no hay cuentas, planes ni pagos.',
        rows:
          catalogoRows.length > 0
            ? catalogoRows
            : [
                makeRow({
                  label: catalogoMcp ? 'Todo instalado' : 'Cargando catálogo…',
                  desc: null,
                  control: null,
                }),
              ],
      }),
      makeSection({ title: 'Añadir', desc: null, rows: [addRow] }),
    ];
  }

  function renderConversations() {
    const state = bridge.getState();
    const skills = bridge.getSkills ? bridge.getSkills() : [];

    /*
     * Medido en su DOM: esta sección empieza con **Customizations** (el desglose
     * de tokens) y **Skills**, igual que la del proyecto, y después el historial.
     */
    const skillRows = skills.map((skill) =>
      makeRow({
        label: skill.name,
        desc: skill.description,
        control: makeToggle({
          value: skill.enabled,
          onChange: (value) => {
            setPref('skills', { ...(prefs.skills ?? {}), [skill.id]: value });
            if (bridge.refreshSkills) bridge.refreshSkills();
          },
        }),
      }),
    );

    return [
      makeSection({
        title: 'Customizations',
        desc:
          'El desglose muestra el uso de tokens de las personalizaciones: reglas, ' +
          'skills y MCP. Si se pasa del presupuesto, las reglas largas se convierten en ' +
          'punteros y las personalizaciones grandes se excluyen solas.',
        rows: [
          makeRow({
            label: 'Uso de tokens',
            desc:
              skills.length === 0
                ? 'No hay personalizaciones activas.'
                : `${skills.filter((s) => s.enabled).length} de ${skills.length} skills activas.`,
            control: makeButton({
              label: 'Abrir',
              onClick: () => selectSection('customizations'),
            }),
          }),
        ],
      }),
      makeSection({
        title: 'Skills',
        count: skillRows.length,
        rows:
          skillRows.length > 0
            ? skillRows
            : [makeRow({ label: 'Sin skills', desc: 'No hay skills disponibles.', control: null })],
      }),
      makeSection({
        title: 'History',
        desc: 'Cómo se guardan y cuánto se conserva el historial.',
        rows: [
          makeRow({
            label: 'Guardar historial',
            desc: 'Las conversaciones se escriben en disco en formato JSONL.',
            control: makeToggle({
              value: prefs.saveHistory !== false,
              onChange: (value) => setPref('saveHistory', value),
            }),
          }),
          makeRow({
            label: 'Días de retención',
            desc: 'Las conversaciones más antiguas se borran al arrancar y cada 6 horas.',
            control: makeSelect({
              options: ['7', '30', '90', 'Nunca'],
              value: String(prefs.retentionDays ?? '30'),
              onChange: (value) => setPref('retentionDays', value),
            }),
          }),
          makeRow({
            label: 'Limpiar ahora',
            desc: 'Aplica la retención en este momento y dice cuántas conversaciones borró.',
            control: makeButton({
              label: 'Limpiar',
              onClick: async () => {
                const result = await window.api.applyRetention();
                if (result?.skipped) showNotice('La retención está desactivada (Nunca).');
                else showNotice(`Borradas ${result?.removed ?? 0} conversaciones de más de ${result?.days} días.`);
                render();
              },
            }),
          }),
        ],
      }),
      makeSection({
        title: 'Export',
        desc: null,
        rows: [
          makeRow({
            label: 'Exportar conversación actual',
            desc: 'Guarda el historial como Markdown en el disco.',
            control: makeButton({
              label: 'Export',
              onClick: () => bridge.exportActiveConversation?.(),
            }),
          }),
          makeRow({
            label: 'Conversaciones guardadas',
            desc: `${state ? 'Historial disponible' : ''}`,
            control: makeButton({
              label: 'Abrir historial',
              onClick: () => {
                selectSection('general');
                bridge.openSearch?.();
              },
            }),
          }),
        ],
      }),
    ];
  }

  function renderFeedback() {
    const link = (label, url) =>
      makeRow({
        label,
        desc: url,
        control: makeButton({ label: 'Abrir', onClick: () => window.api.openExternal(url) }),
      });

    return [
      makeSection({
        title: 'Report a problem',
        desc: 'Describe qué esperabas y qué ocurrió.',
        rows: [
          makeRow({
            label: 'Abrir una incidencia',
            desc: 'Crea un informe con el contexto del proyecto.',
            control: makeButton({
              label: 'Abrir',
              onClick: () => window.api.openExternal('https://github.com'),
            }),
          }),
          makeRow({
            label: 'Copiar diagnóstico',
            desc: 'Copia versión, proveedor y modelo al portapapeles.',
            control: makeButton({
              label: 'Copiar',
              onClick: () => {
                const state = bridge.getState();
                const text = [
                  `proveedor: ${state?.providerId ?? '—'}`,
                  `modelo: ${state?.model ?? '—'}`,
                  `workspace: ${state?.cwd ?? '—'}`,
                  `plataforma: ${navigator.platform}`,
                ].join('\n');
                navigator.clipboard.writeText(text).catch(() => {});
              },
            }),
          }),
        ],
      }),
      makeSection({
        title: 'Links',
        desc: null,
        rows: [
          link('Documentación', 'https://github.com'),
          link('Problemas conocidos', 'https://github.com'),
        ],
      }),
    ];
  }

  const RENDERERS = {
    general: renderGeneral,
    account: renderAccount,
    appearance: renderAppearance,
    notifications: renderNotifications,
    conversations: renderConversations,
    feedback: renderFeedback,
    models: renderModels,
    customizations: renderCustomizations,
    application: renderApplication,
    shortcuts: renderShortcuts,
    google: renderGoogle,
    project: renderProject,
    developer: renderDeveloper,
    tools: renderTools,
    network: renderNetwork,
    plugins: renderPlugins,
  };

  // -------------------------------------------------------------------------
  // Navegación y ciclo de vida
  // -------------------------------------------------------------------------

  function render() {
    const meta = SECTIONS[active] ?? SECTIONS.general;
    if (active === 'project') {
      const cwd = proyectoActivo || bridge?.getState?.()?.cwd || '';
      const nombre = cwd.split(/[\\/]/).filter(Boolean).pop();
      els.title.textContent = nombre || meta.title;
      els.subtitle.textContent = 'Manage project folders and settings.';
    } else {
      els.title.textContent = meta.title;
      els.subtitle.textContent = meta.subtitle;
    }
    els.back.hidden = !meta.parent;

    els.body.replaceChildren();
    const renderer = RENDERERS[active] ?? renderGeneral;
    for (const node of renderer()) els.body.append(node);

    for (const btn of els.nav.querySelectorAll('[data-section]')) {
      btn.classList.toggle('is-active', btn.dataset.section === active);
    }
    renderProyectos();
  }

  function selectSection(section) {
    active = section;
    render();
    els.body.scrollTop = 0;
  }

  /** Pinta las entradas de proyecto; Antigravity muestra tres y «Show All». */
  function renderProyectos() {
    if (!els.projects) return;
    const actual = bridge?.getState?.()?.cwd ?? '';
    const lista = proyectos.length > 0 ? proyectos : actual ? [actual] : [];
    const visibles = mostrarTodosLosProyectos ? lista : lista.slice(0, 3);

    els.projects.replaceChildren();
    for (const cwd of visibles) {
      const nombre = String(cwd).split(/[\\/]/).filter(Boolean).pop() || 'Project';
      const boton = document.createElement('button');
      boton.type = 'button';
      boton.className = 'settings__nav-item';
      boton.textContent = nombre;
      boton.title = cwd;
      boton.dataset.cwd = cwd;
      const activo = (proyectoActivo || actual) === cwd && active === 'project';
      boton.classList.toggle('is-active', activo);
      boton.addEventListener('click', () => {
        proyectoActivo = cwd;
        selectSection('project');
      });
      els.projects.append(boton);
    }

    if (els.projectsMore) {
      els.projectsMore.hidden = lista.length <= 3;
      els.projectsMore.textContent = mostrarTodosLosProyectos ? 'Show Less' : 'Show All';
    }
  }

  async function cargarProyectos() {
    const actual = bridge?.getState?.()?.cwd ?? '';
    let cwds = [];
    try {
      const sesiones = (await window.api.listSessions()) || [];
      const vistos = new Set();
      for (const sesion of sesiones) {
        if (sesion.cwd && !vistos.has(sesion.cwd)) {
          vistos.add(sesion.cwd);
          cwds.push(sesion.cwd);
        }
      }
    } catch {
      cwds = [];
    }
    if (actual) cwds = [actual, ...cwds.filter((cwd) => cwd !== actual)];
    proyectos = cwds;
    renderProyectos();
  }

  function open(section) {
    if (section && SECTIONS[section]) active = section;
    void cargarProyectos();

    // Relee las preferencias: pueden haber cambiado desde la app.
    window.api
      .getPrefs()
      .then((stored) => {
        if (stored && typeof stored === 'object') {
          prefs = { ...DEFAULTS, ...stored };
          render();
        }
      })
      .catch(() => {});
    els.modal.removeAttribute('hidden');
    render();
  }

  function close() {
    els.modal.setAttribute('hidden', '');
  }

  function showNotice(message) {
    console.info('[settings]', message);
  }

  function init(options) {
    bridge = options;

    for (const btn of els.nav.querySelectorAll('[data-section]')) {
      btn.addEventListener('click', () => selectSection(btn.dataset.section));
    }

    els.back.addEventListener('click', () => {
      const meta = SECTIONS[active];
      selectSection(meta && meta.parent ? meta.parent : 'general');
    });

    els.feedback.addEventListener('click', () => selectSection('feedback'));
    els.projectsMore?.addEventListener('click', () => {
      mostrarTodosLosProyectos = !mostrarTodosLosProyectos;
      renderProyectos();
    });

    window.api
      .getPrefs()
      .then((stored) => {
        if (stored && typeof stored === 'object') prefs = { ...DEFAULTS, ...stored };
      })
      .catch(() => {});
  }

  window.SettingsUI = {
    init,
    open,
    close,
    refresh: () => {
      if (!els.modal.hasAttribute('hidden')) render();
    },
    isOpen: () => !els.modal.hasAttribute('hidden'),
  };
})();

(() => {
  const app = document.querySelector('#app');
  const home = document.querySelector('#home');
  const workspace = document.querySelector('#workspace');
  const systemHub = document.querySelector('#system-hub');
  const fx = document.querySelector('#transition-fx');
  const phase = document.querySelector('#phase-caption');
  const projectPanel = document.querySelector('#project-panel');
  const hubSheet = document.querySelector('#hub-sheet');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let activeTechnique = 'blue';
  let transitioning = false;
  let timers = [];

  const techniques = {
    blue: {
      title: 'BLUE', kicker: 'CURSED TECHNIQUE LAPSE', runtime: 'Blue Runtime',
      copy: 'Контекст Blue сохранён. Пространство втягивается к задаче; продолжаю выполнение и фиксирую доказательства.'
    },
    red: {
      title: 'RED', kicker: 'CURSED TECHNIQUE REVERSAL', runtime: 'Red Operations',
      copy: 'Контекст Red сохранён. Проверка завершена; готовлю ударный переход к следующему устойчивому состоянию.'
    },
    purple: {
      title: 'HOLLOW PURPLE', kicker: 'HOLLOW TECHNIQUE', runtime: 'Purple Synthesis',
      copy: 'Blue и Red сведены без смешения runtime. Purple синтезирует результат и стирает предыдущую сцену.'
    }
  };

  const sheetData = {
    chats: ['Chat settings', ['BLUE', 'Ready'], ['RED', 'Ready'], ['PURPLE', 'Ready']],
    contracts: ['Contracts', ['OBJECTIVE', 'Bound'], ['EVIDENCE', 'Required'], ['DELIVERY', 'Protected']],
    global: ['Global settings', ['MOTION', 'Cinematic'], ['SOUND', 'Off'], ['PROFILE', 'Balanced']],
    diagnostics: ['Diagnostics', ['GPU', 'Available'], ['RUNTIMES', '3 isolated'], ['RECOVERY', 'Stable']]
  };

  const later = (callback, delay) => {
    const timer = window.setTimeout(callback, delay);
    timers.push(timer);
    return timer;
  };
  const clearTimers = () => { timers.forEach(window.clearTimeout); timers = []; };
  const setPhase = (text) => {
    phase.textContent = text;
    phase.classList.toggle('is-visible', Boolean(text));
  };

  function updateWorkspace(technique) {
    const data = techniques[technique];
    activeTechnique = technique;
    app.dataset.technique = technique;
    document.querySelector('#workspace-title').textContent = data.title;
    document.querySelector('#workspace-kicker').textContent = data.kicker;
    document.querySelector('#runtime-name').textContent = data.runtime;
    document.querySelector('#panel-title').textContent = data.runtime;
    document.querySelector('#assistant-copy').textContent = data.copy;
    document.querySelectorAll('[data-switch]').forEach((button) => button.classList.toggle('is-active', button.dataset.switch === technique));
  }

  function enterFromHome(target) {
    if (transitioning) return;
    transitioning = true;
    clearTimers();
    app.dataset.technique = target;
    setPhase('anticipation');
    app.dataset.mode = 'transition';
    const duration = reduced ? 250 : target === 'system' ? 2400 : 2200;
    if (reduced) {
      fx.classList.add('is-active');
      later(() => revealTarget(target), 120);
      later(() => settle(), duration);
      return;
    }
    later(() => setPhase('impact'), target === 'system' ? 560 : target === 'red' ? 280 : 360);
    later(() => { setPhase('full-screen occlusion'); fx.classList.add('is-active'); }, target === 'system' ? 1430 : 1380);
    later(() => { setPhase('reveal'); revealTarget(target); }, target === 'system' ? 1740 : 1580);
    later(() => settle(), duration);
  }

  function revealTarget(target) {
    home.setAttribute('aria-hidden', 'true');
    if (target === 'system') {
      app.dataset.mode = 'system';
      systemHub.setAttribute('aria-hidden', 'false');
      workspace.setAttribute('aria-hidden', 'true');
    } else {
      updateWorkspace(target);
      app.dataset.mode = 'workspace';
      workspace.setAttribute('aria-hidden', 'false');
      systemHub.setAttribute('aria-hidden', 'true');
    }
  }

  function settle() {
    setPhase('settle');
    fx.classList.remove('is-active');
    later(() => setPhase(''), 220);
    transitioning = false;
  }

  function switchTechnique(target) {
    if (transitioning || target === activeTechnique) return;
    transitioning = true;
    app.dataset.technique = target;
    setPhase('anticipation');
    if (reduced) {
      fx.classList.add('is-active');
      later(() => updateWorkspace(target), 100);
      later(() => settle(), 250);
      return;
    }
    later(() => setPhase('impact'), 220);
    later(() => { fx.classList.add('is-active'); setPhase('occlusion'); }, 560);
    later(() => { updateWorkspace(target); setPhase('reveal'); }, 790);
    later(() => settle(), 1600);
  }

  function returnHome() {
    if (transitioning) return;
    transitioning = true;
    clearTimers();
    hubSheet.classList.remove('is-open');
    projectPanel.classList.remove('is-open');
    hubSheet.inert = true;
    projectPanel.inert = true;
    setPhase('return');
    fx.classList.add('is-active');
    const duration = reduced ? 250 : 1800;
    later(() => {
      app.dataset.mode = 'home';
      app.dataset.technique = 'idle';
      home.setAttribute('aria-hidden', 'false');
      workspace.setAttribute('aria-hidden', 'true');
      systemHub.setAttribute('aria-hidden', 'true');
      fx.classList.remove('is-active');
    }, reduced ? 100 : 460);
    later(() => { setPhase(''); transitioning = false; }, duration);
  }

  document.querySelectorAll('[data-enter]').forEach((button) => {
    const target = button.dataset.enter;
    const showLabel = () => {
      if (target === 'system') {
        document.querySelector('#home-technique-name').textContent = 'SIX EYES';
        document.querySelector('#home-technique-detail').textContent = 'SYSTEM LAYER · 2.4 s';
      } else {
        document.querySelector('#home-technique-name').textContent = techniques[target].title;
        document.querySelector('#home-technique-detail').textContent = `${techniques[target].kicker} · 2.2 s`;
      }
    };
    button.addEventListener('pointerenter', showLabel);
    button.addEventListener('focus', showLabel);
    button.addEventListener('touchstart', showLabel, { passive: true });
    button.addEventListener('click', () => enterFromHome(target));
  });
  document.querySelectorAll('[data-switch]').forEach((button) => button.addEventListener('click', () => switchTechnique(button.dataset.switch)));
  document.querySelectorAll('[data-home]').forEach((button) => button.addEventListener('click', returnHome));
  document.querySelector('[data-open-panel]').addEventListener('click', () => { projectPanel.inert = false; projectPanel.classList.add('is-open'); projectPanel.setAttribute('aria-hidden', 'false'); });
  document.querySelector('[data-close-panel]').addEventListener('click', () => { projectPanel.classList.remove('is-open'); projectPanel.setAttribute('aria-hidden', 'true'); projectPanel.inert = true; });
  document.querySelectorAll('[data-hub]').forEach((button) => button.addEventListener('click', () => {
    const [title, ...rows] = sheetData[button.dataset.hub];
    document.querySelector('#sheet-title').textContent = title;
    document.querySelector('#sheet-content').innerHTML = `<div class="sheet-grid">${rows.map(([label, value]) => `<div><small>${label}</small><b>${value}</b></div>`).join('')}</div>`;
    hubSheet.inert = false;
    hubSheet.classList.add('is-open');
    hubSheet.setAttribute('aria-hidden', 'false');
  }));
  document.querySelector('[data-close-sheet]').addEventListener('click', () => { hubSheet.classList.remove('is-open'); hubSheet.setAttribute('aria-hidden', 'true'); hubSheet.inert = true; });
  window.addEventListener('keydown', (event) => { if (event.key === 'Escape' && app.dataset.mode !== 'home') returnHome(); });
})();

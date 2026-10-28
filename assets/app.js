(() => {
  'use strict';

  const CACHE_KEY = 'gh-cache-v1';
  const CACHE_TTL = 60 * 60 * 1000; // 1 h: la API pública de GitHub permite 60 peticiones/hora
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const BRANCH_LABEL = {
    about: 'Sobre mí', projects: 'Proyectos', langs: 'Lenguajes',
    skills: 'Habilidades', career: 'Experiencia', social: 'Contacto',
  };
  const PHOTO_R = 46;     // radio del retrato de origen (unidades de mundo)
  const HUB_DIST = 430;   // distancia retrato → rama

  // los colores del canvas salen de los mismos tokens que el CSS
  const C = {};
  function readTokens() {
    const cs = getComputedStyle(document.documentElement);
    for (const k of ['sky', 'sky-low', 'cloud', 'ridge', 'sea', 'ink', 'mist', 'bolt', 'glow', 'sodium']) {
      C[k.replace(/-(\w)/g, (_, c) => c.toUpperCase())] = cs.getPropertyValue(`--color-${k}`).trim();
    }
  }

  // ---------- utilidades ----------
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = t => t * t * (3 - 2 * t);
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
  };
  const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });
  function ago(iso) {
    const s = (new Date(iso) - Date.now()) / 1000;
    const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
    for (const [u, sec] of units) if (Math.abs(s) >= sec) return rtf.format(Math.round(s / sec), u);
    return 'justo ahora';
  }
  const prettyName = n => n.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  // resumen de una línea para la lista: primera frase, cortada en una palabra si es larga
  function brief(s, max = 78) {
    if (!s) return '';
    let t = (s.match(/^.*?[.:](\s|$)/) || [s])[0].replace(/[:.]\s*$/, '').trim();
    if (t.length > max) t = t.slice(0, t.lastIndexOf(' ', max)).replace(/[,;]$/, '') + '…';
    return t;
  }
  const rgba = (hex, a) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  };
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const bare = url => url.replace(/^mailto:|^https?:\/\/(www\.)?/, '').replace(/\/$/, '');

  async function getJSON(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return r.json();
  }

  // ---------- datos ----------
  const slimRepo = r => ({
    name: r.name, description: r.description, language: r.language, stars: r.stargazers_count, forks: r.forks_count,
    fork: r.fork, url: r.html_url, homepage: r.homepage, topics: r.topics || [], pushed_at: r.pushed_at,
    created_at: r.created_at, archived: r.archived,
  });

  async function loadGitHub(user) {
    const cached = store.get(CACHE_KEY);
    const fresh = cached && cached.user?.login?.toLowerCase() === user.toLowerCase();
    if (fresh && Date.now() - cached.t < CACHE_TTL) return { ...cached, source: 'cache' };
    try {
      const [u, repos] = await Promise.all([
        getJSON(`https://api.github.com/users/${user}`),
        getJSON(`https://api.github.com/users/${user}/repos?per_page=100&sort=pushed`),
      ]);
      const data = { t: Date.now(), user: u, repos: repos.map(slimRepo) };
      store.set(CACHE_KEY, data);
      return { ...data, source: 'live' };
    } catch (e) {
      console.warn('GitHub API no disponible, usando copia local', e);
      if (fresh) return { ...cached, source: 'cache' };
      return { ...(await getJSON('data/github.json')), source: 'snapshot' };
    }
  }

  // ---------- construcción del grafo ----------
  function buildGraph(P, G) {
    const nodes = [], links = [], byId = new Map();
    const add = (n, parent) => {
      n.children = [];
      nodes.push(n); byId.set(n.id, n);
      if (parent) { parent.children.push(n); n.parent = parent; links.push({ a: parent, b: n, kind: 'tree' }); }
      return n;
    };
    const cross = (a, b) => { if (byId.has(a) && byId.has(b)) links.push({ a: byId.get(a), b: byId.get(b), kind: 'cross' }); };

    const root = add({ id: 'root', type: 'root', depth: 0, branch: 'root', label: P.name, data: { kind: 'root' } });
    const hub = key => add({ id: `hub:${key}`, type: 'hub', depth: 1, branch: key, label: BRANCH_LABEL[key], data: { kind: 'hub' } }, root);
    const child = (parent, n) => add({ type: 'leaf', depth: parent.depth + 1, branch: parent.branch, ...n }, parent);

    const about = hub('about');
    if (P.location) child(about, { id: 'about:loc', label: P.location, data: { kind: 'text', title: P.location, text: 'Donde vivo y trabajo.' } });
    for (const i of P.interests || []) child(about, { id: `about:${i}`, label: i, data: { kind: 'text', title: i, text: 'Algo que me interesa, dentro y fuera del código.' } });

    // repos públicos de GitHub más los proyectos que no viven en un repo público
    const hidden = new Set((P.hiddenRepos || []).map(s => s.toLowerCase()));
    const featured = (P.featuredRepos || []).map(s => s.toLowerCase());
    const notes = P.repoDescriptions || {}, names = P.repoNames || {};
    const extra = (P.extraProjects || []).map(x => ({ stars: 0, fork: false, archived: false, topics: [], extra: true, ...x }));
    const repos = [...G.repos.filter(r => !extra.some(x => x.name === r.name)), ...extra]
      .map(r => ({ ...r, description: notes[r.name] || r.description || '', title: r.title || names[r.name] || prettyName(r.name) }))
      .filter(r => !r.fork && !r.archived && !hidden.has(r.name.toLowerCase()))
      .sort((a, b) => {
        const fa = featured.indexOf(a.name.toLowerCase()), fb = featured.indexOf(b.name.toLowerCase());
        if ((fa < 0) !== (fb < 0)) return fa < 0 ? 1 : -1;
        if (fa >= 0) return fa - fb;
        return new Date(b.pushed_at || 0) - new Date(a.pushed_at || 0);
      });
    const projects = hub('projects');
    for (const r of repos) {
      child(projects, { id: `repo:${r.name}`, label: r.title, big: featured.includes(r.name.toLowerCase()), data: { kind: 'repo', repo: r } });
    }

    const langCount = new Map();
    for (const r of repos) if (r.language) langCount.set(r.language, (langCount.get(r.language) || 0) + 1);
    if (langCount.size) {
      const langs = hub('langs');
      for (const [lang, n] of [...langCount].sort((a, b) => b[1] - a[1])) {
        child(langs, { id: `lang:${lang}`, label: lang, big: n > 2, data: { kind: 'lang', lang, count: n } });
      }
      for (const r of repos) if (r.language) cross(`repo:${r.name}`, `lang:${r.language}`);
    }

    if (P.skills?.length) {
      const skills = hub('skills');
      for (const g of P.skills) {
        const sub = child(skills, { id: `skg:${g.group}`, type: 'sub', label: g.group, data: { kind: 'group', group: g } });
        for (const s of g.items) {
          const live = (s.repos || []).filter(n => byId.has(`repo:${n}`));
          child(sub, { id: `sk:${g.group}:${s.name}`, label: s.name, data: { kind: 'skill', skill: s, group: g.group, repos: live } });
          for (const n of live) cross(`sk:${g.group}:${s.name}`, `repo:${n}`);
        }
      }
    }

    const linkedin = (P.links || []).find(l => /linkedin/i.test(l.label) && l.url);
    if (P.experience?.length || P.education?.length || linkedin) {
      const career = hub('career');
      (P.experience || []).forEach((j, i) => child(career, { id: `job:${i}`, label: j.role, data: { kind: 'job', job: j } }));
      (P.education || []).forEach((j, i) => child(career, { id: `edu:${i}`, label: j.title, data: { kind: 'job', job: j, edu: true } }));
      if (linkedin) child(career, { id: 'career:linkedin', label: 'Perfil de LinkedIn', data: { kind: 'link', link: linkedin } });
    }

    const socialLinks = (P.links || []).filter(l => l.url);
    if (socialLinks.length) {
      const social = hub('social');
      for (const l of socialLinks) child(social, { id: `link:${l.label}`, label: l.label, data: { kind: 'link', link: l } });
    }

    return { nodes, links, byId, root, repos, hubs: root.children };
  }

  // ---------- disposición: cada rama se abre en abanico desde el retrato ----------
  function layout(graph) {
    const n = graph.hubs.length;
    graph.root.x = 0; graph.root.y = 0;
    graph.hubs.forEach((h, i) => {
      const a = -Math.PI / 2 + i * (Math.PI * 2 / n);
      h.angle = a; h.x = Math.cos(a) * HUB_DIST; h.y = Math.sin(a) * HUB_DIST;
      fan(h, a, 1);
    });
    function fan(p, a, level) {
      const kids = p.children, k = kids.length;
      if (!k) return;
      const hasSubs = kids.some(c => c.type === 'sub');
      const span = level === 1 ? Math.min(2.8, .36 * k) : Math.min(1.7, .5 * k);
      const rows = k > 7 ? 3 : k > 3 ? 2 : 1;
      const base = hasSubs ? 250 : level === 1 ? 165 : 140;
      kids.forEach((c, j) => {
        const ca = a + (k === 1 ? 0 : (j / (k - 1) - .5) * span);
        const d = base + (j % rows) * (level === 1 ? 74 : 56);
        c.angle = ca; c.x = p.x + Math.cos(ca) * d; c.y = p.y + Math.sin(ca) * d;
        fan(c, ca, level + 1);
      });
    }
    // alcance de cada rama: su nombre se coloca más allá de la hoja más lejana
    for (const h of graph.hubs) {
      h.reach = 0;
      (function walk(x) { x.children.forEach(c => { h.reach = Math.max(h.reach, Math.hypot(c.x - h.x, c.y - h.y)); walk(c); }); })(h);
    }
  }

  // ---------- rayos ----------
  // desplazamiento del punto medio: una línea quebrada con aspecto de descarga eléctrica
  function boltPath(x1, y1, x2, y2, rough = .2, iters = 6) {
    let pts = [[x1, y1], [x2, y2]];
    let disp = Math.hypot(x2 - x1, y2 - y1) * rough;
    for (let i = 0; i < iters; i++) {
      const next = [pts[0]];
      for (let j = 1; j < pts.length; j++) {
        const [ax, ay] = pts[j - 1], [bx, by] = pts[j];
        const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
        const o = (Math.random() - .5) * disp;
        next.push([(ax + bx) / 2 - dy / len * o, (ay + by) / 2 + dx / len * o], pts[j]);
      }
      pts = next; disp /= 2;
    }
    return pts;
  }
  function makeForks(path) {
    const forks = [], n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const at = .2 + Math.random() * .6, idx = Math.floor(at * (path.length - 1));
      const [x, y] = path[idx], [nx, ny] = path[Math.min(idx + 4, path.length - 1)];
      const a = Math.atan2(ny - y, nx - x) + (Math.random() < .5 ? -1 : 1) * (.4 + Math.random() * .6);
      const len = 30 + Math.random() * 70;
      forks.push({ at, pts: boltPath(x, y, x + Math.cos(a) * len, y + Math.sin(a) * len, .35, 4) });
    }
    return forks;
  }

  // ruido de valor suave para nubes y montaña
  function noise2(seed = Math.random() * 1e4) {
    const R = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7 + seed) * 43758.5453; return s - Math.floor(s); };
    return (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      const u = smooth(xf), v = smooth(yf);
      return lerp(lerp(R(xi, yi), R(xi + 1, yi), u), lerp(R(xi, yi + 1), R(xi + 1, yi + 1), u), v);
    };
  }
  function fbm(n, x, y, oct = 5) {
    let s = 0, a = .5, f = 1;
    for (let i = 0; i < oct; i++) { s += a * n(x * f, y * f); a *= .5; f *= 2.03; }
    return s;
  }

  // ---------- escena ----------
  function createScene(graph, P, G) {
    const canvas = $('#sky'), ctx = canvas.getContext('2d');
    let W = 0, H = 0, DPR = 1;
    const cam = { x: 0, y: 0, k: 1 };
    // mismo criterio que el CSS: móvil o tableta en vertical → red arriba, texto debajo
    const stacked = () => W <= 760 || (W <= 1100 && H > W);
    const horizonY = () => stacked() ? H * .54 : H * .84;
    let hover = null, selected = null, flash = 0, flashX = 0, lastT = performance.now(), crossReveal = 0;
    let activeBranch = null, hoverNear = new Set();
    const photo = new Image();
    photo.src = P.avatar || G.user.avatar_url;

    // ---------- paisaje: nubes, el Ávila, las luces de la costa y la lluvia ----------
    let clouds = null, cloudsLit = null, ridge = [], lights = [], rain = [];
    const cloudNoise = noise2(), ridgeNoise = noise2();
    function buildLandscape() {
      // con la pestaña oculta la ventana puede medir 0: se reconstruye en el siguiente resize
      if (W < 1 || H < 1) { clouds = cloudsLit = null; ridge = []; lights = []; rain = []; return; }
      const hy = horizonY(), S = 4;
      const cw = Math.ceil(W * 1.3 / S), ch = Math.ceil(hy / S);
      const base = document.createElement('canvas'), lit = document.createElement('canvas');
      base.width = lit.width = cw; base.height = lit.height = ch;
      const bi = base.getContext('2d').createImageData(cw, ch), li = lit.getContext('2d').createImageData(cw, ch);
      const cc = parseInt(C.cloud.slice(1), 16), gc = parseInt(C.glow.slice(1), 16);
      for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw; x++) {
          const nx = x / cw * 6, ny = y / ch * 3.2;
          const warp = fbm(cloudNoise, nx * .5 + 7, ny * .5, 3);
          const d = fbm(cloudNoise, nx + warp * 1.6, ny * 1.4 + warp, 5);
          const dens = smooth(clamp((d - .38) / .32)) * (1 - .35 * (y / ch));
          const i = (y * cw + x) * 4;
          bi.data[i] = cc >> 16; bi.data[i + 1] = (cc >> 8) & 255; bi.data[i + 2] = cc & 255; bi.data[i + 3] = dens * 170;
          const edge = clamp(dens * 1.4 - fbm(cloudNoise, nx * 2, ny * 2, 2) * .5);
          li.data[i] = gc >> 16; li.data[i + 1] = (gc >> 8) & 255; li.data[i + 2] = gc & 255; li.data[i + 3] = edge * 235;
        }
      }
      base.getContext('2d').putImageData(bi, 0, 0); lit.getContext('2d').putImageData(li, 0, 0);
      clouds = base; cloudsLit = lit;

      // El Ávila: una cresta larga con picos, detrás de la costa
      const mh = stacked() ? H * .1 : H * .17;
      ridge = [];
      for (let x = -10; x <= W + 10; x += 6) {
        const u = x / W;
        const h = mh * (.45 + .55 * Math.sin(Math.PI * clamp(u * 1.1 - .05)) ** .7) * (.75 + .35 * fbm(ridgeNoise, u * 9, .5, 4));
        ridge.push([x, hy - h]);
      }
      const ridgeAt = x => { const i = clamp(Math.round((x + 10) / 6), 0, ridge.length - 1); return ridge[i][1]; };
      lights = Array.from({ length: Math.round(W / 5) }, () => {
        const x = Math.random() * W, top = ridgeAt(x);
        const y = hy - 2 - Math.pow(Math.random(), 2.6) * (hy - top) * .55;
        return { x, y, r: .6 + Math.random() * 1.1, a: .45 + Math.random() * .55, warm: Math.random() > .18, p: Math.random() * 6.28 };
      });
      rain = Array.from({ length: REDUCED ? 0 : Math.round(W * H / 7000) }, () => ({ x: Math.random() * W, y: Math.random() * H, l: 8 + Math.random() * 14, v: 700 + Math.random() * 500 }));
    }

    function resize() {
      DPR = Math.min(devicePixelRatio || 1, 2);
      W = innerWidth; H = innerHeight;
      canvas.width = W * DPR; canvas.height = H * DPR;
      buildLandscape();
      story.measure();
    }

    // aristas: los rayos del árbol tienen un orden de aparición dentro de su rama
    const edges = graph.links.map(l => ({ ...l, grow: 0, target: 0, strike: 0, path: null, forks: [], regenAt: 0 }));
    const tree = edges.filter(e => e.kind === 'tree');
    const crossE = edges.filter(e => e.kind === 'cross');
    const incoming = new Map(tree.map(e => [e.b.id, e]));
    for (const h of graph.hubs) {
      const order = [];
      const q = [h];
      while (q.length) { const n = q.shift(); order.push(incoming.get(n.id)); q.push(...n.children); }
      order.forEach((e, i) => { e.threshold = .9 * i / order.length; });
    }
    for (const n of graph.nodes) n.pop = n.type === 'root' ? 1 : 0;

    function regen(e) {
      // los rayos que salen del retrato arrancan en su borde, no en el centro
      let { x: ax, y: ay } = e.a;
      if (e.a.type === 'root') { const a = Math.atan2(e.b.y, e.b.x); ax = Math.cos(a) * PHOTO_R; ay = Math.sin(a) * PHOTO_R; }
      e.path = boltPath(ax, ay, e.b.x, e.b.y, e.kind === 'cross' ? .1 : .2, e.kind === 'cross' ? 5 : 6);
      e.forks = e.kind === 'tree' && e.a.type !== 'sub' ? makeForks(e.path) : [];
    }
    edges.forEach(regen);

    const queue = []; // descargas programadas: { t, e, power, restrike }
    const strike = (e, delay = 0, power = 1, restrike = true) => { if (!REDUCED) queue.push({ t: performance.now() + delay, e, power, restrike }); };
    function cascade(e, depth) {
      if (depth > 2) return;
      for (const c of e.b.children) {
        const ce = incoming.get(c.id);
        if (ce.grow > .99 && Math.random() < .5) { strike(ce, 70 + Math.random() * 90, .9, false); ce.depth = depth + 1; }
      }
    }
    function lightUp(e, power) {
      regen(e); e.strike = Math.max(e.strike, power);
      flash = Math.max(flash, power * (e.b.type === 'hub' ? 1 : .5));
      flashX = toScreen((e.a.x + e.b.x) / 2, 0)[0];
    }

    // ---------- cámara ----------
    const containerLeft = () => Math.max(clamp(W * .04, 16, 48), (W - 1440) / 2 + 48);
    function viewArea() {
      if (stacked()) return { x: 0, y: 64, w: W, h: H * .5 - 44 };
      const left = containerLeft() + Math.min(32 * 16, W * .4) + 24;
      return { x: left, y: 70, w: W - left - containerLeft(), h: horizonY() - H * .17 - 70 };
    }
    // el margen va en píxeles de pantalla porque las etiquetas no escalan con el zoom
    function fitCam(points) {
      const A = viewArea();
      const padX = stacked() ? 96 : 130, padY = 30;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const p of points) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
      const k = clamp(Math.min((A.w - padX * 2) / (x1 - x0 || 1), (A.h - padY * 2) / (y1 - y0 || 1)), .16, 1.5);
      return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, k };
    }
    function camFor(i) {
      const n = graph.hubs.length;
      if (i <= 0) return { x: 0, y: 0, k: stacked() ? 1.1 : 1.45 };
      if (i > n) return fitCam(graph.nodes);
      const pts = [graph.root];
      (function walk(x) { pts.push(x); x.children.forEach(walk); })(graph.hubs[i - 1]);
      return fitCam(pts);
    }
    const toScreen = (x, y) => {
      const A = viewArea();
      return [A.x + A.w / 2 + (x - cam.x) * cam.k, A.y + A.h / 2 + (y - cam.y) * cam.k];
    };
    const toWorld = (sx, sy) => {
      const A = viewArea();
      return [(sx - A.x - A.w / 2) / cam.k + cam.x, (sy - A.y - A.h / 2) / cam.k + cam.y];
    };

    // ---------- estado de scroll ----------
    function scrollState() {
      const { u } = story.progress();
      const n = graph.hubs.length;
      // la cámara se queda en el capítulo actual y viaja al siguiente en su segunda mitad
      const i0 = Math.min(Math.floor(u), n + 1), f = smooth(clamp((u - i0 - .55) / .45));
      const c0 = camFor(i0), c1 = camFor(Math.min(i0 + 1, n + 1));
      const target = { x: lerp(c0.x, c1.x, f), y: lerp(c0.y, c1.y, f), k: lerp(c0.k, c1.k, f) };
      const reveal = graph.hubs.map((_, i) => clamp((u - (i + 1) + .15) / .6));
      crossReveal = clamp((u - (n + 1) + .2) / .4);
      const active = Math.floor(u);
      activeBranch = active >= 1 && active <= n ? graph.hubs[active - 1].branch : null;
      return { target, reveal };
    }

    // ---------- dibujo del paisaje ----------
    function drawLandscape(t, dt) {
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      const hy = horizonY();
      const sky = ctx.createLinearGradient(0, 0, 0, hy);
      sky.addColorStop(0, C.sky); sky.addColorStop(1, C.skyLow);
      ctx.fillStyle = sky; ctx.fillRect(0, 0, W, hy);

      // nubes: deriva lenta con el viento y un poco de paralaje con la cámara
      if (clouds) {
        const drift = REDUCED ? 0 : (t / 1000 * 4) % (W * .3);
        const ox = -drift - cam.x * .02 * cam.k, oy = -cam.y * .015 * cam.k;
        ctx.imageSmoothingEnabled = true;
        ctx.globalAlpha = .9;
        ctx.drawImage(clouds, ox, oy, W * 1.3, hy);
        if (flash > .02) {
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = clamp(flash * .75);
          ctx.drawImage(cloudsLit, ox, oy, W * 1.3, hy);
          ctx.globalCompositeOperation = 'source-over';
        }
        ctx.globalAlpha = 1;
      }
      if (flash > .01) {
        const g = ctx.createRadialGradient(flashX, hy * .35, 0, flashX, hy * .35, Math.max(W, H) * .7);
        g.addColorStop(0, rgba(C.glow, flash * .2)); g.addColorStop(1, rgba(C.glow, 0));
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, hy);
      }

      // el Ávila, recortado contra el cielo; el relámpago le dibuja el perfil
      ctx.beginPath(); ctx.moveTo(-10, hy);
      for (const [x, y] of ridge) ctx.lineTo(x, y);
      ctx.lineTo(W + 10, hy); ctx.closePath();
      ctx.fillStyle = C.ridge; ctx.fill();
      if (flash > .05) {
        ctx.beginPath(); ridge.forEach(([x, y], i) => ctx[i ? 'lineTo' : 'moveTo'](x, y));
        ctx.strokeStyle = rgba(C.glow, flash * .35); ctx.lineWidth = 1; ctx.stroke();
      }

      // luces de la costa
      for (const l of lights) {
        const tw = REDUCED ? 1 : .85 + .15 * Math.sin(t / 700 + l.p);
        ctx.fillStyle = rgba(l.warm ? C.sodium : C.bolt, l.a * tw);
        ctx.fillRect(l.x, l.y, l.r, l.r);
      }

      // el mar, con el reflejo de las luces y del relámpago
      const sea = ctx.createLinearGradient(0, hy, 0, H);
      sea.addColorStop(0, C.ridge); sea.addColorStop(1, C.sea);
      ctx.fillStyle = sea; ctx.fillRect(0, hy, W, H - hy);
      for (const l of lights) {
        if (l.y < hy - 8 || l.r < 1.3 || l.a < .7) continue;
        const len = 4 + l.r * 10;
        ctx.fillStyle = rgba(l.warm ? C.sodium : C.bolt, l.a * .16);
        for (let k = 0; k < len; k += 2.5) {
          if (Math.sin(l.p * 13 + k * 1.7) < -.3) continue;
          const wob = REDUCED ? 0 : Math.sin(t / 300 + l.p + k * .6) * (1 + k * .12);
          ctx.fillRect(l.x + wob - .5, hy + 2 + k, l.r * (1 + k / len), 1);
        }
      }
      if (flash > .01) {
        for (let i = 0; i < 16; i++) {
          const y = hy + 3 + i * i * 1.5;
          if (y > H) break;
          const w = (80 - i * 4) * (.6 + Math.random() * .8);
          ctx.fillStyle = rgba(C.bolt, flash * .3 * (1 - i / 16));
          ctx.fillRect(flashX - w / 2 + (Math.random() - .5) * 12, y, w, 1.2);
        }
      }

      // lluvia fina, inclinada por el viento
      if (rain.length) {
        ctx.strokeStyle = rgba(C.mist, .13 + flash * .25); ctx.lineWidth = 1;
        ctx.beginPath();
        for (const d of rain) {
          d.y += d.v * dt; d.x -= d.v * dt * .12;
          if (d.y > H) { d.y = -d.l; d.x = Math.random() * W * 1.1; }
          ctx.moveTo(d.x, d.y); ctx.lineTo(d.x + d.l * .12, d.y - d.l);
        }
        ctx.stroke();
      }
    }

    function worldTransform() {
      const A = viewArea();
      ctx.setTransform(DPR * cam.k, 0, 0, DPR * cam.k, DPR * (A.x + A.w / 2 - cam.x * cam.k), DPR * (A.y + A.h / 2 - cam.y * cam.k));
    }

    function strokePts(pts, upto) {
      const last = Math.floor(upto);
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i <= last && i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      if (last < pts.length - 1) {
        const f = upto - last, [ax, ay] = pts[last], [bx, by] = pts[last + 1];
        ctx.lineTo(ax + (bx - ax) * f, ay + (by - ay) * f);
      }
    }

    // un canal ionizado tenue que se enciende por completo con cada descarga
    function drawBolt(e, alphaMul) {
      if (e.grow <= .001) return;
      const pts = e.path, upto = e.grow * (pts.length - 1), k = cam.k;
      const base = e.kind === 'cross' ? .14 : (activeBranch && e.b.branch !== activeBranch ? .2 : .36);
      const I = base * alphaMul + e.strike * (.75 + .25 * Math.random());
      const passes = e.kind === 'cross' ? [[3, .1], [1, .45]] : [[14, .04], [6, .12], [2.2, .42]];
      for (const [w, a] of passes) {
        strokePts(pts, upto);
        ctx.strokeStyle = rgba(C.glow, clamp(a * I * 1.6));
        ctx.lineWidth = w / k * (e.kind === 'cross' ? .6 : 1);
        ctx.stroke();
      }
      strokePts(pts, upto);
      ctx.strokeStyle = rgba(C.bolt, clamp(.5 * I + e.strike * .7));
      ctx.lineWidth = (e.strike > .05 ? 1.5 : .8) / k;
      ctx.stroke();
      if (e.strike > .05 || e.grow < 1) {
        for (const fk of e.forks) {
          if (e.grow < fk.at) continue;
          strokePts(fk.pts, clamp((e.grow - fk.at) / (1 - fk.at)) * (fk.pts.length - 1));
          ctx.strokeStyle = rgba(C.bolt, clamp(.2 + e.strike * .6) * (e.grow < 1 ? 1 : e.strike));
          ctx.lineWidth = .9 / k;
          ctx.stroke();
        }
      }
      // líder escalonado: la punta incandescente avanza antes que el canal
      if (e.grow < 1) {
        const [x, y] = pts[Math.min(Math.floor(upto), pts.length - 1)];
        const r = 18 / k;
        const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, rgba(C.bolt, .95)); gr.addColorStop(.3, rgba(C.glow, .5)); gr.addColorStop(1, rgba(C.glow, 0));
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill();
      }
    }

    // los puntos tienen tamaño casi fijo en pantalla: la jerarquía la marcan el tamaño y el anillo
    const dotSize = n => (n.type === 'hub' ? 6 : n.type === 'sub' ? 4.5 : n.big ? 4.5 : 3.4) * clamp(cam.k * 1.6, .6, 1);
    function drawNode(n) {
      if (n.pop <= .01) return;
      const k = cam.k, p = n.pop;
      const hot = n === hover || n === selected;
      const dim = hover && !hoverNear.has(n.id) ? .35 : 1;
      const r = dotSize(n) * (p < 1 ? 1 + Math.sin(p * Math.PI) * .8 : 1) * (hot ? 1.3 : 1) / k;
      ctx.globalAlpha = p * dim;
      const gr = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, r * 3.2);
      gr.addColorStop(0, rgba(C.glow, .45)); gr.addColorStop(1, rgba(C.glow, 0));
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(n.x, n.y, r * 3.2, 0, 6.283); ctx.fill();
      ctx.fillStyle = C.bolt; ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, 6.283); ctx.fill();
      if (n.type !== 'leaf' || hot) {
        ctx.strokeStyle = hot ? C.sodium : rgba(C.bolt, .45);
        ctx.lineWidth = (hot ? 1.6 : 1) / k;
        ctx.beginPath(); ctx.arc(n.x, n.y, r + (n.type === 'hub' ? 7 : 5) / k, 0, 6.283); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // el retrato es el origen: la carga se acumula en su borde en pequeños arcos
    let crackle = [], crackleAt = 0;
    function drawPhoto(t) {
      const k = cam.k, hot = selected === graph.root || hover === graph.root;
      const R = PHOTO_R;
      const g = ctx.createRadialGradient(0, 0, R, 0, 0, R * 2.2);
      g.addColorStop(0, rgba(C.glow, .22 + flash * .3)); g.addColorStop(1, rgba(C.glow, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, R * 2.2, 0, 6.283); ctx.fill();
      ctx.save();
      ctx.beginPath(); ctx.arc(0, 0, R, 0, 6.283); ctx.clip();
      ctx.fillStyle = C.ridge; ctx.fillRect(-R, -R, R * 2, R * 2);
      if (photo.complete && photo.naturalWidth) ctx.drawImage(photo, -R, -R, R * 2, R * 2);
      ctx.restore();
      ctx.strokeStyle = hot ? C.sodium : rgba(C.bolt, .85); ctx.lineWidth = (hot ? 2 : 1.4) / k;
      ctx.beginPath(); ctx.arc(0, 0, R, 0, 6.283); ctx.stroke();
      if (REDUCED) return;
      if (t > crackleAt) {
        crackle = Array.from({ length: 2 + Math.floor(Math.random() * 2) }, () => {
          const a = Math.random() * 6.283, b = a + .25 + Math.random() * .4, r2 = R + 3 + Math.random() * 8;
          return boltPath(Math.cos(a) * (R + 1), Math.sin(a) * (R + 1), Math.cos(b) * r2, Math.sin(b) * r2, .3, 4);
        });
        crackleAt = t + 70 + Math.random() * 160;
      }
      ctx.globalCompositeOperation = 'lighter';
      for (const c of crackle) {
        strokePts(c, c.length - 1);
        ctx.strokeStyle = rgba(C.bolt, .35 + Math.random() * .3); ctx.lineWidth = .9 / k; ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    function drawLabels() {
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      const m = stacked();
      const face = getComputedStyle(document.documentElement).getPropertyValue('--font-body').trim();
      // las etiquetas se colocan por prioridad; si una choca con otra se desplaza una línea o se omite
      const placed = [];
      const rank = n => (n === hover || n === selected ? 0 : n.type === 'hub' ? 1 : n.type === 'sub' ? 2 : 3);
      const order = graph.nodes.filter(n => n.type !== 'root').sort((a, b) => rank(a) - rank(b));
      for (const n of order) {
        if (n.pop < .5 || n.type === 'root') continue;
        const near = hover && hoverNear.has(n.id);
        const focus = n.branch === activeBranch || near || n === selected;
        const show = n.type === 'hub' || focus || (n.type === 'sub' ? cam.k >= .4 : cam.k >= .62);
        if (!show) continue;
        const c = Math.cos(n.angle), s = Math.sin(n.angle);
        // rama activa: nombre bajo su punto; resto de ramas: en la punta exterior, fuera de sus hojas
        const tip = n.type === 'hub' && n.branch !== activeBranch && n.children.length;
        const [sx, sy] = tip ? toScreen(n.x + c * n.reach, n.y + s * n.reach) : toScreen(n.x, n.y);
        const rr = tip ? 14 : dotSize(n) + (n.type === 'hub' ? 16 : 10);
        let x = sx, y = sy;
        if (n.type === 'hub' && !tip) { y = sy + rr + 6; ctx.textAlign = 'center'; }
        else if (Math.abs(c) > .35) { x = sx + Math.sign(c) * rr; ctx.textAlign = c > 0 ? 'left' : 'right'; }
        else { y = sy + Math.sign(s || 1) * (rr + 4); ctx.textAlign = 'center'; }
        ctx.font = n.type === 'hub' ? `600 ${m ? 14 : 16}px ${face}`
          : n.type === 'sub' ? `500 ${m ? 12.5 : 14}px ${face}`
          : `400 ${m ? 12 : 13.5}px ${face}`;
        const w = ctx.measureText(n.label).width, lh = m ? 15 : 17;
        const left = () => ctx.textAlign === 'left' ? x : ctx.textAlign === 'right' ? x - w : x - w / 2;
        const hits = () => placed.some(r => left() < r.x + r.w && left() + w > r.x && y - lh / 2 < r.y + r.h && y + lh / 2 > r.y);
        let tries = 0;
        while (hits() && tries < 4) { y += (tries % 2 ? -1 : 1) * lh * (tries + 1); tries++; }
        if (hits() && rank(n) > 1) continue;
        placed.push({ x: left() - 3, y: y - lh / 2, w: w + 6, h: lh });
        ctx.globalAlpha = n.pop * (hover && !near ? .3 : 1);
        ctx.strokeStyle = rgba(C.sky, .85); ctx.lineWidth = 4;
        ctx.strokeText(n.label, x, y);
        ctx.fillStyle = n === hover || n === selected ? C.sodium : n.type === 'leaf' ? C.mist : C.ink;
        ctx.fillText(n.label, x, y);
      }
      ctx.globalAlpha = 1;
    }

    // ---------- bucle ----------
    let nextAmbient = 0;
    function frame(t) {
      const dt = Math.min(.05, (t - lastT) / 1000); lastT = t;
      const { target, reveal } = scrollState();
      const ease = REDUCED ? 1 : 1 - Math.pow(.0015, dt);
      cam.x = lerp(cam.x, target.x, ease); cam.y = lerp(cam.y, target.y, ease); cam.k = lerp(cam.k, target.k, ease);

      // los rayos crecen según el scroll
      graph.hubs.forEach((h, i) => {
        const r = reveal[i];
        (function walk(n) {
          const e = incoming.get(n.id);
          const want = r > e.threshold + .02 ? 1 : 0;
          if (want && !e.target) lightUp(e, 1);
          e.target = want;
          n.children.forEach(walk);
        })(h);
      });
      for (const e of tree) {
        if (REDUCED) e.grow = e.target;
        else e.grow = e.target ? Math.min(1, e.grow + dt / (e.b.type === 'hub' ? .38 : .26)) : Math.max(0, e.grow - dt / .2);
        const on = e.grow > .98 ? 1 : 0;
        e.b.pop = REDUCED ? on : on ? Math.min(1, e.b.pop + dt / .35) : Math.max(0, e.b.pop - dt / .2);
      }
      for (const e of crossE) {
        const ok = e.a.pop > .9 && e.b.pop > .9;
        const want = ok && (crossReveal > 0 || (hover && (hover === e.a || hover === e.b))) ? 1 : 0;
        if (want && !e.target) { regen(e); e.strike = .35; }
        e.target = want;
        e.grow = REDUCED ? want : want ? Math.min(1, e.grow + dt / .35) : Math.max(0, e.grow - dt / .3);
      }

      // tormenta: una descarga cada pocos segundos, con sus réplicas, que baja por la rama
      if (!REDUCED && t > nextAmbient && !document.hidden) {
        const live = tree.filter(e => e.grow > .99);
        if (live.length) { const e = live[Math.floor(Math.random() * live.length)]; strike(e); e.depth = 0; }
        nextAmbient = t + 2800 + Math.random() * 4000;
      }
      for (let i = queue.length - 1; i >= 0; i--) {
        if (queue[i].t > t) continue;
        const { e, power, restrike } = queue[i]; queue.splice(i, 1);
        lightUp(e, power);
        if (restrike) { strike(e, 60 + Math.random() * 40, power * .6, false); strike(e, 150 + Math.random() * 80, power * .4, false); }
        if (e.kind === 'tree' && power > .8) cascade(e, e.depth || 0);
      }
      for (const e of edges) {
        e.strike *= Math.pow(.015, dt);
        if (e.strike > .15 && t > e.regenAt) { regen(e); e.regenAt = t + 45 + Math.random() * 40; } // parpadeo
      }
      flash *= Math.pow(.003, dt);

      drawLandscape(t, dt);
      worldTransform();
      ctx.globalCompositeOperation = 'lighter';
      for (const e of crossE) drawBolt(e, hover && (hover === e.a || hover === e.b) ? 2.2 : crossReveal * .3);
      for (const e of tree) drawBolt(e, hover && !(e.a === hover || e.b === hover) ? .45 : 1);
      ctx.globalCompositeOperation = 'source-over';
      for (const n of graph.nodes) if (n.type !== 'root') drawNode(n);
      drawPhoto(t);
      drawLabels();
      requestAnimationFrame(frame);
    }

    // ---------- interacción ----------
    function pick(sx, sy) {
      const [wx, wy] = toWorld(sx, sy);
      let best = null, bd = Infinity;
      for (const n of graph.nodes) {
        if (n.pop < .6) continue;
        const d = Math.hypot(n.x - wx, n.y - wy) * cam.k;
        const lim = n.type === 'root' ? PHOTO_R * cam.k + 6 : 20;
        if (d < lim && d < bd) { best = n; bd = d; }
      }
      return best;
    }
    function setHover(n) {
      if (n === hover) return;
      hover = n;
      hoverNear = new Set(n ? [n.id] : []);
      canvas.style.cursor = n ? 'pointer' : '';
      story.mark(n);
      if (!n) return;
      for (const e of edges) {
        if (e.a !== n && e.b !== n) continue;
        hoverNear.add(e.a.id); hoverNear.add(e.b.id);
        if (e.grow > .99) strike(e, Math.random() * 120, .8, false);
      }
    }
    canvas.addEventListener('pointermove', e => { if (e.pointerType === 'mouse') setHover(pick(e.clientX, e.clientY)); });
    canvas.addEventListener('pointerleave', () => setHover(null));
    canvas.addEventListener('click', e => {
      const n = pick(e.clientX, e.clientY);
      if (n) { select(n); if (e.pointerType !== 'mouse') setHover(n); }
      else { selected = null; setHover(null); closePanel(); }
    });

    function select(n) {
      selected = n;
      for (const e of edges) if ((e.a === n || e.b === n) && e.grow > .99) strike(e, Math.random() * 100);
      openPanel(n);
    }
    function focusNode(n) {
      if (n.type === 'root') { story.goTo(0); select(n); return; }
      if (n.pop < .9) {
        let h = n; while (h.parent && h.parent.type !== 'root') h = h.parent;
        story.goTo(graph.hubs.indexOf(h) + 1);
        setTimeout(() => select(n), 900);
      } else select(n);
    }

    addEventListener('resize', resize);
    resize();
    requestAnimationFrame(frame);
    return { focusNode, hover: setHover, clearSelection() { selected = null; } };
  }

  // ---------- capítulos de texto sobre el cielo ----------
  const story = {
    sections: [], tops: [], hubIndex: {},
    build(graph, P) {
      const item = (n, sub) => `<li><button type="button" class="item" data-node="${esc(n.id)}"><b>${esc(n.label)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</button></li>`;
      const inline = list => `<ul class="inline">${list.map(n => item(n)).join('')}</ul>`;
      const extraCount = graph.repos.filter(r => r.extra).length;
      const body = {
        about: h => `<h2>Sobre mí</h2><p>${esc(P.bio)}</p>${inline(h.children.filter(c => c.id !== 'about:loc'))}`,
        projects: h => `<h2>Proyectos</h2><p>${plural(graph.repos.length - extraCount, 'repositorio público', 'repositorios públicos')} leídos en vivo desde GitHub${extraCount ? ', más el trabajo que no vive en un repositorio público' : ''}.</p>
          <ul class="items">${h.children.map(n => item(n, brief(n.data.repo.description))).join('')}</ul>`,
        langs: h => `<h2>Lenguajes</h2><p>Contados a partir de mis proyectos.</p>
          <ul class="items">${h.children.map(n => item(n, plural(n.data.count, 'proyecto', 'proyectos'))).join('')}</ul>`,
        skills: h => `<h2>Habilidades</h2><p>Agrupadas por área. Cada una se conecta con los proyectos donde la usé.</p>
          ${h.children.map(s => `<h3>${esc(s.label)}</h3>${inline(s.children)}`).join('')}`,
        career: h => `<h2>Experiencia</h2><p>El recorrido completo está en mi perfil de LinkedIn.</p><ul class="items">${h.children.map(n => n.data.kind === 'link'
          ? `<li><a class="item" data-node="${esc(n.id)}" href="${esc(n.data.link.url)}" target="_blank" rel="noopener"><b>${esc(n.label)}</b><span>${esc(bare(n.data.link.url))}</span></a></li>`
          : item(n, [n.data.job.org || n.data.job.school, n.data.job.period].filter(Boolean).join(', '))).join('')}</ul>`,
        social: h => `<h2>Contacto</h2><p>La forma más rápida de hablar conmigo es por correo.</p>
          <ul class="items">${h.children.map(n => `<li><a class="item" data-node="${esc(n.id)}" href="${esc(n.data.link.url)}" ${/^mailto:/.test(n.data.link.url) ? '' : 'target="_blank" rel="noopener"'}><b>${esc(n.label)}</b><span>${esc(bare(n.data.link.url))}</span></a></li>`).join('')}</ul>`,
      };
      const email = (P.links || []).find(l => /^mailto:/.test(l.url));
      const html = [`
        <section class="chapter intro" data-i="0" id="inicio"><div class="copy">
          <h1>${esc(P.name)}</h1>
          <p class="lede">Hago herramientas que resuelven cosas concretas, desde ${esc((P.location || 'Venezuela').split(',')[0])}.</p>
          <div class="actions">
            <a class="btn" href="#projects" data-jump="projects">Ver proyectos</a>
            <button class="btn quiet" type="button" data-cv>Ver CV</button>
          </div>
        </div></section>`];
      graph.hubs.forEach((h, i) => html.push(`<section class="chapter" data-i="${i + 1}" id="${h.branch}"><div class="copy">${body[h.branch](h)}</div></section>`));
      html.push(`
        <section class="chapter final" data-i="${graph.hubs.length + 1}"><div class="copy">
          <h2>Así se conecta todo</h2>
          <p>Cada proyecto está unido a su lenguaje y a las habilidades que usa. Pasa el cursor o toca un punto para ver el detalle.</p>
          <div class="actions">
            ${email ? `<a class="btn" href="${esc(email.url)}">Escribirme</a>` : ''}
            <button class="btn quiet" type="button" data-cv>Ver CV</button>
          </div>
          <p class="colophon">© ${new Date().getFullYear()} ${esc(P.name)}. Proyectos leídos en vivo desde GitHub.</p>
        </div></section>`);
      $('#story').innerHTML = html.join('');
      this.sections = [...document.querySelectorAll('.chapter')];
      this.hubIndex = Object.fromEntries(graph.hubs.map((h, i) => [h.branch, i + 1]));

      const root = $('#story');
      root.addEventListener('click', e => {
        const a = e.target.closest('[data-node]');
        if (a && a.tagName === 'BUTTON') { e.preventDefault(); scene.focusNode(GRAPH.byId.get(a.dataset.node)); }
        if (e.target.closest('[data-cv]')) setView('cv');
      });
      // pasar el ratón por el texto ilumina su punto en la red
      root.addEventListener('pointerover', e => {
        const a = e.target.closest('[data-node]');
        if (a) scene.hover(GRAPH.byId.get(a.dataset.node));
      });
      root.addEventListener('pointerout', e => {
        const a = e.target.closest('[data-node]');
        if (a && !a.contains(e.relatedTarget)) scene.hover(null);
      });
      this.measure();
    },
    mark(n) {
      document.querySelectorAll('.item.hot').forEach(x => x.classList.remove('hot'));
      if (n) document.querySelectorAll(`.item[data-node="${CSS.escape(n.id)}"]`).forEach(x => x.classList.add('hot'));
    },
    measure() { this.tops = this.sections.map(s => ({ top: s.offsetTop, h: s.offsetHeight })); },
    progress() {
      const c = scrollY + innerHeight * .5;
      let i = 0;
      while (i < this.tops.length - 1 && this.tops[i + 1].top <= c) i++;
      const s = this.tops[i] || { top: 0, h: 1 };
      return { u: i + clamp((c - s.top) / s.h), i };
    },
    goTo(i) {
      const s = this.tops[i];
      if (s) scrollTo({ top: s.top + (i === 0 ? 0 : s.h * .25), behavior: REDUCED ? 'auto' : 'smooth' });
    },
  };

  // ---------- panel de detalle ----------
  let scene, GRAPH, PROFILE, GH;
  const panel = $('#panel'), body = panel.querySelector('.panel-body');

  function openPanel(d) {
    body.innerHTML = panelHTML(d);
    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    body.querySelectorAll('button[data-node]').forEach(el => el.addEventListener('click', () => scene.focusNode(GRAPH.byId.get(el.dataset.node))));
    panel.scrollTop = 0;
  }
  function closePanel() { panel.classList.remove('open'); panel.setAttribute('aria-hidden', 'true'); scene?.clearSelection(); }
  panel.querySelector('.close').addEventListener('click', closePanel);
  addEventListener('keydown', e => { if (e.key === 'Escape') closePanel(); });

  const nodeList = list => `<ul class="items">${list.map(n => `<li><button type="button" class="item" data-node="${esc(n.id)}"><b>${esc(n.label)}</b></button></li>`).join('')}</ul>`;
  const linkBtn = (label, url, quiet) => `<a class="btn${quiet ? ' quiet' : ''}" href="${esc(url)}" ${/^mailto:/.test(url) ? '' : 'target="_blank" rel="noopener"'}>${esc(label)}</a>`;
  const facts = rows => `<dl class="facts">${rows.filter(r => r[1] !== '' && r[1] != null).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;

  function panelHTML(d) {
    const x = d.data, P = PROFILE, U = GH.user;
    const where = d.type === 'hub' ? 'Rama' : BRANCH_LABEL[d.branch];
    switch (x.kind) {
      case 'root':
        return `<img class="avatar" src="${esc(P.avatar || U.avatar_url)}" alt="">
          <h2>${esc(P.name)}</h2>
          <p>${esc(P.bio || U.bio)}</p>
          ${facts([['Usuario', P.handle], ['Ubicación', P.location], ['Proyectos', GRAPH.repos.length], ['En GitHub desde', new Date(U.created_at).getFullYear()]])}
          <div class="actions">${(P.links || []).filter(l => /^mailto:/.test(l.url)).map(l => linkBtn('Escribirme', l.url)).join('')}${linkBtn('GitHub', U.html_url || `https://github.com/${P.github}`, true)}</div>`;
      case 'hub':
      case 'group':
        return `<p class="branch">${esc(where)}</p><h2>${esc(d.label)}</h2>${nodeList(d.children)}`;
      case 'repo': {
        const r = x.repo;
        const skills = GRAPH.nodes.filter(n => n.data.kind === 'skill' && n.data.repos.includes(r.name));
        const code = r.url && /github\.com/.test(r.url);
        return `<p class="branch">Proyecto</p><h2>${esc(r.title)}</h2>
          ${r.description ? `<p>${esc(r.description)}</p>` : ''}
          ${facts([['Lenguaje', r.language || ''], ['Estrellas', r.extra ? '' : r.stars], ['Actualizado', r.pushed_at ? ago(r.pushed_at) : ''], ['Temas', r.topics.join(', ')]])}
          ${skills.length ? `<p>Habilidades que usa:</p>${nodeList(skills)}` : ''}
          <div class="actions">${r.homepage ? linkBtn(`Abrir ${r.title}`, r.homepage) : ''}${code ? linkBtn('Ver código', r.url, !!r.homepage) : ''}</div>`;
      }
      case 'lang': {
        const rs = GRAPH.nodes.filter(n => n.data.kind === 'repo' && n.data.repo.language === x.lang);
        return `<p class="branch">Lenguaje</p><h2>${esc(x.lang)}</h2><p>Lenguaje principal en ${plural(x.count, 'proyecto', 'proyectos')}:</p>${nodeList(rs)}`;
      }
      case 'skill': {
        const rs = x.repos.map(n => GRAPH.byId.get(`repo:${n}`));
        return `<p class="branch">Habilidad de ${esc(x.group.toLowerCase())}</p><h2>${esc(x.skill.name)}</h2>
          ${x.skill.note ? `<p>${esc(x.skill.note)}</p>` : ''}
          ${rs.length ? `<p>La usé en:</p>${nodeList(rs)}` : '<p>Un área que sigo explorando por mi cuenta.</p>'}`;
      }
      case 'job': {
        const j = x.job;
        return `<p class="branch">${x.edu ? 'Formación' : 'Experiencia'}</p><h2>${esc(j.role || j.title)}</h2>
          ${facts([['Dónde', j.org || j.school || ''], ['Cuándo', j.period || '']])}
          ${j.description ? `<p>${esc(j.description)}</p>` : ''}
          ${j.url ? `<div class="actions">${linkBtn('Más información', j.url)}</div>` : ''}`;
      }
      case 'link':
        return `<p class="branch">Contacto</p><h2>${esc(x.link.label)}</h2>
          <p>${esc(bare(x.link.url))}</p>
          <div class="actions">${linkBtn(/^mailto:/.test(x.link.url) ? 'Escribir correo' : `Abrir ${x.link.label}`, x.link.url)}</div>`;
      default:
        return `<p class="branch">${esc(where)}</p><h2>${esc(x.title || d.label)}</h2><p>${esc(x.text || '')}</p>`;
    }
  }

  // ---------- vista CV ----------
  function renderCV(P, G, graph) {
    const U = G.user;
    const links = (P.links || []).filter(l => l.url);
    const rows = list => `<ul class="items">${list.map(j => `<li><div class="item"><b>${esc(j.role || j.title)}</b><span>${esc([j.org || j.school, j.period].filter(Boolean).join(', '))}${j.description ? `. ${esc(j.description)}` : ''}</span></div></li>`).join('')}</ul>`;
    $('#cv').innerHTML = `<div class="cv">
      <div class="cv-head">
        <img src="${esc(P.avatar || U.avatar_url)}" alt="Foto de ${esc(P.name)}">
        <div><h1>${esc(P.name)}</h1><p>${esc(P.headline)} en ${esc(P.location || '')}</p></div>
      </div>
      <div class="actions">
        <button class="btn" type="button" onclick="print()">Imprimir o guardar PDF</button>
        ${links.map(l => linkBtn(l.label, l.url, true)).join('')}
      </div>
      <h2>Perfil</h2><p class="bio">${esc(P.bio)}</p>
      ${P.experience?.length ? `<h2>Experiencia</h2>${rows(P.experience)}` : ''}
      <h2>Proyectos</h2>
      <ul class="items">${graph.repos.map(r => {
        const href = r.homepage || r.url;
        const inner = `<b>${esc(r.title)}</b><span>${esc(r.description || r.language || '')}</span>`;
        return `<li>${href ? `<a class="item" href="${esc(href)}" target="_blank" rel="noopener">${inner}</a>` : `<div class="item">${inner}</div>`}</li>`;
      }).join('')}</ul>
      ${P.skills?.length ? `<h2>Habilidades</h2><dl class="cv-skills">${P.skills.map(g => `<dt>${esc(g.group)}</dt><dd>${esc(g.items.map(s => s.name).join(', '))}</dd>`).join('')}</dl>` : ''}
      ${P.education?.length ? `<h2>Formación</h2>${rows(P.education)}` : ''}
      <h2>Intereses</h2><p>${esc((P.interests || []).join(', '))}</p>
    </div>`;
  }

  // ---------- vistas ----------
  let netScroll = 0;
  function setView(v) {
    const cv = v === 'cv';
    if (cv === document.body.classList.contains('cv-mode')) return;
    if (cv) netScroll = scrollY;
    $('#cv-toggle').setAttribute('aria-pressed', cv);
    document.body.classList.toggle('cv-mode', cv);
    $('#cv').hidden = !cv;
    closePanel();
    history.replaceState(null, '', cv ? '#cv' : location.pathname);
    if (cv) scrollTo(0, 0);
    else { story.measure(); scrollTo(0, netScroll); }
  }
  function setupNav() {
    $('#cv-toggle').addEventListener('click', () => setView(document.body.classList.contains('cv-mode') ? 'net' : 'cv'));
    document.addEventListener('click', e => {
      const a = e.target.closest('[data-jump]');
      if (!a) return;
      e.preventDefault();
      setView('net');
      const i = story.hubIndex[a.dataset.jump];
      if (i) story.goTo(i);
    });
    $('#brand').addEventListener('click', e => { e.preventDefault(); setView('net'); story.goTo(0); });
    if (location.hash === '#cv') setView('cv');
  }

  // ---------- arranque ----------
  async function main() {
    readTokens();
    PROFILE = await getJSON('data/profile.json');
    GH = await loadGitHub(PROFILE.github);
    $('#brand').textContent = PROFILE.name;
    GRAPH = buildGraph(PROFILE, GH);
    layout(GRAPH);
    story.build(GRAPH, PROFILE);
    scene = createScene(GRAPH, PROFILE, GH);
    renderCV(PROFILE, GH, GRAPH);
    setupNav();
    document.fonts?.ready.then(() => story.measure());
    $('#loader').classList.add('gone');
  }

  main().catch(err => {
    console.error(err);
    $('#loader').textContent = `No se pudo cargar el portafolio: ${err.message.replace(/\.$/, '')}. Recarga la página para intentarlo de nuevo.`;
  });
})();

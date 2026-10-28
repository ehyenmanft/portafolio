(() => {
  'use strict';

  const CACHE_KEY = 'gh-cache-v1';
  const CACHE_TTL = 60 * 60 * 1000; // 1 h: la API pública de GitHub permite 60 peticiones/hora
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const BRANCHES = {
    about:    { label: 'Sobre mí',    color: '#ff7ad9' },
    projects: { label: 'Proyectos',   color: '#7df9ff' },
    langs:    { label: 'Lenguajes',   color: '#b69cff' },
    skills:   { label: 'Habilidades', color: '#8dffb0' },
    career:   { label: 'Experiencia', color: '#ffd27a' },
    social:   { label: 'Redes',       color: '#ff8f6b' },
  };
  const GEM_R = 64;       // radio de la joya (unidades de mundo)
  const HUB_DIST = 430;   // distancia joya → rama

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
  const hexA = (hex, a) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  };

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

    const root = add({ id: 'root', type: 'root', depth: 0, branch: 'root', label: P.name, r: GEM_R, data: { kind: 'root' } });
    const hub = key => add({ id: `hub:${key}`, type: 'hub', depth: 1, branch: key, label: BRANCHES[key].label, r: 15, data: { kind: 'hub' } }, root);
    const child = (parent, n) => add({ type: 'leaf', depth: parent.depth + 1, branch: parent.branch, r: 6, ...n }, parent);

    const about = hub('about');
    if (P.location) child(about, { id: 'about:loc', label: P.location, data: { kind: 'text', title: 'Ubicación', text: P.location } });
    for (const i of P.interests || []) child(about, { id: `about:${i}`, label: i, data: { kind: 'text', title: i, text: 'Interés personal' } });

    const hidden = new Set((P.hiddenRepos || []).map(s => s.toLowerCase()));
    const featured = (P.featuredRepos || []).map(s => s.toLowerCase());
    const notes = P.repoDescriptions || {};
    const repos = G.repos
      .map(r => r.description || !notes[r.name] ? r : { ...r, description: notes[r.name] })
      .filter(r => !r.fork && !r.archived && !hidden.has(r.name.toLowerCase()))
      .sort((a, b) => {
        const fa = featured.indexOf(a.name.toLowerCase()), fb = featured.indexOf(b.name.toLowerCase());
        if ((fa < 0) !== (fb < 0)) return fa < 0 ? 1 : -1;
        if (fa >= 0) return fa - fb;
        return new Date(b.pushed_at) - new Date(a.pushed_at);
      });
    const projects = hub('projects');
    for (const r of repos) {
      const isFeat = featured.includes(r.name.toLowerCase());
      child(projects, { id: `repo:${r.name}`, label: prettyName(r.name), r: 6 + Math.min(r.stars, 6) + (isFeat ? 3 : 0), data: { kind: 'repo', repo: r, featured: isFeat } });
    }

    const langCount = new Map();
    for (const r of repos) if (r.language) langCount.set(r.language, (langCount.get(r.language) || 0) + 1);
    if (langCount.size) {
      const langs = hub('langs');
      for (const [lang, n] of [...langCount].sort((a, b) => b[1] - a[1])) {
        child(langs, { id: `lang:${lang}`, label: lang, r: 5 + n * 1.5, data: { kind: 'lang', lang, count: n } });
      }
      for (const r of repos) if (r.language) cross(`repo:${r.name}`, `lang:${r.language}`);
    }

    if (P.skills?.length) {
      const skills = hub('skills');
      for (const g of P.skills) {
        const sub = child(skills, { id: `skg:${g.group}`, type: 'sub', label: g.group, r: 10, data: { kind: 'group', group: g } });
        for (const s of g.items) {
          const live = (s.repos || []).filter(n => byId.has(`repo:${n}`));
          child(sub, { id: `sk:${g.group}:${s.name}`, label: s.name, r: 5 + live.length, data: { kind: 'skill', skill: s, group: g.group, repos: live } });
          for (const n of live) cross(`sk:${g.group}:${s.name}`, `repo:${n}`);
        }
      }
    }

    const linkedin = (P.links || []).find(l => /linkedin/i.test(l.label) && l.url);
    if (P.experience?.length || P.education?.length || linkedin) {
      const career = hub('career');
      (P.experience || []).forEach((j, i) => child(career, { id: `job:${i}`, label: j.role, r: 8, data: { kind: 'job', job: j } }));
      (P.education || []).forEach((j, i) => child(career, { id: `edu:${i}`, label: j.title, r: 7, data: { kind: 'job', job: j, edu: true } }));
      if (linkedin) child(career, { id: 'career:linkedin', label: 'Perfil de LinkedIn', r: 7, data: { kind: 'link', link: linkedin } });
    }

    const socialLinks = (P.links || []).filter(l => l.url);
    if (socialLinks.length) {
      const social = hub('social');
      for (const l of socialLinks) child(social, { id: `link:${l.label}`, label: l.label, r: 7, data: { kind: 'link', link: l } });
    }

    return { nodes, links, byId, root, repos, hubs: root.children };
  }

  // ---------- disposición: cada rama se abre en abanico desde la joya ----------
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
      const span = level === 1 ? Math.min(2.4, .36 * k) : Math.min(1.5, .42 * k);
      const rows = k > 7 ? 3 : k > 3 ? 2 : 1;
      const base = hasSubs ? 200 : level === 1 ? 165 : 115;
      kids.forEach((c, j) => {
        const ca = a + (k === 1 ? 0 : (j / (k - 1) - .5) * span);
        const d = base + (j % rows) * (level === 1 ? 62 : 48);
        c.angle = ca; c.x = p.x + Math.cos(ca) * d; c.y = p.y + Math.sin(ca) * d;
        fan(c, ca, level + 1);
      });
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
      const len = 30 + Math.random() * 60;
      forks.push({ at, pts: boltPath(x, y, x + Math.cos(a) * len, y + Math.sin(a) * len, .35, 4) });
    }
    return forks;
  }

  // ---------- escena ----------
  function createScene(graph, P, G) {
    const canvas = $('#sky'), ctx = canvas.getContext('2d');
    let W = 0, H = 0, DPR = 1;
    const cam = { x: 0, y: 0, k: 1 };
    // mismo criterio que el CSS: móvil o tableta en vertical → texto abajo, red arriba
    const stacked = () => W <= 760 || (W <= 1100 && H > W);
    let hover = null, selected = null, flash = 0, lastT = performance.now(), crossReveal = 0;
    let activeBranch = null;
    const avatar = new Image();
    let avatarAlpha = 0;
    avatar.src = P.avatar || G.user.avatar_url;

    // estrellas de fondo, en pantalla
    let stars = [];
    function resize() {
      DPR = Math.min(devicePixelRatio || 1, 2);
      W = innerWidth; H = innerHeight;
      canvas.width = W * DPR; canvas.height = H * DPR;
      stars = Array.from({ length: Math.round(W * H / 7000) }, () => ({ x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.1 + .2, p: Math.random() * 6.28, z: Math.random() }));
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
    for (const n of graph.nodes) { n.pop = n.type === 'root' ? 1 : 0; }

    function regen(e, rough) {
      e.path = boltPath(e.a.x, e.a.y, e.b.x, e.b.y, rough ?? (e.kind === 'cross' ? .1 : .2), e.kind === 'cross' ? 5 : 6);
      e.forks = e.kind === 'tree' && e.a.type !== 'sub' ? makeForks(e.path) : [];
    }
    edges.forEach(e => regen(e));

    const queue = []; // impulsos programados: { t, e }
    function strike(e, delay = 0) {
      if (REDUCED) return;
      queue.push({ t: performance.now() + delay, e });
    }
    function cascade(e, depth) {
      if (depth > 2) return;
      for (const c of e.b.children) {
        const ce = incoming.get(c.id);
        if (ce.grow > .99 && Math.random() < .5) { strike(ce, 70 + Math.random() * 90); ce.depth = depth + 1; }
      }
    }

    // ---------- cámara ----------
    function viewArea() {
      if (stacked()) return { x: 0, y: 64, w: W, h: H * .52 };
      const left = Math.min(W * .44, 40 + Math.min(440, W * .38) + 40);
      return { x: left, y: 64, w: W - left - 40, h: H - 96 };
    }
    // el margen va en píxeles de pantalla porque las etiquetas no escalan con el zoom
    function fitCam(points) {
      const A = viewArea();
      const padX = stacked() ? 96 : 120, padY = 36;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const p of points) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
      const k = clamp(Math.min((A.w - padX * 2) / (x1 - x0 || 1), (A.h - padY * 2) / (y1 - y0 || 1)), .16, 1.6);
      return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, k, A };
    }
    function camFor(i) {
      const n = graph.hubs.length;
      if (i <= 0) {
        const A = viewArea();
        return { x: 0, y: 0, k: clamp(Math.min(A.w, A.h) / (GEM_R * 5.2), .8, 2.4) };
      }
      if (i > n) return fitCam(graph.nodes);
      const h = graph.hubs[i - 1], pts = [graph.root];
      (function walk(x) { pts.push(x); x.children.forEach(walk); })(h);
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

    // ---------- dibujo ----------
    function drawStars(t) {
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      for (const s of stars) {
        const px = (s.x - cam.x * .04 * s.z) % W, py = (s.y - cam.y * .04 * s.z) % H;
        ctx.globalAlpha = .2 + .4 * (REDUCED ? .5 : (Math.sin(t / 1300 + s.p) + 1) / 2);
        ctx.fillStyle = s.z > .8 ? '#ffd27a' : '#cfe6ff';
        ctx.fillRect(px < 0 ? px + W : px, py < 0 ? py + H : py, s.r, s.r);
      }
      ctx.globalAlpha = 1;
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

    function drawBolt(e, color, alphaMul) {
      if (e.grow <= .001) return;
      const pts = e.path, upto = e.grow * (pts.length - 1), k = cam.k;
      const I = (e.kind === 'cross' ? .16 : .38 + (e.b.branch === activeBranch ? .14 : 0)) * alphaMul + e.strike * (.7 + .3 * Math.random());
      const passes = e.kind === 'cross' ? [[3, .12], [1, .5]] : [[9, .05], [4, .16], [1.6, .55]];
      for (const [w, a] of passes) {
        strokePts(pts, upto);
        ctx.strokeStyle = hexA(color, clamp(a * I * 1.6));
        ctx.lineWidth = w / k * (e.kind === 'cross' ? .6 : 1);
        ctx.stroke();
      }
      strokePts(pts, upto);
      ctx.strokeStyle = `rgba(255,255,255,${clamp(.5 * I + e.strike * .6)})`;
      ctx.lineWidth = (e.strike > .05 ? 1.3 : .8) / k;
      ctx.stroke();
      if (e.strike > .05 || e.grow < 1) {
        for (const fk of e.forks) {
          if (e.grow < fk.at) continue;
          const g = clamp((e.grow - fk.at) / (1 - fk.at)) * (fk.pts.length - 1);
          strokePts(fk.pts, g);
          ctx.strokeStyle = hexA(color, clamp(.25 + e.strike * .7) * (e.grow < 1 ? 1 : e.strike));
          ctx.lineWidth = .9 / k;
          ctx.stroke();
        }
      }
      // chispa en la punta mientras el rayo avanza
      if (e.grow < 1) {
        const i = Math.floor(upto), [x, y] = pts[Math.min(i, pts.length - 1)];
        const r = 14 / k;
        const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, 'rgba(255,255,255,.95)'); gr.addColorStop(.3, hexA(color, .6)); gr.addColorStop(1, hexA(color, 0));
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill();
      }
    }

    function crystal(x, y, r, sides, rot) {
      ctx.beginPath();
      for (let i = 0; i < sides; i++) {
        const a = rot + i * 6.283 / sides;
        const rr = sides === 4 && i % 2 ? r * .72 : r;
        ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      ctx.closePath();
    }

    function drawNode(n, t) {
      if (n.pop <= .01) return;
      const color = BRANCHES[n.branch].color;
      const p = n.pop, s = p < 1 ? 1 + Math.sin(p * Math.PI) * .5 : 1;
      const isHot = n === hover || n === selected;
      const r = n.r * s * (isHot ? 1.35 : 1);
      const near = hover && (hover === n || hover.parent === n || n.parent === hover || hoverCross.has(n.id));
      const dim = hover && !near ? .35 : 1;
      ctx.globalAlpha = p * dim;
      const glowR = r * (n.type === 'hub' ? 4.2 : 3.2);
      const gr = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, glowR);
      gr.addColorStop(0, hexA(color, isHot ? .6 : .35)); gr.addColorStop(1, hexA(color, 0));
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(n.x, n.y, glowR, 0, 6.283); ctx.fill();
      const rot = n.type === 'hub' ? t / 4000 : -Math.PI / 2;
      crystal(n.x, n.y, r, n.type === 'hub' ? 6 : 4, rot);
      const fill = ctx.createLinearGradient(n.x - r, n.y - r, n.x + r, n.y + r);
      fill.addColorStop(0, '#ffffff'); fill.addColorStop(.45, color); fill.addColorStop(1, hexA(color, .5));
      ctx.fillStyle = fill; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1 / cam.k; ctx.stroke();
      if (n.type === 'hub') {
        crystal(n.x, n.y, r * 1.7, 6, -rot * 1.5);
        ctx.strokeStyle = hexA(color, .5); ctx.setLineDash([3 / cam.k, 5 / cam.k]); ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.globalAlpha = 1;
    }

    // joya: talla brillante vista desde arriba, con la foto engastada en la tabla
    function drawGem(t) {
      const R = GEM_R * (selected === graph.root || hover === graph.root ? 1.06 : 1), k = cam.k;
      const light = t / 2600;
      const pulse = REDUCED ? .5 : (Math.sin(t / 900) + 1) / 2;
      const halo = ctx.createRadialGradient(0, 0, R * .6, 0, 0, R * (2.6 + pulse * .5));
      halo.addColorStop(0, 'rgba(125,249,255,.35)'); halo.addColorStop(.5, 'rgba(182,156,255,.12)'); halo.addColorStop(1, 'rgba(125,249,255,0)');
      ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(0, 0, R * 3.2, 0, 6.283); ctx.fill();

      const P8 = (r, off) => Array.from({ length: 8 }, (_, j) => [Math.cos(j * Math.PI / 4 + off) * r, Math.sin(j * Math.PI / 4 + off) * r]);
      const T = P8(R * .5, 0), S = P8(R * .74, Math.PI / 8), O = P8(R, 0), M = P8(R * .985, Math.PI / 8);
      const facets = [];
      for (let j = 0; j < 8; j++) {
        const j1 = (j + 1) % 8, jm = (j + 7) % 8;
        facets.push([T[j], T[j1], S[j]]);                // estrella
        facets.push([T[j], S[jm], O[j], S[j]]);          // bisel
        facets.push([S[j], O[j], M[j]]);                 // corona
        facets.push([S[j], M[j], O[j1]]);
      }
      for (const f of facets) {
        const cx = f.reduce((s, p) => s + p[0], 0) / f.length, cy = f.reduce((s, p) => s + p[1], 0) / f.length;
        const a = Math.atan2(cy, cx);
        const b = .25 + .75 * Math.pow(Math.max(0, Math.cos(a - light)), 3) + .25 * Math.pow(Math.max(0, Math.cos(a * 3 + light * 2)), 8);
        const hue = 215 + 35 * Math.sin(a * 2 + light);
        ctx.beginPath(); f.forEach(([x, y], i) => ctx[i ? 'lineTo' : 'moveTo'](x, y)); ctx.closePath();
        ctx.fillStyle = `hsl(${hue} ${45 + b * 25}% ${clamp(16 + b * 72, 0, 95)}%)`;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = .8 / k; ctx.stroke();
      }
      // tabla con la foto
      ctx.save();
      ctx.beginPath(); T.forEach(([x, y], i) => ctx[i ? 'lineTo' : 'moveTo'](x, y)); ctx.closePath();
      ctx.fillStyle = '#0b1530'; ctx.fill();
      if (avatar.complete && avatar.naturalWidth) {
        ctx.clip();
        ctx.globalAlpha = avatarAlpha;
        ctx.drawImage(avatar, -R * .5, -R * .5, R, R);
        ctx.globalAlpha = 1;
      }
      const sheen = ctx.createLinearGradient(-R * .5, -R * .5, R * .5, R * .5);
      const sx = (Math.sin(light * 1.3) + 1) / 2;
      sheen.addColorStop(clamp(sx - .2), 'rgba(255,255,255,0)'); sheen.addColorStop(sx, 'rgba(255,255,255,.28)'); sheen.addColorStop(clamp(sx + .2), 'rgba(255,255,255,0)');
      ctx.fillStyle = sheen; ctx.fill();
      ctx.restore();
      ctx.beginPath(); T.forEach(([x, y], i) => ctx[i ? 'lineTo' : 'moveTo'](x, y)); ctx.closePath();
      ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 1.2 / k; ctx.stroke();
      // destellos
      if (!REDUCED) {
        for (let i = 0; i < 3; i++) {
          const ph = (t / 1700 + i / 3) % 1, a = i * 2.1 + Math.floor(t / 1700 + i / 3) * 1.3;
          const x = Math.cos(a) * R * .8, y = Math.sin(a) * R * .8, s = Math.sin(ph * Math.PI) * 9 / Math.max(k, .6);
          ctx.strokeStyle = `rgba(255,255,255,${Math.sin(ph * Math.PI)})`; ctx.lineWidth = 1.2 / k;
          ctx.beginPath(); ctx.moveTo(x - s, y); ctx.lineTo(x + s, y); ctx.moveTo(x, y - s); ctx.lineTo(x, y + s); ctx.stroke();
        }
      }
    }

    function drawLabels() {
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      for (const n of graph.nodes) {
        if (n.pop < .5 || n.type === 'root') continue;
        const isLeaf = n.type === 'leaf';
        const near = hover && (hover === n || hover.parent === n || n.parent === hover || hoverCross.has(n.id));
        const focus = n.branch === activeBranch || near || n === selected;
        const show = n.type === 'hub' || focus || (n.type === 'sub' ? cam.k >= .4 : cam.k >= .62);
        if (!show) continue;
        const [sx, sy] = toScreen(n.x, n.y);
        const rr = n.r * cam.k + (n.type === 'hub' ? 16 : 9);
        const c = Math.cos(n.angle), s = Math.sin(n.angle);
        let x = sx, y = sy;
        if (n.type === 'hub' && n.branch === activeBranch) { y = sy + rr + 8; ctx.textAlign = 'center'; }
        else if (Math.abs(c) > .35) { x = sx + Math.sign(c) * rr; ctx.textAlign = c > 0 ? 'left' : 'right'; }
        else { y = sy + Math.sign(s || 1) * (rr + 4); ctx.textAlign = 'center'; }
        const m = stacked();
        ctx.font = n.type === 'hub' ? `600 ${m ? 11 : 13}px Unbounded, sans-serif` : n.type === 'sub' ? `600 ${m ? 9.5 : 11}px Unbounded, sans-serif` : `500 ${m ? 11 : 12.5}px Manrope, sans-serif`;
        if ('letterSpacing' in ctx) ctx.letterSpacing = n.type === 'leaf' ? '0px' : '1.5px';
        const text = n.type === 'leaf' ? n.label : n.label.toUpperCase();
        ctx.globalAlpha = n.pop * (hover && !near ? .35 : 1);
        ctx.strokeStyle = 'rgba(6,6,11,.85)'; ctx.lineWidth = 4;
        ctx.strokeText(text, x, y);
        ctx.fillStyle = n.type === 'leaf' ? '#e6e3f0' : BRANCHES[n.branch].color;
        ctx.fillText(text, x, y);
      }
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
      ctx.globalAlpha = 1;
    }

    // ---------- bucle ----------
    let hoverCross = new Set(), nextAmbient = 0;
    function frame(t) {
      const dt = Math.min(.05, (t - lastT) / 1000); lastT = t;
      const { target, reveal } = scrollState();
      const ease = REDUCED ? 1 : 1 - Math.pow(.0015, dt);
      cam.x = lerp(cam.x, target.x, ease); cam.y = lerp(cam.y, target.y, ease); cam.k = lerp(cam.k, target.k, ease);
      avatarAlpha = REDUCED ? 1 : Math.min(1, avatarAlpha + dt * .8);

      // crecimiento de rayos según el scroll
      graph.hubs.forEach((h, i) => {
        const r = reveal[i];
        (function walk(n) {
          const e = incoming.get(n.id);
          const want = r > e.threshold + .02 ? 1 : 0;
          if (want && !e.target) { regen(e); e.strike = 1; if (n.type === 'hub') flash = .5; }
          e.target = want;
          n.children.forEach(walk);
        })(h);
      });
      for (const e of tree) {
        if (REDUCED) e.grow = e.target;
        else e.grow = e.target ? Math.min(1, e.grow + dt / (e.b.type === 'hub' ? .38 : .26)) : Math.max(0, e.grow - dt / .2);
        const nt = e.grow > .98 ? 1 : 0;
        e.b.pop = REDUCED ? nt : nt ? Math.min(1, e.b.pop + dt / .35) : Math.max(0, e.b.pop - dt / .2);
      }
      for (const e of crossE) {
        const ok = e.a.pop > .9 && e.b.pop > .9;
        const want = ok && (crossReveal > 0 || (hover && (hover === e.a || hover === e.b))) ? 1 : 0;
        if (want && !e.target) { regen(e); e.strike = .35; }
        e.target = want;
        e.grow = REDUCED ? want : want ? Math.min(1, e.grow + dt / .35) : Math.max(0, e.grow - dt / .3);
      }

      // impulsos: ambientales + programados
      if (!REDUCED && t > nextAmbient && !document.hidden) {
        const live = tree.filter(e => e.grow > .99);
        if (live.length) { const e = live[Math.floor(Math.random() * live.length)]; strike(e); e.depth = 0; }
        nextAmbient = t + 700 + Math.random() * 1400;
      }
      for (let i = queue.length - 1; i >= 0; i--) {
        if (queue[i].t <= t) {
          const { e } = queue[i]; queue.splice(i, 1);
          regen(e); e.strike = 1;
          if (e.kind === 'tree') cascade(e, e.depth || 0);
        }
      }
      for (const e of edges) {
        e.strike *= Math.pow(.02, dt);
        if (e.strike > .15 && t > e.regenAt) { regen(e); e.regenAt = t + 45 + Math.random() * 40; } // parpadeo
      }
      flash *= Math.pow(.01, dt);

      // render
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.clearRect(0, 0, W, H);
      drawStars(t);
      worldTransform();
      ctx.globalCompositeOperation = 'lighter';
      for (const e of crossE) drawBolt(e, BRANCHES[e.b.branch].color, hover && (hover === e.a || hover === e.b) ? 2.2 : crossReveal * .3);
      for (const e of tree) {
        const dim = hover && !(e.a === hover || e.b === hover) ? .45 : 1;
        drawBolt(e, BRANCHES[e.b.branch].color, dim);
      }
      ctx.globalCompositeOperation = 'source-over';
      for (const n of graph.nodes) if (n.type !== 'root') drawNode(n, t);
      drawGem(t);
      drawLabels();
      if (flash > .01) {
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
        ctx.fillStyle = `rgba(200,240,255,${flash * .12})`; ctx.fillRect(0, 0, W, H);
      }
      requestAnimationFrame(frame);
    }

    // ---------- interacción ----------
    function pick(sx, sy) {
      const [wx, wy] = toWorld(sx, sy);
      let best = null, bd = Infinity;
      for (const n of graph.nodes) {
        if (n.pop < .6) continue;
        const d = Math.hypot(n.x - wx, n.y - wy) * cam.k;
        const lim = n.type === 'root' ? GEM_R * cam.k + 6 : Math.max(16, n.r * cam.k + 10);
        if (d < lim && d < bd) { best = n; bd = d; }
      }
      return best;
    }
    function setHover(n) {
      if (n === hover) return;
      hover = n;
      hoverCross = new Set();
      canvas.style.cursor = n ? 'pointer' : '';
      if (!n) return;
      for (const e of edges) {
        if (e.a === n || e.b === n) {
          if (e.kind === 'cross') hoverCross.add(e.a === n ? e.b.id : e.a.id);
          if (e.grow > .99) strike(e, Math.random() * 120);
        }
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
    return { focusNode, select, clearSelection() { selected = null; } };
  }

  // ---------- capítulos (HTML sobre el canvas) ----------
  const story = {
    sections: [], tops: [],
    build(graph, P, G) {
      const hubText = {
        about: P.bio,
        projects: `${graph.repos.length} proyectos públicos, leídos en vivo desde GitHub. Cada uno se conecta con su lenguaje y con las habilidades que usa.`,
        langs: 'Los lenguajes salen de mis repositorios: cuantos más proyectos, más grande el cristal.',
        skills: 'Lo que sé hacer, agrupado por área. Cada habilidad lanza un rayo hacia los proyectos donde la apliqué.',
        career: 'Experiencia y formación.',
        social: 'Dónde encontrarme.',
      };
      const n = graph.hubs.length;
      const chip = (node, color) => `<a href="#" class="chip" style="--c:${color}" data-node="${esc(node.id)}">${esc(node.label)}</a>`;
      const leaves = h => {
        const out = [];
        (function walk(x) { x.children.forEach(c => { if (c.type === 'leaf') out.push(c); walk(c); }); })(h);
        return out;
      };
      const html = [`
        <section class="chapter intro" data-i="0"><div class="card">
          <div class="kicker"><i style="background:#7df9ff;color:#7df9ff"></i>${esc(P.handle)}</div>
          <h1>${esc(P.name)}</h1>
          <p class="headline">${esc(P.headline)}</p>
          <p>${esc(P.location || '')}</p>
          <div class="scroll-cue"><b></b>Desliza para encender la red</div>
        </div></section>`];
      graph.hubs.forEach((h, i) => {
        const c = BRANCHES[h.branch].color;
        html.push(`
        <section class="chapter" data-i="${i + 1}"><div class="card">
          <div class="kicker" style="color:${c}"><i style="background:${c};color:${c}"></i>${String(i + 1).padStart(2, '0')} / ${String(n).padStart(2, '0')}</div>
          <h2>${esc(h.label)}</h2>
          <p>${esc(hubText[h.branch] || '')}</p>
          ${h.children.some(x => x.type === 'sub')
            ? h.children.map(s => `<div class="kicker" style="margin-top:14px">${esc(s.label)}</div><div class="chips">${s.children.map(x => chip(x, c)).join('')}</div>`).join('')
            : `<div class="chips">${leaves(h).map(x => chip(x, c)).join('')}</div>`}
        </div></section>`);
      });
      const links = (P.links || []).filter(l => l.url);
      html.push(`
        <section class="chapter final" data-i="${n + 1}"><div class="card">
          <div class="kicker"><i style="background:#ffd27a;color:#ffd27a"></i>La red completa</div>
          <h2>Todo conectado</h2>
          <p>Pasa el cursor o toca cualquier cristal para ver sus conexiones y sus detalles.</p>
          <div class="actions">
            ${links.slice(0, 3).map((l, i) => `<a class="btn${i ? ' ghost' : ''}" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} ↗</a>`).join('')}
            <button class="btn ghost" type="button" data-cv>Ver CV</button>
          </div>
        </div></section>`);
      $('#story').innerHTML = html.join('');
      this.sections = [...document.querySelectorAll('.chapter')];

      $('#dots').innerHTML = this.sections.map((s, i) => {
        const c = i === 0 ? '#7df9ff' : i > n ? '#ffd27a' : BRANCHES[graph.hubs[i - 1].branch].color;
        const label = i === 0 ? 'Inicio' : i > n ? 'Red completa' : graph.hubs[i - 1].label;
        return `<a href="#" style="--c:${c}" data-go="${i}" title="${esc(label)}"><span>${esc(label)}</span></a>`;
      }).join('');
      $('#dots').addEventListener('click', e => { const a = e.target.closest('[data-go]'); if (a) { e.preventDefault(); this.goTo(+a.dataset.go); } });
      $('#story').addEventListener('click', e => {
        const a = e.target.closest('[data-node]');
        if (a) { e.preventDefault(); scene.focusNode(GRAPH.byId.get(a.dataset.node)); }
        if (e.target.closest('[data-cv]')) setView('cv');
      });
      this.measure();
    },
    measure() {
      this.tops = this.sections.map(s => ({ top: s.offsetTop, h: s.offsetHeight }));
    },
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
    tick() {
      const { i } = this.progress();
      this.sections.forEach((s, j) => s.classList.toggle('in', j === i));
      document.querySelectorAll('#dots a').forEach((a, j) => a.classList.toggle('on', j === i));
    },
  };

  // ---------- panel de detalle ----------
  let scene, GRAPH, PROFILE, GH;
  const panel = $('#panel'), body = panel.querySelector('.panel-body');

  function openPanel(d) {
    body.innerHTML = panelHTML(d);
    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    body.querySelectorAll('[data-node]').forEach(el => el.addEventListener('click', e => {
      e.preventDefault();
      scene.focusNode(GRAPH.byId.get(el.dataset.node));
    }));
    panel.scrollTop = 0;
  }
  function closePanel() { panel.classList.remove('open'); panel.setAttribute('aria-hidden', 'true'); scene?.clearSelection(); }
  panel.querySelector('.close').addEventListener('click', closePanel);
  addEventListener('keydown', e => { if (e.key === 'Escape') closePanel(); });

  const colorOf = d => d.type === 'root' ? '#7df9ff' : BRANCHES[d.branch].color;
  const kicker = d => {
    const c = colorOf(d);
    const txt = d.type === 'root' ? 'Perfil' : d.type === 'hub' ? 'Rama' : BRANCHES[d.branch].label;
    return `<div class="kicker" style="color:${c}"><i style="background:${c};color:${c}"></i>${esc(txt)}</div>`;
  };
  const nodeChips = (list, c) => `<div class="chips">${list.map(n => `<a href="#" class="chip" style="--c:${c || colorOf(n)}" data-node="${esc(n.id)}">${esc(n.label)}</a>`).join('')}</div>`;
  const linkBtn = (l, ghost) => `<a class="btn${ghost ? ' ghost' : ''}" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} ↗</a>`;

  function panelHTML(d) {
    const x = d.data, P = PROFILE, U = GH.user;
    switch (x.kind) {
      case 'root': {
        const stars = GRAPH.repos.reduce((s, r) => s + r.stars, 0);
        return `${kicker(d)}
          <img class="avatar" src="${esc(P.avatar || U.avatar_url)}" alt="">
          <h2>${esc(P.name)}</h2>
          <div class="meta"><span>${esc(P.handle)}</span><span>${esc(P.location || U.location || '')}</span></div>
          <p class="headline">${esc(P.headline)}</p>
          <p>${esc(P.bio || U.bio)}</p>
          <div class="stats">
            <div><b>${GRAPH.repos.length}</b><span>proyectos</span></div>
            <div><b>${stars}</b><span>estrellas</span></div>
            <div><b>${new Date(U.created_at).getFullYear()}</b><span>en GitHub desde</span></div>
          </div>
          <div class="actions">${(P.links || []).filter(l => l.url).map((l, i) => linkBtn(l, i > 0)).join('')}</div>`;
      }
      case 'hub':
      case 'group':
        return `${kicker(d)}<h2>${esc(d.label)}</h2>
          <p>${d.children.length} ${d.children.length === 1 ? 'conexión' : 'conexiones'} en esta rama.</p>
          ${nodeChips(d.children)}`;
      case 'repo': {
        const r = x.repo;
        const skills = GRAPH.nodes.filter(n => n.data.kind === 'skill' && n.data.repos.includes(r.name));
        return `${kicker(d)}<h2>${esc(prettyName(r.name))}</h2>
          <div class="meta">${r.language ? `<span>${esc(r.language)}</span>` : ''}<span class="star">★ ${r.stars}</span><span>actualizado ${esc(ago(r.pushed_at))}</span></div>
          <p>${esc(r.description || 'Sin descripción todavía.')}</p>
          ${r.topics.length ? `<div class="chips">${r.topics.map(t => `<span class="chip static">#${esc(t)}</span>`).join('')}</div>` : ''}
          ${skills.length ? `<div class="kicker" style="margin-top:18px">Habilidades conectadas</div>${nodeChips(skills)}` : ''}
          <div class="actions">
            ${r.homepage ? linkBtn({ label: 'Ver demo', url: r.homepage }) : ''}
            ${linkBtn({ label: 'Código', url: r.url }, !!r.homepage)}
          </div>`;
      }
      case 'lang': {
        const rs = GRAPH.nodes.filter(n => n.data.kind === 'repo' && n.data.repo.language === x.lang);
        return `${kicker(d)}<h2>${esc(x.lang)}</h2><p>Lenguaje principal en ${x.count} ${x.count === 1 ? 'proyecto' : 'proyectos'}.</p>${nodeChips(rs)}`;
      }
      case 'skill': {
        const rs = x.repos.map(n => GRAPH.byId.get(`repo:${n}`));
        return `${kicker(d)}<h2>${esc(x.skill.name)}</h2>
          <div class="meta"><span>${esc(x.group)}</span></div>
          ${x.skill.note ? `<p>${esc(x.skill.note)}</p>` : ''}
          ${rs.length ? `<p>Aplicada en:</p>${nodeChips(rs)}` : '<p>Área de interés y aprendizaje continuo.</p>'}`;
      }
      case 'job': {
        const j = x.job;
        return `${kicker(d)}<h2>${esc(j.role || j.title)}</h2>
          <div class="meta"><span>${esc(j.org || j.school || '')}</span><span>${esc(j.period || '')}</span></div>
          ${j.description ? `<p>${esc(j.description)}</p>` : ''}
          ${j.url ? `<div class="actions">${linkBtn({ label: 'Más info', url: j.url })}</div>` : ''}`;
      }
      case 'link':
        return `${kicker(d)}<h2>${esc(x.link.label)}</h2>
          <p>${esc(x.link.url.replace(/^mailto:|^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</p>
          <div class="actions">${linkBtn({ label: 'Abrir', url: x.link.url })}</div>`;
      default:
        return `${kicker(d)}<h2>${esc(x.title || d.label)}</h2><p>${esc(x.text || '')}</p>`;
    }
  }

  // ---------- vista CV ----------
  function renderCV(P, G, graph) {
    const U = G.user;
    const projectCards = graph.repos.map(r => `
      <article class="pcard">
        <h3><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(prettyName(r.name))}</a></h3>
        <p>${esc(r.description || 'Sin descripción todavía.')}</p>
        <div class="meta">${r.language ? `<span>${esc(r.language)}</span>` : ''}<span class="star">★ ${r.stars}</span>${r.homepage ? `<a href="${esc(r.homepage)}" target="_blank" rel="noopener">demo ↗</a>` : ''}</div>
      </article>`).join('');
    const timeline = list => `<div class="timeline">${list.map(j => `
      <div><h3>${esc(j.role || j.title)}</h3>
      <div class="meta"><span>${esc(j.org || j.school || '')}</span><span>${esc(j.period || '')}</span></div>
      ${j.description ? `<p>${esc(j.description)}</p>` : ''}</div>`).join('')}</div>`;
    const links = (P.links || []).filter(l => l.url);

    $('#cv').innerHTML = `<div class="cv">
      <div class="cv-head">
        <img src="${esc(P.avatar || U.avatar_url)}" alt="Foto de ${esc(P.name)}">
        <div>
          <h1>${esc(P.name)}</h1>
          <p class="headline">${esc(P.headline)}</p>
          <div class="meta"><span>${esc(P.handle)}</span><span>${esc(P.location || '')}</span></div>
        </div>
      </div>
      <div class="cv-actions">
        ${links.map((l, i) => linkBtn(l, i > 0)).join('')}
        <button class="btn ghost" type="button" onclick="print()">Imprimir / PDF</button>
      </div>
      <h2>Perfil</h2><p class="bio">${esc(P.bio)}</p>
      ${P.experience?.length ? `<h2>Experiencia</h2>${timeline(P.experience)}` : ''}
      <h2>Proyectos</h2><div class="cv-grid">${projectCards}</div>
      ${P.skills?.length ? `<h2>Habilidades</h2>${P.skills.map(g => `
        <div class="skill-row"><b>${esc(g.group)}</b><div class="chips">${g.items.map(s => `<span class="chip static">${esc(s.name)}</span>`).join('')}</div></div>`).join('')}` : ''}
      ${P.education?.length ? `<h2>Formación</h2>${timeline(P.education)}` : ''}
      <h2>Intereses</h2><div class="chips">${(P.interests || []).map(i => `<span class="chip static">${esc(i)}</span>`).join('')}</div>
    </div>`;
  }

  // ---------- vistas ----------
  let netScroll = 0;
  function setView(v) {
    const cv = v === 'cv';
    if (cv === document.body.classList.contains('cv-mode')) return;
    if (cv) netScroll = scrollY;
    document.querySelectorAll('.views button').forEach(x => { const on = x.dataset.view === v; x.classList.toggle('active', on); x.setAttribute('aria-pressed', on); });
    document.body.classList.toggle('cv-mode', cv);
    $('#cv').hidden = !cv;
    closePanel();
    history.replaceState(null, '', cv ? '#cv' : location.pathname);
    if (cv) scrollTo(0, 0);
    else { story.measure(); scrollTo(0, netScroll); }
  }
  function setupViews() {
    document.querySelectorAll('.views button').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
    if (location.hash === '#cv') setView('cv');
    $('#brand').addEventListener('click', e => {
      e.preventDefault();
      setView('net');
      story.goTo(0);
    });
  }

  // ---------- arranque ----------
  async function main() {
    PROFILE = await getJSON('data/profile.json');
    GH = await loadGitHub(PROFILE.github);
    $('#brand-name').textContent = PROFILE.name;
    $('#brand-handle').textContent = PROFILE.handle;
    GRAPH = buildGraph(PROFILE, GH);
    layout(GRAPH);
    story.build(GRAPH, PROFILE, GH);
    scene = createScene(GRAPH, PROFILE, GH);
    renderCV(PROFILE, GH, GRAPH);
    setupViews();
    const onScroll = () => story.tick();
    addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    document.fonts?.ready.then(() => story.measure());
    $('#loader').classList.add('gone');
  }

  main().catch(err => {
    console.error(err);
    $('#loader').innerHTML = `No se pudo cargar el portafolio.<br><small>${esc(err.message)}</small>`;
  });
})();

(() => {
  'use strict';

  const CACHE_KEY = 'gh-cache-v1';
  const CACHE_TTL = 60 * 60 * 1000; // 1 h: la API pública de GitHub permite 60 peticiones/hora
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const BRANCHES = {
    about:    { label: 'Sobre mí',    color: '#f472b6' },
    projects: { label: 'Proyectos',   color: '#38bdf8' },
    langs:    { label: 'Lenguajes',   color: '#a78bfa' },
    skills:   { label: 'Habilidades', color: '#34d399' },
    career:   { label: 'Experiencia', color: '#fbbf24' },
    social:   { label: 'Redes',       color: '#fb7185' },
  };
  const RING = [0, 170, 300, 420];        // radio objetivo por profundidad
  const SIZE = { root: 44, hub: 17, sub: 11 };

  // ---------- utilidades ----------
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
      if (parent) { parent.children.push(n); n.parent = parent; links.push({ source: parent.id, target: n.id, kind: 'tree' }); }
      return n;
    };
    const cross = (a, b) => { if (byId.has(a) && byId.has(b)) links.push({ source: a, target: b, kind: 'cross' }); };

    const root = add({ id: 'root', type: 'root', depth: 0, branch: 'root', label: P.name, r: SIZE.root, data: { kind: 'root' } });
    const hub = key => add({ id: `hub:${key}`, type: 'hub', depth: 1, branch: key, label: BRANCHES[key].label, r: SIZE.hub, data: { kind: 'hub' } }, root);
    const child = (parent, n) => add({ type: 'leaf', depth: parent.depth + 1, branch: parent.branch, r: 7, ...n }, parent);

    // Sobre mí
    const about = hub('about');
    if (P.location) child(about, { id: 'about:loc', label: P.location, data: { kind: 'text', title: 'Ubicación', text: P.location } });
    for (const i of P.interests || []) child(about, { id: `about:${i}`, label: i, data: { kind: 'text', title: i, text: 'Interés personal' } });

    // Proyectos (GitHub, en vivo)
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
      child(projects, {
        id: `repo:${r.name}`, label: prettyName(r.name), r: 7 + Math.min(r.stars, 8) + (isFeat ? 3 : 0),
        data: { kind: 'repo', repo: r, featured: isFeat },
      });
    }

    // Lenguajes (contados desde los repos)
    const langCount = d3.rollup(repos.filter(r => r.language), v => v.length, r => r.language);
    if (langCount.size) {
      const langs = hub('langs');
      for (const [lang, n] of [...langCount].sort((a, b) => b[1] - a[1])) {
        child(langs, { id: `lang:${lang}`, label: lang, r: 6 + n * 1.6, data: { kind: 'lang', lang, count: n } });
      }
      for (const r of repos) if (r.language) cross(`repo:${r.name}`, `lang:${r.language}`);
    }

    // Habilidades (profile.json), con sinapsis hacia los proyectos donde se usan
    if (P.skills?.length) {
      const skills = hub('skills');
      for (const g of P.skills) {
        const sub = child(skills, { id: `skg:${g.group}`, type: 'sub', label: g.group, r: SIZE.sub, data: { kind: 'group', group: g } });
        for (const s of g.items) {
          const live = (s.repos || []).filter(n => byId.has(`repo:${n}`));
          child(sub, { id: `sk:${g.group}:${s.name}`, label: s.name, r: 5 + live.length * 1.4, data: { kind: 'skill', skill: s, group: g.group, repos: live } });
          for (const n of live) cross(`sk:${g.group}:${s.name}`, `repo:${n}`);
        }
      }
    }

    // Experiencia y formación (profile.json / LinkedIn)
    const linkedin = (P.links || []).find(l => /linkedin/i.test(l.label) && l.url);
    if (P.experience?.length || P.education?.length || linkedin) {
      const career = hub('career');
      (P.experience || []).forEach((j, i) => child(career, { id: `job:${i}`, label: j.role, r: 9, data: { kind: 'job', job: j } }));
      (P.education || []).forEach((j, i) => child(career, { id: `edu:${i}`, label: j.title, r: 8, data: { kind: 'job', job: j, edu: true } }));
      if (linkedin) child(career, { id: 'career:linkedin', label: 'Perfil de LinkedIn', r: 8, data: { kind: 'link', link: linkedin } });
    }

    // Redes
    const links_ = (P.links || []).filter(l => l.url);
    if (links_.length) {
      const social = hub('social');
      for (const l of links_) child(social, { id: `link:${l.label}`, label: l.label, r: 8, data: { kind: 'link', link: l } });
    }

    return { nodes, links, byId, root, repos };
  }

  // ---------- render de la red ----------
  function renderGraph(graph, P, G) {
    const svg = d3.select('#graph');
    const defs = svg.append('defs');
    const glow = defs.append('filter').attr('id', 'glow').attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%');
    glow.append('feGaussianBlur').attr('stdDeviation', 3).attr('result', 'b');
    const merge = glow.append('feMerge');
    merge.append('feMergeNode').attr('in', 'b');
    merge.append('feMergeNode').attr('in', 'SourceGraphic');
    defs.append('clipPath').attr('id', 'avatar-clip').append('circle').attr('r', SIZE.root - 3);

    const world = svg.append('g');
    const gLinks = world.append('g');
    const gPulses = world.append('g').attr('filter', 'url(#glow)');
    const gNodes = world.append('g');

    const zoom = d3.zoom().scaleExtent([0.25, 4]).on('zoom', e => world.attr('transform', e.transform));
    svg.call(zoom).on('dblclick.zoom', null);

    const color = d => d.type === 'root' ? '#f472b6' : BRANCHES[d.branch].color;
    const hubKeys = graph.root.children.map(h => h.branch);
    const angleOf = {};
    hubKeys.forEach((k, i) => { angleOf[k] = -Math.PI / 2 + (i / hubKeys.length) * Math.PI * 2; });
    // cada nodo hereda un ángulo; los subgrupos se abren en abanico dentro de su rama
    const spread = Math.min(.5, 2.2 / hubKeys.length);
    const setAngle = (n, a) => {
      n.angle = a;
      const subs = n.children.filter(c => c.type === 'sub');
      n.children.forEach(c => setAngle(c, c.type === 'sub' ? a + (subs.indexOf(c) - (subs.length - 1) / 2) * spread : a));
    };
    graph.root.children.forEach(h => setAngle(h, angleOf[h.branch]));

    // posición inicial cerca de su sector para que la red "brote" ordenada
    for (const n of graph.nodes) {
      if (n.type === 'root') { n.fx = 0; n.fy = 0; continue; }
      const a = n.angle + (Math.random() - .5) * .9;
      const rad = RING[n.depth] * (REDUCED ? 1 : .15);
      n.x = Math.cos(a) * rad; n.y = Math.sin(a) * rad;
    }

    // fuerza propia: cada rama tira hacia su sector y su anillo
    function sectorForce(alpha) {
      for (const n of sim.nodes()) {
        if (n.type === 'root') continue;
        const a = n.angle, rad = RING[Math.min(n.depth, 3)];
        const k = (n.type === 'hub' ? .12 : n.type === 'sub' ? .05 : .02) * alpha;
        n.vx += (Math.cos(a) * rad - n.x) * k;
        n.vy += (Math.sin(a) * rad - n.y) * k;
      }
    }

    const sim = d3.forceSimulation()
      .force('link', d3.forceLink().id(d => d.id)
        .distance(l => l.kind === 'cross' ? 160 : l.target.type === 'hub' ? 140 : l.target.type === 'sub' ? 90 : 70)
        .strength(l => l.kind === 'cross' ? .008 : .7))
      .force('charge', d3.forceManyBody().strength(d => d.type === 'root' ? -900 : d.type === 'hub' ? -420 : -190))
      .force('collide', d3.forceCollide(d => d.type === 'leaf' ? Math.max(d.r + 12, d.label.length * 3.1) : d.r + 24).iterations(3))
      .force('radial', d3.forceRadial(d => RING[Math.min(d.depth, 3)], 0, 0).strength(d => d.type === 'leaf' ? .06 : .03))
      .force('sector', sectorForce)
      .alphaDecay(.025);

    let linkSel = gLinks.selectAll('path'), nodeSel = gNodes.selectAll('g.node');
    let visLinks = [], adjacency = new Map(), selectedId = null;

    function visibleSet() {
      const out = new Set();
      const walk = n => { out.add(n.id); if (!n.collapsed) n.children.forEach(walk); };
      walk(graph.root);
      return out;
    }

    function curve(l) {
      const s = l.source, t = l.target;
      const mx = (s.x + t.x) / 2, my = (s.y + t.y) / 2, dx = t.x - s.x, dy = t.y - s.y;
      const bend = l.kind === 'cross' ? .25 : .12;
      return { sx: s.x, sy: s.y, cx: mx - dy * bend, cy: my + dx * bend, tx: t.x, ty: t.y };
    }
    const pathD = l => { const c = curve(l); return `M${c.sx},${c.sy}Q${c.cx},${c.cy} ${c.tx},${c.ty}`; };

    function update() {
      const vis = visibleSet();
      const vNodes = graph.nodes.filter(n => vis.has(n.id));
      visLinks = graph.links.filter(l => vis.has(l.source.id ?? l.source) && vis.has(l.target.id ?? l.target));

      sim.nodes(vNodes);
      sim.force('link').links(visLinks);

      adjacency = new Map(vNodes.map(n => [n.id, new Set([n.id])]));
      for (const l of visLinks) { adjacency.get(l.source.id).add(l.target.id); adjacency.get(l.target.id).add(l.source.id); }

      linkSel = gLinks.selectAll('path').data(visLinks, l => `${l.source.id}>${l.target.id}`).join('path')
        .attr('class', l => `link ${l.kind}`)
        .attr('stroke', l => color(l.kind === 'cross' ? l.source : l.target))
        .attr('stroke-opacity', l => l.kind === 'cross' ? 1 : .45);

      nodeSel = gNodes.selectAll('g.node').data(vNodes, d => d.id).join(enter => {
        const g = enter.append('g')
          .attr('class', d => `node ${d.type}`)
          .attr('tabindex', 0).attr('role', 'button')
          .attr('aria-label', d => d.label);
        g.append('circle').attr('class', 'halo').attr('r', d => d.r + (d.type === 'root' ? 16 : 8)).attr('fill', color);
        g.filter(d => d.type !== 'root').append('circle').attr('class', 'core').attr('r', d => d.r).attr('fill', color);
        const rt = g.filter(d => d.type === 'root');
        rt.append('circle').attr('class', 'ring spin').attr('r', SIZE.root + 9).attr('stroke', '#38bdf8');
        rt.append('circle').attr('class', 'ring').attr('r', SIZE.root).attr('stroke', '#f472b6').attr('fill', '#0b0e1f');
        rt.append('image').attr('href', P.avatar || G.user.avatar_url)
          .attr('x', -(SIZE.root - 3)).attr('y', -(SIZE.root - 3)).attr('width', (SIZE.root - 3) * 2).attr('height', (SIZE.root - 3) * 2)
          .attr('clip-path', 'url(#avatar-clip)').attr('preserveAspectRatio', 'xMidYMid slice');
        g.append('text').attr('dy', d => d.r + (d.type === 'root' ? 30 : d.type === 'leaf' ? 14 : 20)).text(d => d.label);
        g.on('click', (e, d) => { e.stopPropagation(); select(d); })
          .on('keydown', (e, d) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(d); } })
          .on('mouseenter focus', (e, d) => highlight(d))
          .on('mouseleave blur', () => highlight(selectedId ? graph.byId.get(selectedId) : null))
          .call(drag);
        return g;
      });
      nodeSel.classed('collapsed', d => !!d.collapsed).classed('selected', d => d.id === selectedId);

      sim.alpha(.6).restart();
    }

    const drag = d3.drag()
      .filter(e => !e.button && !e.ctrlKey)
      .on('start', (e, d) => { if (d.type === 'root') return; if (!e.active) sim.alphaTarget(.25).restart(); d.fx = d.x; d.fy = d.y; })
      .on('drag', (e, d) => { if (d.type === 'root') return; d.fx = e.x; d.fy = e.y; })
      .on('end', (e, d) => { if (d.type === 'root') return; if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; });

    sim.on('tick', () => {
      linkSel.attr('d', pathD);
      nodeSel.attr('transform', d => `translate(${d.x},${d.y})`);
    });

    function highlight(d) {
      if (!d) { nodeSel.classed('dim', false); linkSel.classed('dim', false); return; }
      const near = adjacency.get(d.id) || new Set([d.id]);
      nodeSel.classed('dim', n => !near.has(n.id));
      linkSel.classed('dim', l => l.source.id !== d.id && l.target.id !== d.id);
      for (const l of visLinks) if (l.source.id === d.id || l.target.id === d.id) firePulse(l, l.target.id === d.id);
    }

    function select(d) {
      selectedId = d.id;
      nodeSel.classed('selected', n => n.id === selectedId);
      highlight(d);
      openPanel(d);
    }

    function focusNode(d) {
      let opened = false;
      for (let p = d.parent; p; p = p.parent) if (p.collapsed) { p.collapsed = false; opened = true; }
      if (opened) update();
      setTimeout(() => {
        // centra el nodo en la zona que el panel deja libre
        const W = svg.node().clientWidth, H = svg.node().clientHeight;
        const p = W < 640 ? [W / 2, H * .3] : [(W - 400) / 2, H / 2];
        svg.transition().duration(REDUCED ? 0 : 650).call(zoom.translateTo, d.x, d.y, p);
        select(d);
      }, opened ? 450 : 0);
    }

    function toggleBranch(d) {
      d.collapsed = !d.collapsed;
      update();
      openPanel(d);
    }

    function fit(duration = 750) {
      const ns = sim.nodes();
      if (!ns.length) return;
      const [x0, x1] = d3.extent(ns, n => n.x), [y0, y1] = d3.extent(ns, n => n.y);
      const W = svg.node().clientWidth, H = svg.node().clientHeight;
      const pad = W < 640 ? 40 : 90;
      const k = Math.min(1.4, Math.min((W - pad) / (x1 - x0 + 120), (H - pad - 60) / (y1 - y0 + 120)));
      const t = d3.zoomIdentity.translate(W / 2, H / 2 + 10).scale(k).translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
      svg.transition().duration(REDUCED ? 0 : duration).call(zoom.transform, t);
    }

    // ---------- impulsos sinápticos ----------
    const pulses = [];
    function firePulse(l, reverse = false, hops = 0) {
      if (REDUCED || pulses.length > 70) return;
      pulses.push({ l, t: 0, v: .012 + Math.random() * .012, reverse, hops });
    }
    function propagate(fromId, hops) {
      if (hops > 2) return;
      for (const l of visLinks) {
        if (l.kind === 'tree' && l.source.id === fromId && Math.random() < .55) firePulse(l, false, hops + 1);
      }
    }
    function pulseLoop() {
      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i];
        p.t += p.v;
        if (p.t >= 1) {
          pulses.splice(i, 1);
          if (!p.reverse) propagate(p.l.target.id, p.hops);
        }
      }
      gPulses.selectAll('circle').data(pulses).join('circle')
        .attr('class', 'pulse')
        .attr('r', p => p.l.kind === 'cross' ? 1.8 : 2.6)
        .attr('fill', p => color(p.l.target))
        .attr('cx', p => { const c = curve(p.l), t = p.reverse ? 1 - p.t : p.t; return (1 - t) ** 2 * c.sx + 2 * (1 - t) * t * c.cx + t * t * c.tx; })
        .attr('cy', p => { const c = curve(p.l), t = p.reverse ? 1 - p.t : p.t; return (1 - t) ** 2 * c.sy + 2 * (1 - t) * t * c.cy + t * t * c.ty; });
      requestAnimationFrame(pulseLoop);
    }
    if (!REDUCED) {
      requestAnimationFrame(pulseLoop);
      // latido: desde el centro sale una señal cada poco tiempo
      setInterval(() => {
        if (document.hidden) return;
        const out = visLinks.filter(l => l.source.id === 'root');
        if (out.length) firePulse(out[Math.floor(Math.random() * out.length)]);
        const cr = visLinks.filter(l => l.kind === 'cross');
        if (cr.length && Math.random() < .5) firePulse(cr[Math.floor(Math.random() * cr.length)], Math.random() < .5);
      }, 520);
    }

    svg.on('click', () => { selectedId = null; nodeSel.classed('selected', false); highlight(null); closePanel(); });
    addEventListener('resize', () => fit(0));

    update();
    setTimeout(() => fit(), REDUCED ? 50 : 1300);

    return { focusNode, toggleBranch, fit, select };
  }

  // ---------- panel de detalle ----------
  let api, GRAPH, PROFILE, GH;
  const panel = $('#panel'), body = panel.querySelector('.panel-body');

  function openPanel(d) {
    body.innerHTML = panelHTML(d);
    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    body.querySelectorAll('[data-node]').forEach(el => el.addEventListener('click', e => {
      e.preventDefault();
      api.focusNode(GRAPH.byId.get(el.dataset.node));
    }));
    body.querySelector('[data-toggle]')?.addEventListener('click', () => api.toggleBranch(d));
    panel.scrollTop = 0;
  }
  function closePanel() { panel.classList.remove('open'); panel.setAttribute('aria-hidden', 'true'); }
  panel.querySelector('.close').addEventListener('click', closePanel);
  addEventListener('keydown', e => { if (e.key === 'Escape') closePanel(); });

  const kicker = d => {
    const c = d.type === 'root' ? '#f472b6' : BRANCHES[d.branch].color;
    const txt = d.type === 'root' ? 'Perfil' : d.type === 'hub' ? 'Rama' : BRANCHES[d.branch].label;
    return `<div class="kicker" style="color:${c}">${esc(txt)}</div>`;
  };
  const nodeChips = list => `<div class="chips">${list.map(n => `<a href="#" class="chip" data-node="${esc(n.id)}">${esc(n.label)}</a>`).join('')}</div>`;
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
          <p style="color:var(--accent)">${esc(P.headline)}</p>
          <p>${esc(P.bio || U.bio)}</p>
          <div class="stats">
            <div><b>${GRAPH.repos.length}</b><span>proyectos</span></div>
            <div><b>${stars}</b><span>estrellas</span></div>
            <div><b>${new Date(U.created_at).getFullYear()}</b><span>en GitHub desde</span></div>
          </div>
          <div class="actions">${(P.links || []).filter(l => l.url).map((l, i) => linkBtn(l, i > 0)).join('')}</div>`;
      }
      case 'hub':
      case 'group': {
        const kids = d.children;
        return `${kicker(d)}<h2>${esc(d.label)}</h2>
          <p>${kids.length} ${kids.length === 1 ? 'conexión' : 'conexiones'} en esta rama.</p>
          ${nodeChips(kids)}
          <div class="actions"><button class="btn ghost" data-toggle>${d.collapsed ? 'Expandir rama' : 'Contraer rama'}</button></div>`;
      }
      case 'repo': {
        const r = x.repo;
        const skills = GRAPH.nodes.filter(n => n.data.kind === 'skill' && n.data.repos.includes(r.name));
        return `${kicker(d)}<h2>${esc(prettyName(r.name))}</h2>
          <div class="meta">${r.language ? `<span>${esc(r.language)}</span>` : ''}<span class="star">★ ${r.stars}</span><span>actualizado ${esc(ago(r.pushed_at))}</span></div>
          <p>${esc(r.description || 'Sin descripción todavía.')}</p>
          ${r.topics.length ? `<div class="chips">${r.topics.map(t => `<span class="chip static">#${esc(t)}</span>`).join('')}</div>` : ''}
          ${skills.length ? `<div class="kicker" style="color:var(--muted);margin-top:16px">Habilidades conectadas</div>${nodeChips(skills)}` : ''}
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
      <article class="card">
        <h3><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(prettyName(r.name))}</a></h3>
        <p>${esc(r.description || 'Sin descripción todavía.')}</p>
        <div class="meta">${r.language ? `<span>${esc(r.language)}</span>` : ''}<span class="star">★ ${r.stars}</span>${r.homepage ? `<a href="${esc(r.homepage)}" target="_blank" rel="noopener">demo ↗</a>` : ''}</div>
      </article>`).join('');
    const timeline = list => `<div class="timeline">${list.map(j => `
      <div class="item"><h3>${esc(j.role || j.title)}</h3>
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
        <button class="btn ghost" onclick="print()">Imprimir / PDF</button>
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

  // ---------- fondo de estrellas ----------
  function stars() {
    const c = $('#stars'), ctx = c.getContext('2d');
    let pts = [];
    const resize = () => {
      c.width = innerWidth * devicePixelRatio; c.height = innerHeight * devicePixelRatio;
      pts = Array.from({ length: Math.round(innerWidth * innerHeight / 9000) }, () => ({
        x: Math.random() * c.width, y: Math.random() * c.height, r: Math.random() * 1.2 * devicePixelRatio, p: Math.random() * 6.28,
      }));
    };
    const draw = t => {
      ctx.clearRect(0, 0, c.width, c.height);
      for (const s of pts) {
        ctx.globalAlpha = .25 + .35 * (REDUCED ? .5 : (Math.sin(t / 1400 + s.p) + 1) / 2);
        ctx.fillStyle = '#9fb2ff';
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.28); ctx.fill();
      }
      if (!REDUCED) requestAnimationFrame(draw);
    };
    resize(); addEventListener('resize', resize); requestAnimationFrame(draw);
  }

  // ---------- vistas ----------
  function setupViews() {
    document.querySelectorAll('.views button').forEach(b => b.addEventListener('click', () => {
      const v = b.dataset.view;
      document.querySelectorAll('.views button').forEach(x => { x.classList.toggle('active', x === b); x.setAttribute('aria-pressed', x === b); });
      $('#net').hidden = v !== 'net';
      $('#cv').hidden = v !== 'cv';
      if (v === 'cv') closePanel();
      history.replaceState(null, '', v === 'cv' ? '#cv' : location.pathname);
    }));
    if (location.hash === '#cv') document.querySelector('[data-view=cv]').click();
    $('#brand').addEventListener('click', e => {
      e.preventDefault();
      document.querySelector('[data-view=net]').click();
      api.fit(); api.select(GRAPH.root);
    });
  }

  function legend() {
    $('#legend').innerHTML = GRAPH.root.children.map(h =>
      `<button type="button" data-node="${esc(h.id)}"><i style="background:${BRANCHES[h.branch].color}"></i>${esc(h.label)}</button>`).join('');
    $('#legend').addEventListener('click', e => {
      const b = e.target.closest('[data-node]');
      if (b) api.focusNode(GRAPH.byId.get(b.dataset.node));
    });
  }

  // ---------- arranque ----------
  async function main() {
    stars();
    PROFILE = await getJSON('data/profile.json');
    GH = await loadGitHub(PROFILE.github);
    $('#brand-name').textContent = PROFILE.name;
    $('#brand-handle').textContent = PROFILE.handle;
    GRAPH = buildGraph(PROFILE, GH);
    api = renderGraph(GRAPH, PROFILE, GH);
    renderCV(PROFILE, GH, GRAPH);
    legend();
    setupViews();
    const label = { live: 'GitHub en vivo', cache: 'GitHub', snapshot: 'copia local de GitHub' }[GH.source];
    $('#source').textContent = `datos: ${label} · ${ago(new Date(GH.t).toISOString())}`;
    $('#loader').classList.add('gone');
  }

  main().catch(err => {
    console.error(err);
    $('#loader').innerHTML = `No se pudo cargar el portafolio.<br><small>${esc(err.message)}</small>`;
  });
})();

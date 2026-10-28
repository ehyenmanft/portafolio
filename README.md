# Portafolio · James Aranda (@ehyenma.nft)

Portafolio y CV interactivo: una **joya central** (con mi foto engastada) de la que, al ir deslizando, nacen como **rayos animados** las ramas: Sobre mí, Proyectos, Lenguajes, Habilidades, Experiencia y Redes. Cada capítulo del scroll enciende una rama y la cámara viaja hasta ella; al final se ve toda la red, con las conexiones cruzadas entre proyectos, lenguajes y habilidades.

Sitio estático (HTML + CSS + JS con Canvas 2D), sin dependencias ni compilación. Es responsive: en móvil y tableta vertical la red ocupa la parte de arriba y el texto sube por debajo.

## De dónde salen los datos

| Dato | Fuente |
|---|---|
| Foto, repos, lenguajes, estrellas, fechas | API pública de GitHub, **en vivo** al abrir la página (caché de 1 h en el navegador) |
| Copia de respaldo si la API falla | `data/github.json` |
| Bio, habilidades, experiencia, formación, redes | `data/profile.json` |

LinkedIn e Instagram no ofrecen una API pública para leer perfiles desde una web estática, así que la experiencia y la formación se copian a mano en `data/profile.json`.

## Editar el contenido

Todo está en `data/profile.json`:

- `links`: pon tu URL de LinkedIn en la entrada `"LinkedIn"` (las entradas con `url` vacía no se muestran).
- `experience` / `education`: añade entradas así:

  ```json
  "experience": [
    { "role": "Desarrollador", "org": "Empresa", "period": "2024 — hoy", "description": "Qué hiciste.", "url": "https://..." }
  ],
  "education": [
    { "title": "Ingeniería en Informática", "school": "Universidad", "period": "2018 — 2023" }
  ]
  ```

- `skills`: grupos de habilidades; `repos` crea las sinapsis hacia esos proyectos.
- `featuredRepos`: proyectos que salen primero y más grandes. `hiddenRepos`: repos que no se muestran.
- `repoDescriptions`: descripción para repos que no tienen una en GitHub.
- `avatar`: deja vacío para usar la foto de GitHub, o pon la URL de otra imagen.

Los repos nuevos que subas a GitHub aparecen solos.

Al cambiar CSS o JS, sube el número `?v=` en `index.html` para que los navegadores no usen la versión en caché.

## Ver en local

```bash
python -m http.server 5590
```

y abre http://127.0.0.1:5590

## Publicar en GitHub Pages

1. Crea el repo `portafolio` en GitHub y sube estos archivos a `main`.
2. En el repo: **Settings → Pages → Source: Deploy from a branch → `main` / `(root)`**.
3. La web queda en `https://ehyenmanft.github.io/portafolio/`.

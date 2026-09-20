# 🧭 Búsqueda del Tesoro (Parque de Aiete)

Web tipo «Pokémon GO» para niños: cámara del móvil de fondo, flecha 3D que guía por GPS + brújula, y un cofre en realidad aumentada que aparece al llegar a cada punto. No hay servidor ni base de datos: **la partida viaja dentro del enlace**.

**Publicada en → https://diad87.github.io/tesoro/** (GitHub Pages; cada `git push` a `main` la actualiza en ~1 min)

## 1. Publicarla (obligatorio: https)

La cámara, el GPS y la brújula **solo funcionan con https**. Opciones gratis, sin instalar nada:

- **Netlify Drop** → abre https://app.netlify.com/drop y arrastra esta carpeta. Te da una URL `https://…netlify.app`.
- **GitHub Pages** / **Cloudflare Pages** / **Vercel**: cualquiera vale, son 3 archivos estáticos (`index.html`, `style.css`, `app.js`).

Para verla en el ordenador: `node serve.js` → http://localhost:5173 (en localhost funciona el «modo prueba», no el GPS real).

## 2. Preparar los tesoros (los mayores)

1. Abre la web publicada en tu móvil → **Preparar los tesoros**.
2. Lo más preciso: **ve andando a cada escondite** y pulsa **«Poner tesoro donde estoy»** (mide el GPS 4 s y se queda con la mejor lectura). También puedes tocar el mapa (botón 🛰️ para vista satélite) y arrastrar los marcadores.
3. En cada tesoro puedes escribir una **pista** (se ve mientras lo buscan) y un **mensaje al abrir el cofre** (ej.: «Mirad debajo del banco», donde habrás escondido las chuches).
4. Ajusta la **distancia de aparición del cofre** (12 m por defecto; entre árboles el GPS falla ~10 m, súbelo a 15–20 si hace falta).
5. **Compartir con los móviles** → QR / enlace. Ábrelo en cada móvil que vaya a jugar.

## 3. Jugar

- **¡A la aventura!** → aceptar cámara, ubicación y (en iPhone) movimiento/orientación.
- Seguir la flecha; el termómetro dice frío / templado / caliente y pita más rápido al acercarse.
- Al llegar aparece el cofre: **tocarlo** para abrirlo y ganar una joya. Luego, siguiente pista.
- El progreso se guarda en el móvil (si se cierra el navegador, continúa donde estaba).

## Consejos para el día D

- **Haz el recorrido de prueba** antes con un móvil: es la única forma de ver cómo se porta el GPS en cada rincón.
- Pon los tesoros en **claros o caminos**, no pegados a edificios ni bajo arbolado muy denso. Sepáralos **más de 30 m** entre sí.
- Si la flecha apunta raro: mover el móvil dibujando un **8** en el aire (calibra la brújula).
- Plan B: ⚙️ → **«Dar este tesoro por encontrado»** (mantener 2 s) si el GPS se pone tonto.
- iPhone: usar **Safari**. Android: **Chrome**. Brillo alto y batería cargada (cámara + GPS gastan).
- Un adulto por grupo: los niños miran la pantalla y no el suelo.

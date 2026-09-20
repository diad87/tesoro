# 🧭 Búsqueda del Tesoro

Web tipo «Pokémon GO» para niños: cámara del móvil de fondo, flecha 3D que guía por GPS + brújula, y un cofre en realidad aumentada que aparece al llegar a cada punto. Los adultos preparan las búsquedas (con cuenta, guardadas en la nube) y las comparten por enlace/QR; los niños juegan sin cuenta.

**Publicada en → https://tesoro-ar-app.web.app** (Firebase Hosting, proyecto `tesoro-ar-app`). La antigua URL de GitHub Pages redirige aquí.

## 1. Cómo está montada

- `public/` → la web (HTML/CSS/JS sin build). Es lo único que se sube a Hosting.
- **Firebase Auth** (email/contraseña y Google) para los adultos que preparan búsquedas. Los niños juegan **sin cuenta**.
- **Firestore**, colección `games`: una búsqueda por documento (`owner`, `name`, `count`, `data`). Reglas en `firestore.rules`: leer por id es público (para jugar con el enlace); listar, crear, editar y borrar, solo el dueño.
- Enlaces: `#j=<id>` (búsqueda guardada en la nube: enlace corto y se puede retocar después) o `#g=<datos>` (sin cuenta: toda la búsqueda va dentro del enlace).
- `index.html` de la raíz: solo redirige los enlaces antiguos de GitHub Pages a Firebase.

Desplegar cambios (hosting + reglas + proveedores de acceso, todo definido en `firebase.json`):

```bash
firebase deploy --project tesoro-ar-app
```

Para verla en el ordenador: `node serve.js` → http://localhost:5173 (en localhost funciona el «modo prueba», no el GPS real).

## 2. Preparar los tesoros (los mayores)

1. Abre la web en tu móvil → **Mis búsquedas** → entra con tu cuenta (o «Seguir sin cuenta») → **Nueva búsqueda**. El mapa se abre **donde estés** (GPS del móvil); el botón 🎯 vuelve a centrarlo en ti. Sirve para cualquier parque, playa o barrio.
2. Lo más preciso: **ve andando a cada escondite** y pulsa **«Poner tesoro donde estoy»** (mide el GPS 4 s y se queda con la mejor lectura). También puedes tocar el mapa (botón 🛰️ para vista satélite) y arrastrar los marcadores.
3. En cada tesoro puedes escribir una **pista** (se ve mientras lo buscan) y un **mensaje al abrir el cofre** (ej.: «Mirad debajo del banco», donde habrás escondido las chuches).
4. Ajusta la **distancia de aparición del cofre** (12 m por defecto; entre árboles el GPS falla ~10 m, súbelo a 15–20 si hace falta).
5. **Compartir con los móviles** → QR / enlace. Ábrelo en cada móvil que vaya a jugar. Con cuenta se guarda sola («Guardado en tu cuenta ✓») y luego aparece en **Mis búsquedas** para jugarla, editarla, duplicarla o borrarla.

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

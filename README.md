# Adivina la obra 🎭

Juego para preparar el examen de audición: suena una obra de la lista de YouTube
"canciones opera examen" y hay que escribir la obra y su autor.

- Web estática (HTML + CSS + JS), sin dependencias. Se publica con GitHub Pages.
- Las obras están en `songs.js`. Para añadir una: copia una línea, cambia el `id`
  del vídeo de YouTube, `obra`, `autor` y las formas alternativas válidas.
- El progreso se guarda en el navegador (localStorage).

Probar en local: `python3 -m http.server` y abrir http://localhost:8000

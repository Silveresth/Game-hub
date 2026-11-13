# Vidéo promo 9:16 (30 s)

Résultats (1080 × 1920, 30 i/s, H.264 + AAC, -14 LUFS) :
- `../steal-a-masterpiece-promo-9x16-voix-paul.mp4` : voix off masculine ;
- `../steal-a-masterpiece-promo-9x16-voix-julie.mp4` : voix off féminine ;
- `../steal-a-masterpiece-promo-9x16.mp4` : musique et bruitages seuls.

Voix off : le texte et le minutage de chaque réplique sont dans `voice.json` (`at` : début en secondes, `max` : durée parlée maximale). `voice.ps1` les fait lire par une voix française de Windows (Paul, Julie ou Hortense) et accélère une réplique trop longue pour son créneau ; `music.mjs` la mixe en baissant la musique sous la voix.

| Fichier | Rôle |
| --- | --- |
| `anim.js` | toute l'animation : `renderFrame(t)` dessine l'image à l'instant `t`. Les plans changent sur les mesures (128 BPM, 1,875 s par mesure) |
| `music.mjs` | bande-son synthétisée (musique et bruitages calés sur l'image) → `audio.wav` |
| `render.mjs` | `node render.mjs preview 1.2 5.6 13.4` : planche d'aperçu ; `node render.mjs frames` : les 900 images dans `frames/` |
| `capture.mjs` | prises de vue du jeu sans interface (`shots/`), avec le serveur de test et Vite lancés |

Pour régénérer :

```powershell
node music.mjs                                   # musique seule -> audio.wav
powershell -File voice.ps1 -Voice Paul           # répliques -> voice-paul/
node music.mjs voice-paul audio-paul.wav         # musique + voix
node render.mjs frames
ffmpeg -framerate 30 -i frames\f%04d.jpg -i audio-paul.wav -c:v libopenh264 -b:v 14M -g 60 -pix_fmt yuv420p `
  -af "loudnorm=I=-14:TP=-1.5:LRA=11" -c:a aac -b:a 192k -ar 44100 -shortest -movflags +faststart promo.mp4
```

Seul le son change ? Inutile de refaire les images : `ffmpeg -i ..\steal-a-masterpiece-promo-9x16.mp4 -i audio-paul.wav -map 0:v -map 1:a -c:v copy …` (mêmes options audio).

Textes, couleurs et minutages se changent dans `anim.js` (un plan par fonction `scene…`) ; les bruitages correspondants dans la partie « bruitages » de `music.mjs`.

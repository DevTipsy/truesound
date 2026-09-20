# TrueSound

Analyseur de **qualité audio réelle** — 100 % dans le navigateur, aucun fichier envoyé sur un serveur.

## Idée

Beaucoup de fichiers étiquetés « FLAC » ou « lossless » sont en réalité des **lossy déguisés** :
un MP3/AAC ré-encapsulé dans un conteneur sans perte. Le conteneur ment, mais le son
reste celui de la source dégradée.

TrueSound détecte ça en analysant le **spectre** du fichier : il cherche le
**mur de coupure (lowpass cutoff)**. Un vrai lossless garde de l'énergie jusqu'à
~20–22 kHz ; un encodage lossy coupe net plus bas :

| Cutoff détecté | Verdict            | Source probable        |
|----------------|--------------------|------------------------|
| ≥ 20 kHz       | 🟢 Full quality    | Lossless               |
| ~19–20 kHz     | 🟠 Bon             | MP3 320 / AAC HQ       |
| ~16 kHz        | 🟠 Moyen           | MP3 ~192               |
| ≤ 15 kHz       | 🔴 Basse qualité   | MP3 ≤128 / dégradé     |

Si un fichier `.flac`/`.wav`/`.m4a` annoncé sans perte a un spectre tronqué,
TrueSound lève une alerte **« faux lossless »**.

## Fonctionnement technique

TrueSound croise **deux sources** :

**1. Les métadonnées réelles** (`metadata.js`) — parsing des en-têtes sans
dépendance : WAV (chunk `fmt`), FLAC (STREAMINFO), MP4/M4A (atomes `mp4a`/`alac`),
MP3 (frame header + tag Xing/LAME), OGG. On en tire le **codec** et le **débit**
déclarés — la vérité sur ce que le fichier *prétend* être.

**2. Le spectre** (`analyzer.js`) — décodage PCM via **Web Audio API**, **FFT**
maison (radix-2) sur des fenêtres de Hann réparties dans le morceau, spectre
moyenné en dB. On y cherche le **mur d'encodeur** : une chute franche (≥ 28 dB
sur ~1,2 kHz) qui ne peut venir que d'un lowpass de compression lossy.

**La combinaison fait la fiabilité :**
- codec lossless (PCM/FLAC/ALAC) **+ mur** → *faux lossless démasqué*.
- codec lossless **+ pas de mur + aigus riches** → *lossless vérifié* (vert).
- codec lossless **+ pas de mur mais peu d'aigus** → *non concluant* (honnête).
- codec lossy (MP3/AAC) → verdict selon le débit lu.

### Limites connues (assumées)

- L'**AAC** de bonne qualité (Apple/iTunes) ne laisse **pas** de mur spectral
  exploitable : impossible de le distinguer d'un lossless par le seul spectre.
  → c'est justement pourquoi on lit les métadonnées.
- On ne peut jamais *prouver* le lossless au spectre, seulement l'absence de
  signe de lossy. Le verdict reste prudent sur les cas ambigus.

Aucune dépendance, aucun build : HTML + JS statique.

## Lancer en local

```bash
# n'importe quel serveur statique, p.ex.
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```

Ouvrir directement `index.html` (protocole `file://`) marche aussi dans la plupart des navigateurs.

## Limites de la v1 (pistes d'amélioration)

- Le décodage FLAC dépend du navigateur (OK sur Chrome/Edge ; Safari est plus capricieux).
  → prévoir un décodeur FLAC WASM en fallback.
- Les seuils de cutoff sont heuristiques : à affiner sur un corpus de fichiers de référence.
- Ajouter la détection de **joint-stereo** / d'artefacts de transcodage pour fiabiliser
  les cas limites (MP3 320 vs vrai lossless).
- Export d'un rapport, analyse par lot avec tableau récapitulatif.

## Licence

Privé — prototype.

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

- Décodage PCM via la **Web Audio API** (`decodeAudioData`).
- **FFT** maison (radix-2) sur des fenêtres de Hann réparties dans tout le morceau,
  spectre de magnitude moyenné puis converti en dB normalisés.
- Détection du cutoff : on descend depuis Nyquist jusqu'au premier palier
  d'énergie soutenue au-dessus du plancher de bruit.
- Verdict → barre rouge/orange/vert + mini-graphe du spectre avec la ligne de cutoff.

Aucune dépendance, aucun build : c'est du HTML + JS statique.

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

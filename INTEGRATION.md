# TrueSound — Guide d'intégration dans MyMusic

> Ce document est **auto-suffisant** : déposé dans une conversation, il donne
> tout ce qu'il faut pour intégrer l'analyse de qualité audio de TrueSound dans
> l'app MyMusic, quelle que soit sa plateforme (web, iOS/Swift, React Native…).
>
> Repo de référence : https://github.com/DevTipsy/truesound
> Démo : https://devtipsy.github.io/truesound/

---

## 1. Ce que fait TrueSound

À partir d'un fichier audio, il détermine sa **vraie qualité** — pas ce que
prétend son étiquette. Il répond à trois questions :

1. **Quel est le vrai codec / débit ?** (lu dans les métadonnées du fichier)
2. **Est-ce vraiment du sans-perte ?** (le conteneur peut mentir)
3. **Quelle qualité vais-je réellement entendre ?** (verdict pour l'utilisateur)

Cas d'usage dans MyMusic : afficher un **badge qualité** par morceau
(🟢 sans-perte vérifié, 🟠 lossy correct, 🔴 dégradé / faux lossless), ou un
écran d'analyse de bibliothèque.

---

## 2. Le principe technique (le cœur, indépendant de la plateforme)

L'analyse combine **deux sources** :

### A. Les métadonnées (vérité déclarée)
On lit dans l'en-tête du fichier : **codec**, **débit** (bitrate), **sample
rate**, **profondeur de bits**. Ça donne ce que le fichier *prétend* être.

- WAV → PCM (toujours sans-perte)
- FLAC → sans-perte (mais peut encapsuler un lossy : voir B)
- MP4/M4A → AAC (avec perte) **ou** ALAC (sans-perte) — distinguer via l'atome codec
- MP3 → avec perte, lire le débit
- OGG → Vorbis/Opus (avec perte) ou FLAC (sans-perte)

⚠️ **Un `.m4a` est presque toujours de l'AAC lossy** (achat iTunes / Apple
Music) — c'est normal et honnête, NE PAS le signaler comme faux lossless.

### B. Le spectre (détecteur de mensonge)
On décode l'audio en PCM et on calcule le **spectre moyen** (FFT sur des
fenêtres de Hann réparties dans le morceau). On y cherche le **mur d'encodeur** :
une chute d'énergie brutale (falaise) qui ne peut venir que d'un lowpass de
compression lossy. Un signal naturel décline en pente douce ; un encodeur lossy
coupe net.

**Règle clé :** le mur est la SEULE preuve spectrale de lossy. On n'accuse
jamais un fichier juste parce qu'il a peu d'aigus (ça peut venir du contenu
lui-même : voix, musique sombre…).

### La combinaison
- codec sans-perte (PCM/FLAC/ALAC) **+ mur détecté** → **FAUX lossless** 🔴
- codec sans-perte **+ pas de mur** → **sans-perte vérifié** 🟢
- codec lossy (MP3/AAC) → verdict selon le débit 🟢/🟠/🔴

---

## 3. Paramètres et seuils EXACTS (à respecter pour un résultat identique)

### Calcul du spectre
- FFT size **N = 8192**, fenêtre de **Hann**.
- On moyenne la magnitude sur jusqu'à **200 fenêtres** réparties uniformément
  dans le morceau (pas = max(N, (total−N)/200)).
- Magnitude moyenne → **dB normalisés** sur le max (max = 0 dB).
- Le canal analysé = canal 0 (gauche).

### Détection du mur (`wallSteepness`)
- On lisse le spectre (moyenne glissante ±4 bins).
- On cherche, entre **13 kHz et min(nyquist−2500, 20500) Hz**, la plus forte
  **chute d'énergie sur une fenêtre de ~1200 Hz**.
- `hasWall = (chute ≥ 28 dB) ET (fréquence du mur < 20.5 kHz)`.

### Énergie haute-bande (`highBandLevel`) — support secondaire
- Moyenne dB de la bande **18–22 kHz** MOINS la bande de référence **1–6 kHz**.
- `hf` = valeur négative ; sert à distinguer un lossless "riche" d'un ambigu.

### Fréquence max réelle (`maxFrequency`)
- La plus haute fréquence dont le spectre lissé (±6 bins) dépasse **−70 dB**.
- Affichée en `réelle / nyquist kHz` ; badge **Hi-Res** si sample rate > 48 kHz.

### ⚠️ Décodage Hi-Res
`decodeAudioData` (Web Audio) rééchantillonne au taux du contexte (souvent
48 kHz), ce qui **détruit le Hi-Res**. Il FAUT décoder au sample rate natif lu
dans les métadonnées (via OfflineAudioContext sur le web, ou l'API native
équivalente). Sinon un FLAC 96 kHz est analysé comme du 48 kHz.

---

## 4. La logique de verdict (pseudo-code de référence)

```
function classify(meta, spectrum):
    kHz   = cutoff / 1000
    wallK = wall.freq / 1000
    drop  = wall.dropDb
    hasWall = (drop >= 28) AND (wallK < 20.5)

    // 1. Codec sans-perte déclaré
    if meta.lossless AND hasWall:
        → 🔴 FAUX LOSSLESS  (audible: "dégradé")
        → warning: mur à {wallK} kHz, chute {drop} dB
    else if meta.lossless:
        rich = (hf > -32) AND (kHz >= 19.5)
        → 🟢 QUALITÉ MAXIMALE  (audible: "la meilleure possible")
        // rich = aigus pleins ; sinon = lossless mais peu d'aigus (OK aussi)

    // 2. Format non lu → on se fie au spectre
    else if meta.unknown:
        if hasWall: → (wallK>=19.5 ? 🟠 : 🔴)
        else:       → ❓ indéterminé

    // 3. Codec lossy connu (MP3/AAC) — la COULEUR suit l'AUDIBLE
    else:
        isAAC       = codec starts with "AAC"
        transparent = isAAC OR bitrate >= 256
        decent      = bitrate >= 192
        if transparent: → 🟢 EXCELLENTE  ("indiscernable du sans-perte")
        else if decent: → 🟠 CORRECTE     ("légère perte possible")
        else:           → 🔴 DÉGRADÉE     ("perte audible")
```

**Point de design crucial (ne pas casser) :** la couleur suit la **qualité
audible**, PAS le simple lossy/lossless. Un AAC 256 (Apple Music) est 🟢
"excellent" même s'il est "avec perte", car la différence est inaudible. Seuls
MP3 < 192 et les faux lossless sont 🔴. Ça évite d'affoler l'utilisateur pour
rien.

---

## 5. Sortie attendue (structure de données)

Chaque analyse retourne :

```
{
  color:     "green" | "orange" | "red",
  headline:  string,   // ex. "Excellente qualité"  (traduit)
  audible:   string,   // ex. "Indiscernable du sans-perte"
  fileType:  string,   // ex. "Avec perte — AAC"
  warning:   string?,  // présent seulement pour un faux lossless
  score:     0..1,     // position sur la barre qualité
  codec:     string,   // "AAC", "FLAC", "MP3 (Layer III)", "PCM"…
  lossless:  bool,
  bitrateKbps: number?, // MP3/AAC
  bits:      number?,   // lossless
  sampleRate: number,
  hasWall:   bool,
  wallKHz:   number,
  maxFreqKHz: number,
  hiRes:     bool
}
```

Dans MyMusic, le minimum pour un badge : `color` + `headline`. Le reste enrichit
un éventuel écran de détail.

---

## 6. Intégration selon la plateforme de MyMusic

### Cas A — MyMusic est une app WEB / PWA / Electron
Le plus simple. Réutiliser directement `metadata.js` et la logique de
`analyzer.js` du repo (ce sont des modules JS sans dépendance). Appeler
l'analyse sur chaque fichier de la bibliothèque, stocker le résultat, afficher
le badge. → **Copier les fonctions, pas besoin de réécrire.**

### Cas B — MyMusic est une app iOS / Swift native
La Web Audio API n'existe pas ; on **porte la logique** (elle est simple) :
- **Métadonnées** : `AVAsset` / `AVAssetTrack.formatDescriptions` donne le codec
  et le débit sans rien parser à la main. (Plus simple qu'en JS !)
- **Décodage PCM** : `AVAudioFile` → `AVAudioPCMBuffer`, au sample rate natif.
- **FFT** : `Accelerate` / `vDSP` (`vDSP_fft_zrip`), N=8192, fenêtre de Hann via
  `vDSP_hann_window`.
- Réimplémenter `wallSteepness` / `maxFrequency` (quelques boucles, cf. §3).
- La logique `classify` (§4) se recopie telle quelle en Swift.
→ **Effort modéré ; l'algorithme et les seuils sont ci-dessus, rien à deviner.**

### Cas C — React Native / Flutter
Soit un module natif (comme Cas B) pour le décodage + FFT, soit embarquer la
version web dans une WebView et communiquer via un pont JS. Le pont WebView est
le plus rapide à mettre en place pour un prototype.

---

## 7. Textes (FR / EN) déjà prêts

Toutes les chaînes traduites sont dans `i18n.js` du repo (clés `v.*`, `cell.*`,
`scale.*`…). Réutiliser ces clés pour rester cohérent avec la version web.

---

## 8. Quand tu intègres : ce dont j'ai besoin

Pour brancher ça dans MyMusic, ouvre la session dans le dossier du projet
MyMusic (ou indique son chemin) et dis-le. Je lirai :
- la **plateforme** et la **stack** (pour choisir A / B / C),
- **comment MyMusic charge et lit les morceaux** (pour savoir où injecter
  l'analyse),
- **où afficher** le badge dans l'UX.

Puis j'implémente en suivant ce document comme spécification.

---

*Généré depuis le projet TrueSound. Toute la logique validée sur fichiers réels
(FLAC Qobuz Hi-Res, AAC Apple Music, MP3 128/320, faux FLAC).*

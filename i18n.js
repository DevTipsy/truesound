/* TrueSound — internationalisation FR / EN.
 * L'UI statique utilise des clés data-i18n ; le JS d'analyse lit T() pour
 * traduire les verdicts. La langue par défaut suit celle du navigateur, et le
 * choix de l'utilisateur est mémorisé dans localStorage.
 */

const I18N = {
  fr: {
    'meta.description': "Analyse la vraie qualité d'un fichier audio, 100% dans le navigateur.",
    'subtitle.1': "La vraie qualité d'un fichier audio.",
    'subtitle.2': "Pas ce que dit son étiquette.",
    'privacy': "Tout se passe dans votre navigateur. Aucun fichier n'est envoyé.",
    'drop.big': "Dépose un ou plusieurs fichiers, ou clique pour choisir",
    'drop.small': "FLAC, WAV, ALAC, M4A, MP3, AAC, OGG… analysés dans ton navigateur",
    'foot.note': "TrueSound détecte le <strong>mur de coupure spectral</strong> (lowpass) : un vrai lossless garde de l'énergie jusqu'à ~20&nbsp;kHz, un MP3&nbsp;320 coupe vers ~20&nbsp;kHz, un MP3&nbsp;128 vers ~16&nbsp;kHz.<br>Un fichier <code>.flac</code> qui coupe bas est un lossy déguisé (upsample).",
    'foot.by': "Créé par",
    'foot.source': "Code source",
    'foot.support': "Support",

    // Cartes de résultat
    'card.waiting': "En attente…",
    'card.reading': "Lecture des métadonnées…",
    'card.decoding': "Décodage…",
    'card.analyzing': "Analyse spectrale…",
    'card.decodeError': "Impossible de décoder ce format dans ce navigateur (essaie Chrome pour le FLAC, ou WAV/M4A).",
    'card.error': "Erreur",
    'cell.audible': "Qualité à l'oreille",
    'cell.lossless': "Sans perte ?",
    'cell.codec': "Codec",
    'cell.bitrate': "Débit / résolution",
    'cell.wall': "Mur d'encodeur",
    'cell.fmax': "Fréq. max réelle",
    'scale.low': "Perte audible",
    'scale.mid': "Bon",
    'scale.high': "Qualité max",
    'spec.label': "Énergie du son du grave (gauche) vers l'aigu (droite). Une chute brutale trahit une compression&nbsp;; un déclin doux jusqu'au bout = son intact.",
    'val.yes': "Oui",
    'val.no': "Non",
    'val.claimed': "Prétendu",
    'val.none': "Aucun",
    'val.unread': "—",

    // Verdicts (headline + audible + fileType + warning)
    'v.fake.head': "⚠️ Fausse qualité",
    'v.fake.audible': "Qualité dégradée",
    'v.fake.type': "{codec} (annoncé sans perte)",
    'v.fake.warn': "Mur d'encodeur détecté à {wall} kHz (chute de {drop} dB), signature d'un lossy ré-encapsulé.",
    'v.lossless.head': "✅ Qualité maximale",
    'v.lossless.audible': "La meilleure possible",
    'v.lossless.type': "Sans perte — {codec}{bits}{sr}",
    'v.unknown.head': "❓ Indéterminé",
    'v.unknown.audible': "Inconnue",
    'v.unknown.type': "Format non reconnu",
    'v.unknownWall.headGood': "🟠 Correcte",
    'v.unknownWall.headBad': "🔴 Dégradée",
    'v.unknownWall.audibleGood': "Bonne",
    'v.unknownWall.audibleBad': "Audiblement dégradée",
    'v.aac.head': "✅ Excellente qualité",
    'v.aac.audible': "Indiscernable du sans-perte",
    'v.mp3hi.head': "✅ Excellente qualité",
    'v.mp3hi.audible': "Indiscernable du sans-perte",
    'v.mp3mid.head': "🟠 Qualité correcte",
    'v.mp3mid.audible': "Bonne, légère perte possible",
    'v.mp3low.head': "🔴 Qualité dégradée",
    'v.mp3low.audible': "Perte audible",
    'type.lossy': "Avec perte — {codec}{br}",
  },
  en: {
    'meta.description': "Check the true quality of an audio file, 100% in your browser.",
    'subtitle.1': "The true quality of an audio file.",
    'subtitle.2': "Not what its label claims.",
    'privacy': "Everything runs in your browser. No file is ever uploaded.",
    'drop.big': "Drop one or more files, or click to choose",
    'drop.small': "FLAC, WAV, ALAC, M4A, MP3, AAC, OGG… analysed in your browser",
    'foot.note': "TrueSound detects the <strong>spectral cutoff wall</strong> (lowpass): true lossless keeps energy up to ~20&nbsp;kHz, MP3&nbsp;320 cuts around ~20&nbsp;kHz, MP3&nbsp;128 around ~16&nbsp;kHz.<br>A <code>.flac</code> file that cuts low is a disguised lossy (upsample).",
    'foot.by': "Made by",
    'foot.source': "Source code",
    'foot.support': "Support",

    'card.waiting': "Waiting…",
    'card.reading': "Reading metadata…",
    'card.decoding': "Decoding…",
    'card.analyzing': "Spectral analysis…",
    'card.decodeError': "This browser can't decode this format (try Chrome for FLAC, or WAV/M4A).",
    'card.error': "Error",
    'cell.audible': "Perceived quality",
    'cell.lossless': "Lossless?",
    'cell.codec': "Codec",
    'cell.bitrate': "Bitrate / depth",
    'cell.wall': "Encoder wall",
    'cell.fmax': "Real max freq.",
    'scale.low': "Audible loss",
    'scale.mid': "Good",
    'scale.high': "Top quality",
    'spec.label': "Sound energy from bass (left) to treble (right). A sharp drop reveals compression&nbsp;; a smooth decline all the way = intact sound.",
    'val.yes': "Yes",
    'val.no': "No",
    'val.claimed': "Claimed",
    'val.none': "None",
    'val.unread': "—",

    'v.fake.head': "⚠️ Fake quality",
    'v.fake.audible': "Degraded quality",
    'v.fake.type': "{codec} (claimed lossless)",
    'v.fake.warn': "Encoder wall detected at {wall} kHz ({drop} dB drop), signature of a re-wrapped lossy.",
    'v.lossless.head': "✅ Top quality",
    'v.lossless.audible': "The best possible",
    'v.lossless.type': "Lossless — {codec}{bits}{sr}",
    'v.unknown.head': "❓ Undetermined",
    'v.unknown.audible': "Unknown",
    'v.unknown.type': "Unrecognised format",
    'v.unknownWall.headGood': "🟠 Decent",
    'v.unknownWall.headBad': "🔴 Degraded",
    'v.unknownWall.audibleGood': "Good",
    'v.unknownWall.audibleBad': "Audibly degraded",
    'v.aac.head': "✅ Excellent quality",
    'v.aac.audible': "Indistinguishable from lossless",
    'v.mp3hi.head': "✅ Excellent quality",
    'v.mp3hi.audible': "Indistinguishable from lossless",
    'v.mp3mid.head': "🟠 Decent quality",
    'v.mp3mid.audible': "Good, slight loss possible",
    'v.mp3low.head': "🔴 Degraded quality",
    'v.mp3low.audible': "Audible loss",
    'type.lossy': "Lossy — {codec}{br}",
  }
};

// Langue courante : choix mémorisé, sinon langue du navigateur, sinon EN.
let LANG = (function () {
  let saved = null;
  try { saved = localStorage.getItem('ts-lang'); } catch (e) {}
  if (saved === 'fr' || saved === 'en') return saved;
  const nav = (navigator.language || 'en').toLowerCase();
  return nav.startsWith('fr') ? 'fr' : 'en';
})();

// T(key, params) -> chaîne traduite avec substitution {placeholder}.
function T(key, params) {
  let s = (I18N[LANG] && I18N[LANG][key]) || (I18N.en[key]) || key;
  if (params) for (const k in params) s = s.replaceAll('{' + k + '}', params[k]);
  return s;
}

// Applique les traductions à tout le DOM statique (éléments [data-i18n]).
function applyI18n() {
  document.documentElement.lang = LANG;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.innerHTML = T(el.getAttribute('data-i18n'));
  });
  const desc = document.querySelector('meta[name="description"]');
  if (desc) desc.setAttribute('content', T('meta.description'));
  // état du switch
  document.querySelectorAll('.lang-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.lang === LANG);
  });
}

function setLang(lang) {
  if (lang !== 'fr' && lang !== 'en') return;
  LANG = lang;
  try { localStorage.setItem('ts-lang', lang); } catch (e) {}
  applyI18n();
  // ré-analyse : on efface les résultats et on invite à redéposer, ou on laisse
  // tel quel. Le plus simple : vider et informer via le placeholder inchangé.
  document.dispatchEvent(new CustomEvent('ts-lang-changed'));
}

window.T = T; window.setLang = setLang; window.applyI18n = applyI18n;
document.addEventListener('DOMContentLoaded', applyI18n);

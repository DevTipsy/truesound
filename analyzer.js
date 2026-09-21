/* TrueSound — analyseur de qualité audio réelle (100% navigateur)
 *
 * Principe : on décode le fichier en PCM, on calcule le spectre moyen
 * (FFT sur des fenêtres de tout le morceau), puis on cherche la fréquence
 * de coupure (lowpass cutoff) au-delà de laquelle il n'y a quasi plus
 * d'énergie. Ce "mur" trahit un encodage lossy antérieur, même si le
 * conteneur actuel est FLAC/WAV.
 */

const fileInput = document.getElementById('file');
const drop = document.getElementById('drop');
const results = document.getElementById('results');

// --- Drag & drop --------------------------------------------------------
['dragenter', 'dragover'].forEach(ev =>
  drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('drag'); }));
['dragleave', 'drop'].forEach(ev =>
  drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('drag'); }));
drop.addEventListener('drop', e => handleFiles(e.dataTransfer.files));
fileInput.addEventListener('change', e => handleFiles(e.target.files));

function handleFiles(fileList) {
  [...fileList].forEach(f => analyzeFile(f));
}

// --- FFT (radix-2, itérative) ------------------------------------------
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = i + k + len / 2;
        const tr = cr * re[b] - ci * im[b];
        const ti = cr * im[b] + ci * re[b];
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

// --- Analyse principale -------------------------------------------------
async function analyzeFile(file) {
  const card = renderCard(file);
  const set = (msg, cls) => {
    const s = card.querySelector('.status');
    s.textContent = msg;
    s.className = cls || 'status';
  };

  try {
    set(T('card.reading'));
    const buf = await file.arrayBuffer();
    const meta = (typeof readMetadata === 'function')
      ? safe(() => readMetadata(buf, file.name)) : { unknown: true };

    set(T('card.decoding'));
    // decodeAudioData rééchantillonne au sample rate du CONTEXTE. Pour ne pas
    // écraser un Hi-Res (88,2/96/192 kHz) vers les 48 kHz de la carte son, on
    // décode dans un OfflineAudioContext calé sur le sample rate lu dans les
    // métadonnées. Ainsi un FLAC 96 kHz garde ses aigus jusqu'à 48 kHz.
    let audio;
    const metaSR = (meta && meta.sampleRate && meta.sampleRate >= 8000 && meta.sampleRate <= 384000)
      ? meta.sampleRate : null;
    try {
      audio = await decodeAtRate(buf, metaSR);
    } catch (e) {
      set(T('card.decodeError'), 'err');
      return;
    }
    const sampleRate = audio.sampleRate;
    const nyquist = sampleRate / 2;

    set(T('card.analyzing'));
    const spectrum = await computeAverageSpectrum(audio);

    const cutoff = detectCutoff(spectrum, nyquist);
    const hf = highBandLevel(spectrum, nyquist);          // énergie 18–22 kHz vs corps (dB)
    const wall = wallSteepness(spectrum, nyquist, cutoff); // {dropDb, atHz} : mur artificiel ?
    const fmax = maxFrequency(spectrum, nyquist);          // bande passante réelle (Hz)
    const verdict = classify(cutoff, nyquist, file, audio, hf, wall, meta);

    const r = { file, audio, sampleRate, nyquist, cutoff, verdict, spectrum, meta, fmax };
    analyzed.push({ card, r });
    fillResult(card, r);
  } catch (err) {
    console.error(err);
    set(T('card.error') + ' : ' + err.message, 'err');
  }
}

// Décode le fichier en préservant le sample rate natif (targetRate lu dans les
// métadonnées). Un OfflineAudioContext permet de fixer un sample rate arbitraire
// jusqu'à 192 kHz, contrairement à l'AudioContext temps réel bloqué à celui de
// la carte son. Fallback : contexte par défaut si le taux n'est pas accepté.
async function decodeAtRate(buf, targetRate) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (targetRate && OAC) {
    try {
      // 1 frame suffit pour l'instancier ; on ne l'utilise que pour décoder.
      const off = new OAC(1, 1, targetRate);
      const audio = await off.decodeAudioData(buf.slice(0));
      if (audio.sampleRate >= targetRate - 1) return audio; // taux préservé
      // certains navigateurs rééchantillonnent quand même : on garde ce qu'on a
      return audio;
    } catch (e) { /* taux refusé -> fallback */ }
  }
  const ctx = new AC();
  try { return await ctx.decodeAudioData(buf.slice(0)); }
  finally { ctx.close(); }
}

// Spectre moyen : on prend le canal gauche, on fenêtre (Hann), FFT, on
// moyenne la magnitude sur plusieurs tranches réparties dans le morceau.
async function computeAverageSpectrum(audio) {
  const data = audio.getChannelData(0);
  const N = 8192;                       // taille FFT
  const half = N / 2;
  const acc = new Float64Array(half);
  const hann = new Float64Array(N);
  for (let i = 0; i < N; i++) hann[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (N - 1)));

  const total = data.length;
  const maxFrames = 200;                // plafonne pour rester rapide
  const step = Math.max(N, Math.floor((total - N) / maxFrames));
  let frames = 0;

  for (let start = 0; start + N <= total; start += step) {
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = data[start + i] * hann[i];
    fft(re, im);
    for (let k = 0; k < half; k++) {
      acc[k] += Math.sqrt(re[k] * re[k] + im[k] * im[k]);
    }
    frames++;
    if (frames >= maxFrames) break;
  }
  if (frames === 0) { // morceau très court : une seule fenêtre
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N && i < total; i++) re[i] = data[i] * hann[i];
    fft(re, im);
    for (let k = 0; k < half; k++) acc[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
    frames = 1;
  }

  // magnitude moyenne -> dB, normalisé sur le max
  const mag = new Float64Array(half);
  let max = 1e-12;
  for (let k = 0; k < half; k++) { mag[k] = acc[k] / frames; if (mag[k] > max) max = mag[k]; }
  const db = new Float64Array(half);
  for (let k = 0; k < half; k++) db[k] = 20 * Math.log10((mag[k] + 1e-12) / max);
  return db; // index k -> fréquence = k/half * nyquist
}

// Détection du cutoff basée sur le DÉCROCHAGE RELATIF, pas un seuil absolu.
// Un lowpass laisse toujours un résidu au-dessus de la coupure ; un seuil de
// bruit fixe le prend pour du signal. On détecte donc l'endroit où l'énergie
// s'effondre durablement sous une bande de référence (le corps du signal).
function detectCutoff(db, nyquist) {
  const half = db.length;

  // lissage
  const win = 8;
  const smooth = new Float64Array(half);
  for (let k = 0; k < half; k++) {
    let s = 0, c = 0;
    for (let j = Math.max(0, k - win); j <= Math.min(half - 1, k + win); j++) { s += db[j]; c++; }
    smooth[k] = s / c;
  }

  // Niveau de référence : médiane de la bande 1–6 kHz (le corps du morceau,
  // toujours présent quel que soit l'encodage).
  const binOf = f => Math.round(f / nyquist * half);
  const refLo = binOf(1000), refHi = Math.min(half - 1, binOf(6000));
  const refSlice = [];
  for (let k = refLo; k <= refHi; k++) refSlice.push(smooth[k]);
  refSlice.sort((a, b) => a - b);
  const refLevel = refSlice[Math.floor(refSlice.length / 2)] || -20;

  // Le cutoff = 1re fréquence (en montant depuis la réf) où l'énergie tombe
  // durablement à plus de `drop` dB sous la référence et n'y remonte plus.
  const drop = 22;                       // dB sous la réf = début de coupure (genou de la pente)
  const thresh = refLevel - drop;
  const need = binOf(400);               // ~400 Hz de chute soutenue pour valider
  let cutoffBin = half - 1;
  let run = 0, firstBelow = -1;
  for (let k = refHi; k < half; k++) {
    if (smooth[k] < thresh) {
      if (run === 0) firstBelow = k;
      run++;
      if (run >= need) { cutoffBin = firstBelow; break; }
    } else {
      run = 0; firstBelow = -1;
    }
  }
  return (cutoffBin / half) * nyquist; // Hz
}

// Fréquence la plus haute où le signal porte réellement de l'énergie (dernière
// bande, en montant, encore au-dessus du plancher relatif). Sert à afficher la
// bande passante réelle du morceau ("XX / max kHz") — utile pour repérer un vrai
// Hi-Res (contenu au-delà de 22 kHz) vs un master qui plafonne au CD.
function maxFrequency(db, nyquist) {
  const half = db.length;
  const win = 6;
  const sm = k => {
    let s = 0, c = 0;
    for (let j = Math.max(0, k - win); j <= Math.min(half - 1, k + win); j++) { s += db[j]; c++; }
    return s / c;
  };
  const floor = -70; // seuil relatif (le spectre est normalisé, max = 0 dB)
  for (let k = half - 1; k >= 0; k--) {
    if (sm(k) > floor) return (k / half) * nyquist;
  }
  return 0;
}

// Énergie moyenne de la bande haute (18–22 kHz) relative au corps du signal
// (1–6 kHz), en dB. C'est LE discriminant fiable : un vrai lossless garde de
// l'énergie tout en haut (~ -10 dB), un lossy s'y effondre (< -25 dB), même
// quand son cutoff apparent reste haut.
function highBandLevel(db, nyquist) {
  const half = db.length;
  const bin = f => Math.round(f / nyquist * half);
  const band = (lo, hi) => {
    let s = 0, c = 0;
    for (let k = bin(lo); k <= bin(hi) && k < half; k++) { s += db[k]; c++; }
    return c ? s / c : -120;
  };
  const ref = band(1000, 6000);
  const topHi = Math.min(22000, nyquist - 500);
  const top = band(18000, topHi);
  return top - ref; // dB sous la réf (valeur négative)
}

// Raideur du "mur" au point de coupure. UN VRAI DISCRIMINANT du lossy :
// un encodeur pose un lowpass qui crée une FALAISE (chute brutale sur ~1 kHz),
// alors que le contenu naturel décline en pente douce. On renvoie la plus
// forte chute d'énergie (dB) sur une fenêtre glissante de ~1,2 kHz au-dessus
// de 13 kHz, et la fréquence où elle se produit.
function wallSteepness(db, nyquist, cutoffHz) {
  const half = db.length;
  const bin = f => Math.round(f / nyquist * half);
  // lissage léger pour ne pas compter le bruit bin-à-bin
  const win = 4;
  const sm = new Float64Array(half);
  for (let k = 0; k < half; k++) {
    let s = 0, c = 0;
    for (let j = Math.max(0, k - win); j <= Math.min(half - 1, k + win); j++) { s += db[j]; c++; }
    sm[k] = s / c;
  }
  const span = bin(1200) - bin(0);       // ~1,2 kHz en bins
  const from = bin(13000);
  // On s'arrête BIEN AVANT Nyquist : la chute terminale du spectre (fin de la
  // bande) n'est pas un mur d'encodeur et créerait un faux positif. Un vrai
  // lowpass lossy est à ≤ ~20,5 kHz. On plafonne donc la fin de recherche.
  const to = Math.min(half - 1, bin(Math.min(nyquist - 2500, 20500)));
  let maxDrop = 0, atHz = cutoffHz;
  for (let k = from; k + span <= to; k++) {
    const drop = sm[k] - sm[k + span];   // positif = ça descend
    if (drop > maxDrop) { maxDrop = drop; atHz = ((k + span / 2) / half) * nyquist; }
  }
  return { dropDb: maxDrop, atHz };      // dropDb élevé (>~28) = mur artificiel
}

// Classification pilotée par les MÉTADONNÉES (codec déclaré = vérité), le
// spectre servant de détecteur de mensonge :
//  - codec lossless (PCM/FLAC/ALAC) + mur d'encodeur => FAUX lossless démasqué.
//  - codec lossless + pas de mur => vrai lossless confirmé (vert).
//  - codec lossy (MP3/AAC) => verdict selon le débit lu ; le spectre illustre.
// Le mur (drop>=28 dB sur ~1,2 kHz) est la seule PREUVE spectrale de lossy ;
// on n'accuse jamais sur un simple manque d'aigus (qui dépend du contenu).
// Renvoie DEUX axes distincts pour ne pas tromper les novices :
//  - fileType : le FAIT technique (sans perte / avec perte / faux / inconnu).
//  - headline + audible : la QUALITÉ PERÇUE ("vas-tu entendre une différence ?"),
//    qui pilote la couleur. Un AAC 256 est "avec perte" MAIS excellent à l'oreille,
//    donc vert-ish — il ne doit pas inquiéter. Seul l'audiblement mauvais (MP3 128,
//    faux lossless) passe au rouge.
// Champs conservés pour la courbe/stats : color, score, hasWall, wallK, hf…
function classify(cutoff, nyquist, file, audio, hf, wall, meta) {
  const kHz = cutoff / 1000;
  const wallK = wall.atHz / 1000, drop = wall.dropDb;
  const hasWall = drop >= 28 && wallK < 20.5;
  meta = meta || { unknown: true };

  const bitrateNote = meta.bitrateKbps ? ` ${meta.bitrateKbps} kbps` : '';
  const bitsNote = meta.bits ? ' ' + meta.bits + '-bit' : '';
  const srNote = meta.sampleRate ? ' / ' + (meta.sampleRate/1000).toFixed(1) + ' kHz' : '';

  let color, score, headline, fileType, audible, warning = null;

  if (meta.lossless && hasWall) {
    // FAUX lossless : conteneur sans perte mais mur d'encodeur.
    color = 'red'; score = 0.3;
    headline = T('v.fake.head');
    audible = T('v.fake.audible');
    fileType = T('v.fake.type', { codec: meta.codec });
    warning = T('v.fake.warn', { wall: wallK.toFixed(1), drop: drop.toFixed(0) });
  } else if (meta.lossless) {
    // VRAI sans-perte.
    const rich = hf > -32 && kHz >= 19.5;
    color = 'green'; score = rich ? 0.96 : 0.86;
    headline = T('v.lossless.head');
    audible = T('v.lossless.audible');
    fileType = T('v.lossless.type', { codec: meta.codec, bits: bitsNote, sr: srNote });
  } else if (meta.unknown) {
    // Format non lu : on se rabat sur le spectre, prudemment.
    if (hasWall) {
      const good = wallK >= 19.5;
      color = good ? 'orange' : 'red';
      score = good ? 0.55 : 0.3;
      headline = good ? T('v.unknownWall.headGood') : T('v.unknownWall.headBad');
      audible = good ? T('v.unknownWall.audibleGood') : T('v.unknownWall.audibleBad');
    } else {
      color = 'orange'; score = 0.55;
      headline = T('v.unknown.head');
      audible = T('v.unknown.audible');
    }
    fileType = T('v.unknown.type');
  } else {
    // LOSSY connu (MP3/AAC). La couleur suit l'AUDIBLE, pas le simple "lossy".
    const br = meta.bitrateKbps;
    const isAAC = meta.codec.startsWith('AAC');
    fileType = T('type.lossy', { codec: meta.codec, br: bitrateNote });

    const transparent = isAAC || (br && br >= 256);
    const decent = br && br >= 192;

    if (transparent) {
      color = 'green'; score = 0.8;
      headline = isAAC ? T('v.aac.head') : T('v.mp3hi.head');
      audible = isAAC ? T('v.aac.audible') : T('v.mp3hi.audible');
    } else if (decent) {
      color = 'orange'; score = 0.5;
      headline = T('v.mp3mid.head');
      audible = T('v.mp3mid.audible');
    } else {
      color = 'red'; score = Math.max(0.12, Math.min(0.32, (br || 128) / 320 * 0.35));
      headline = T('v.mp3low.head');
      audible = T('v.mp3low.audible');
    }
  }

  return { color, score: Math.max(0, Math.min(1, score)),
           headline, fileType, audible, warning,
           hf, wallK, wallDrop: drop, hasWall, meta, cutoffKHz: kHz };
}

function safe(fn) { try { return fn(); } catch (e) { return { unknown: true }; } }

// --- Rendu --------------------------------------------------------------
function renderCard(file) {
  const el = document.createElement('div');
  el.className = 'card glass';
  el.innerHTML = `
    <div class="card-head">
      <div class="fname">${escapeHtml(file.name)}</div>
      <div class="fmeta">${fmtSize(file.size)}</div>
    </div>
    <div class="status">${T('card.waiting')}</div>`;
  results.prepend(el);
  return el;
}

function fillResult(card, r) {
  const { verdict, cutoff, nyquist, sampleRate, audio, spectrum, file, meta, fmax } = r;
  const pct = (verdict.score * 100).toFixed(0);
  const m = meta || {};
  const codecStr = m.unknown ? T('val.unread') : (m.codec || m.container || '—');
  const fmaxK = ((fmax || 0) / 1000).toFixed(1);
  const nyqK = (nyquist / 1000).toFixed(1);
  const hiRes = nyquist > 24500; // sample rate > 49 kHz -> Hi-Res décodé nativement
  // Valeurs des cartes — IDENTIQUES pour tous les fichiers, pour comparer
  // d'un coup d'œil. Chaque carte a une pastille de couleur selon sa valeur.
  const losslessCell = m.unknown ? { t: T('val.unread'), c: '' }
    : m.lossless ? (verdict.hasWall ? { t: T('val.claimed'), c: 'red' } : { t: T('val.yes'), c: 'green' })
    : { t: T('val.no'), c: 'orange' };
  const wallCell = verdict.hasWall ? { t: `${verdict.wallK.toFixed(1)} kHz`, c: 'red' } : { t: T('val.none'), c: 'green' };

  card.innerHTML = `
    <div class="card-head">
      <div class="fname">${escapeHtml(file.name)}</div>
      <div class="fmeta">${fmtTime(audio.duration)} · ${fmtSize(file.size)}</div>
    </div>

    <div class="headline ${verdict.color}">${escapeHtml(verdict.headline)}</div>

    <div class="cardgrid">
      <div class="cell"><span class="c-k">${T('cell.audible')}</span><span class="c-v ${verdict.color}">${escapeHtml(verdict.audible)}</span></div>
      <div class="cell"><span class="c-k">${T('cell.lossless')}</span><span class="c-v ${losslessCell.c}">${escapeHtml(losslessCell.t)}</span></div>
      <div class="cell"><span class="c-k">${T('cell.codec')}</span><span class="c-v">${escapeHtml(codecStr)}</span></div>
      <div class="cell"><span class="c-k">${T('cell.bitrate')}</span><span class="c-v">${m.bitrateKbps ? m.bitrateKbps + ' kbps' : (m.bits ? m.bits + '-bit' : '—')}</span></div>
      <div class="cell"><span class="c-k">${T('cell.wall')}</span><span class="c-v ${wallCell.c}">${escapeHtml(wallCell.t)}</span></div>
      <div class="cell"><span class="c-k">${T('cell.fmax')}</span><span class="c-v">${fmaxK} / ${nyqK} kHz${hiRes ? ' <b class="hires">Hi-Res</b>' : ''}</span></div>
    </div>

    <div class="bar"><div class="marker" style="left:calc(${pct}% - 2px)"></div></div>
    <div class="scale"><span>${T('scale.low')}</span><span>${T('scale.mid')}</span><span>${T('scale.high')}</span></div>

    ${verdict.warning ? `<div class="err">${escapeHtml(verdict.warning)}</div>` : ''}

    <canvas class="spec" width="800" height="130"></canvas>
    <div class="spec-label">${T('spec.label')}</div>
  `;
  const canvas = card.querySelector('.spec');
  if (canvas) drawSpectrum(canvas, spectrum, nyquist,
               verdict.hasWall ? verdict.wallK * 1000 : cutoff, verdict.color);
}

// Cache des analyses pour re-render au changement de langue (le verdict est
// recalculé car classify() lit T(), qui dépend de la langue courante).
const analyzed = [];
document.addEventListener('ts-lang-changed', () => {
  for (const { card, r } of analyzed) {
    const v = classify(r.cutoff, r.nyquist, r.file, r.audio, r.verdict.hf,
                       { atHz: r.verdict.wallK * 1000, dropDb: r.verdict.wallDrop }, r.meta);
    fillResult(card, Object.assign({}, r, { verdict: v }));
  }
});

function drawSpectrum(canvas, db, nyquist, cutoff, color) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const colMap = { green: '#30a46c', orange: '#f5a623', red: '#e5484d' };
  const half = db.length;

  // courbe : dB de -90..0 -> H..0
  ctx.beginPath();
  for (let x = 0; x < W; x++) {
    const k = Math.floor(x / W * half);
    const d = Math.max(-90, Math.min(0, db[k]));
    const y = H - ((d + 90) / 90) * H;
    if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = colMap[color] || '#5b8def';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // remplissage léger
  ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
  ctx.fillStyle = (colMap[color] || '#5b8def') + '22';
  ctx.fill();

  // ligne de cutoff
  const cx = (cutoff / nyquist) * W;
  ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, H);
  ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]); ctx.stroke();
  ctx.setLineDash([]);

  // graduations kHz
  ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.font = '10px sans-serif';
  for (let f = 5; f < nyquist / 1000; f += 5) {
    const x = (f * 1000 / nyquist) * W;
    ctx.fillRect(x, H - 4, 1, 4);
    ctx.fillText(f + 'k', x + 2, H - 6);
  }
}

// --- utils --------------------------------------------------------------
function fmtSize(b) {
  if (b > 1e6) return (b / 1e6).toFixed(1) + ' Mo';
  if (b > 1e3) return (b / 1e3).toFixed(0) + ' Ko';
  return b + ' o';
}
function fmtTime(s) {
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

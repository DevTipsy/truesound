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
    set('Décodage…');
    const buf = await file.arrayBuffer();
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    let audio;
    try {
      audio = await ctx.decodeAudioData(buf.slice(0));
    } catch (e) {
      ctx.close();
      set("Impossible de décoder ce format dans ce navigateur (essaie Chrome pour le FLAC, ou WAV/M4A).", 'err');
      return;
    }
    const sampleRate = audio.sampleRate;
    const nyquist = sampleRate / 2;

    set('Analyse spectrale…');
    const spectrum = await computeAverageSpectrum(audio);
    ctx.close();

    const cutoff = detectCutoff(spectrum, nyquist);
    const verdict = classify(cutoff, nyquist, file, audio);

    fillResult(card, { file, audio, sampleRate, nyquist, cutoff, verdict, spectrum });
  } catch (err) {
    console.error(err);
    set('Erreur : ' + err.message, 'err');
  }
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

// Détection du cutoff : on part du haut du spectre et on descend jusqu'à
// trouver là où l'énergie remonte durablement au-dessus d'un seuil de bruit.
function detectCutoff(db, nyquist) {
  const half = db.length;
  const floorDb = -75;                  // au-dessus = du vrai signal
  // moyenne glissante pour lisser
  const win = 8;
  const smooth = new Float64Array(half);
  for (let k = 0; k < half; k++) {
    let s = 0, c = 0;
    for (let j = Math.max(0, k - win); j <= Math.min(half - 1, k + win); j++) { s += db[j]; c++; }
    smooth[k] = s / c;
  }
  // en partant du sommet des fréquences, on cherche le 1er bin (vers le bas)
  // où l'énergie dépasse le seuil de façon soutenue
  let cutoffBin = half - 1;
  const need = 12; // bins consécutifs au-dessus du seuil pour valider
  let run = 0;
  for (let k = half - 1; k >= 0; k--) {
    if (smooth[k] > floorDb) { run++; if (run >= need) { cutoffBin = k; break; } }
    else run = 0;
  }
  return (cutoffBin / half) * nyquist; // Hz
}

// Classification -> score 0..1 (position barre) + libellé + couleur
function classify(cutoff, nyquist, file, audio) {
  const kHz = cutoff / 1000;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const losslessExt = ['flac', 'wav', 'alac', 'aiff', 'aif'];
  const claimsLossless = losslessExt.includes(ext) ||
    (ext === 'm4a'); // m4a peut être ALAC ou AAC — on tranche via le spectre

  let color, label, detail, likely, score;

  if (kHz >= 20) {
    color = 'green';
    label = 'Full quality';
    likely = 'Lossless (ou proche du maximum)';
    detail = `Énergie présente jusqu'à ${kHz.toFixed(1)} kHz — spectre non tronqué.`;
    score = 0.83 + Math.min(0.15, (kHz - 20) / 10);
  } else if (kHz >= 18.5) {
    color = 'orange';
    label = 'Bon (proche MP3 320)';
    likely = 'MP3 320 kbps / AAC haut débit';
    detail = `Coupure vers ${kHz.toFixed(1)} kHz — typique d'un encodage lossy de haute qualité.`;
    score = 0.42 + (kHz - 18.5) / 1.5 * 0.2;
  } else if (kHz >= 15.5) {
    color = 'orange';
    label = 'Moyen';
    likely = 'MP3 ~192 kbps';
    detail = `Coupure vers ${kHz.toFixed(1)} kHz — qualité intermédiaire.`;
    score = 0.34 + (kHz - 15.5) / 3 * 0.08;
  } else {
    color = 'red';
    label = 'Basse qualité';
    likely = kHz >= 14 ? 'MP3 ~128 kbps' : 'MP3 ≤128 kbps / source dégradée';
    detail = `Coupure vers ${kHz.toFixed(1)} kHz — nettement lossy.`;
    score = Math.max(0.05, Math.min(0.3, kHz / 16 * 0.3));
  }

  // Alerte "faux lossless" : conteneur lossless mais spectre tronqué
  let warning = null;
  if (claimsLossless && kHz < 20) {
    warning = `⚠️ Fichier .${ext} annoncé sans perte, mais le spectre est coupé à ${kHz.toFixed(1)} kHz : `
      + `c'est très probablement un lossy (${likely}) ré-encapsulé. Le conteneur ment.`;
    if (color === 'green') { color = 'orange'; }
  }

  return { color, label, detail, likely, score: Math.max(0, Math.min(1, score)), warning, cutoffKHz: kHz };
}

// --- Rendu --------------------------------------------------------------
function renderCard(file) {
  const el = document.createElement('div');
  el.className = 'card';
  el.innerHTML = `
    <div class="card-head">
      <div class="fname">${escapeHtml(file.name)}</div>
      <div class="fmeta">${fmtSize(file.size)}</div>
    </div>
    <div class="status">En attente…</div>`;
  results.prepend(el);
  return el;
}

function fillResult(card, r) {
  const { verdict, cutoff, nyquist, sampleRate, audio, spectrum, file } = r;
  const pct = (verdict.score * 100).toFixed(0);
  card.innerHTML = `
    <div class="card-head">
      <div class="fname">${escapeHtml(file.name)}</div>
      <div class="fmeta">${fmtSize(file.size)} · ${sampleRate} Hz · ${audio.numberOfChannels} ch · ${fmtTime(audio.duration)}</div>
    </div>

    <div class="verdict">
      <span class="badge ${verdict.color}">${verdict.label}</span>
      <span class="verdict-text">${verdict.detail}</span>
    </div>

    ${verdict.warning ? `<div class="err" style="margin-top:10px">${verdict.warning}</div>` : ''}

    <div class="bar"><div class="marker" style="left:calc(${pct}% - 2px)"></div></div>
    <div class="scale"><span>Basse qualité</span><span>Lossy HQ</span><span>Full quality</span></div>

    <div class="stats">
      <div class="stat"><div class="k">Coupure spectrale</div><div class="v">${verdict.cutoffKHz.toFixed(1)} kHz</div></div>
      <div class="stat"><div class="k">Source probable</div><div class="v" style="font-size:14px">${verdict.likely}</div></div>
      <div class="stat"><div class="k">Fréq. max théorique</div><div class="v">${(nyquist/1000).toFixed(1)} kHz</div></div>
    </div>

    <canvas class="spec" width="800" height="130"></canvas>
    <div class="spec-label">Spectre moyen (dB) — de 0 à ${(nyquist/1000).toFixed(0)} kHz · la ligne blanche = cutoff détecté</div>
  `;
  drawSpectrum(card.querySelector('.spec'), spectrum, nyquist, cutoff, verdict.color);
}

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

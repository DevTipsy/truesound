/* TrueSound — lecture des vraies métadonnées audio (codec/débit) dans le
 * navigateur, sans dépendance. On parse juste assez d'en-tête pour savoir
 * QUEL codec et QUEL débit, ce qui tranche lossless vs lossy de façon certaine.
 * Le spectre (analyzer.js) sert ensuite à confirmer ou démentir.
 *
 * Retour : { container, codec, lossless, bitrateKbps, sampleRate, bits, note }
 * ou { unknown:true } si le format n'est pas reconnu.
 */

function readMetadata(arrayBuffer, fileName) {
  const b = new Uint8Array(arrayBuffer);
  const ext = (fileName.split('.').pop() || '').toLowerCase();
  const dv = new DataView(arrayBuffer);

  // --- WAV (RIFF) : toujours PCM non compressé = lossless ------------------
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WAVE') {
    const fmt = findChunk(b, 12, 'fmt ');
    if (fmt >= 0) {
      const audioFormat = dv.getUint16(fmt + 8, true);
      const channels = dv.getUint16(fmt + 10, true);
      const sr = dv.getUint32(fmt + 12, true);
      const bits = dv.getUint16(fmt + 22, true);
      return {
        container: 'WAV', codec: audioFormat === 1 ? 'PCM' : 'WAV (' + audioFormat + ')',
        lossless: true, sampleRate: sr, bits, channels,
        note: 'PCM non compressé — sans perte par nature.'
      };
    }
  }

  // --- FLAC : bloc STREAMINFO -------------------------------------------
  if (ascii(b, 0, 4) === 'fLaC') {
    // premier metadata block = STREAMINFO (type 0), commence à l'octet 4
    // header bloc: 1 octet (flags+type) + 3 octets taille, puis données
    const info = 8; // début des données STREAMINFO
    // sample rate = 20 bits à partir de l'octet 10 (offset info+10)
    const p = info + 10;
    const sr = (b[p] << 12) | (b[p + 1] << 4) | (b[p + 2] >> 4);
    const bits = (((b[p + 2] & 0x01) << 4) | (b[p + 3] >> 4)) + 1;
    const ch = ((b[p + 2] >> 1) & 0x07) + 1;
    return {
      container: 'FLAC', codec: 'FLAC', lossless: true,
      sampleRate: sr, bits, channels: ch,
      note: 'FLAC — sans perte. (À confirmer au spectre : un FLAC peut encapsuler un lossy.)'
    };
  }

  // --- MP4 / M4A : chercher l'atome de codec dans moov ------------------
  if (ascii(b, 4, 4) === 'ftyp') {
    const codec = findMp4Codec(b);
    if (codec) {
      const lossless = codec === 'alac';
      const map = { 'mp4a': 'AAC', 'alac': 'ALAC', 'ac-3': 'AC-3', 'ec-3': 'E-AC-3' };
      return {
        container: 'MP4/M4A', codec: map[codec] || codec.toUpperCase(),
        lossless, sampleRate: codec.srGuess || null, bits: lossless ? 16 : null,
        note: lossless
          ? 'ALAC — sans perte.'
          : 'AAC — avec perte (cas normal d\'un .m4a acheté ou d\'Apple Music).'
      };
    }
  }

  // --- MP3 : premier frame header + tag Xing/Info/LAME ------------------
  if (ext === 'mp3' || hasMp3Sync(b)) {
    const mp3 = parseMp3(b, dv);
    if (mp3) return mp3;
  }

  // --- OGG : Vorbis (lossy) ou FLAC (lossless) --------------------------
  if (ascii(b, 0, 4) === 'OggS') {
    const isFlac = indexOfAscii(b, 'FLAC', 0, 200) >= 0;
    const isVorbis = indexOfAscii(b, 'vorbis', 0, 200) >= 0;
    const isOpus = indexOfAscii(b, 'OpusHead', 0, 200) >= 0;
    return {
      container: 'OGG', codec: isFlac ? 'FLAC' : isOpus ? 'Opus' : isVorbis ? 'Vorbis' : 'OGG',
      lossless: isFlac, sampleRate: null, bits: null,
      note: isFlac ? 'OGG-FLAC — sans perte.' : 'Codec OGG avec perte.'
    };
  }

  return { unknown: true, container: ext.toUpperCase() || '?', note: 'Format non reconnu par le lecteur de métadonnées.' };
}

// --- helpers ------------------------------------------------------------
function ascii(b, off, len) {
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(b[off + i]);
  return s;
}
function indexOfAscii(b, str, from, to) {
  const end = Math.min(to, b.length - str.length);
  for (let i = from; i <= end; i++) {
    let ok = true;
    for (let j = 0; j < str.length; j++) if (b[i + j] !== str.charCodeAt(j)) { ok = false; break; }
    if (ok) return i;
  }
  return -1;
}
function findChunk(b, start, id) {
  let p = start;
  while (p + 8 <= b.length) {
    const cid = ascii(b, p, 4);
    const size = b[p + 4] | (b[p + 5] << 8) | (b[p + 6] << 16) | (b[p + 7] << 24);
    if (cid === id) return p;
    p += 8 + size + (size & 1);
  }
  return -1;
}

// MP4 : parcours de l'arbre d'atomes jusqu'à la sample entry (mp4a/alac…)
// dans moov/trak/mdia/minf/stbl/stsd. Le codec 4cc apparaît juste après
// l'en-tête stsd. L'atome moov peut être en fin de fichier, donc on parcourt
// tout, pas seulement le début.
function findMp4Codec(b) {
  const stsd = findAtom(b, 0, b.length, 'stsd');
  if (stsd >= 0) {
    // stsd : [size4][type4][version+flags 4][entryCount 4] puis 1re entrée :
    // [size4][format 4cc] -> le 4cc est à stsd+16
    const cc = ascii(b, stsd + 16, 4);
    if (['alac', 'mp4a', 'ac-3', 'ec-3'].includes(cc)) return cc;
  }
  // Fallback : scan complet du fichier (fiable même si l'arbre est atypique).
  if (indexOfAscii(b, 'alac', 0, b.length) >= 0) return 'alac';
  if (indexOfAscii(b, 'mp4a', 0, b.length) >= 0) return 'mp4a';
  if (indexOfAscii(b, 'ac-3', 0, b.length) >= 0) return 'ac-3';
  if (indexOfAscii(b, 'ec-3', 0, b.length) >= 0) return 'ec-3';
  return null;
}

// Parcours récursif des atomes MP4 (tailles en big-endian). Renvoie l'offset
// de début (du champ size) de l'atome `id`, ou -1.
function findAtom(b, start, end, id) {
  let p = start;
  while (p + 8 <= end) {
    let size = (b[p] * 0x1000000) + (b[p + 1] << 16) + (b[p + 2] << 8) + b[p + 3];
    const type = ascii(b, p + 4, 4);
    if (size === 1) { // 64-bit size : on saute la partie haute (fichiers < 4 Go)
      size = (b[p + 12] * 0x1000000) + (b[p + 13] << 16) + (b[p + 14] << 8) + b[p + 15];
      // contenu après l'en-tête étendu de 16 octets
      if (type === id) return p;
      if (isContainer(type)) { const r = findAtom(b, p + 16, Math.min(end, p + size), id); if (r >= 0) return r; }
    } else {
      if (size < 8) return -1;
      if (type === id) return p;
      if (isContainer(type)) { const r = findAtom(b, p + 8, Math.min(end, p + size), id); if (r >= 0) return r; }
    }
    p += size;
  }
  return -1;
}
function isContainer(t) {
  return ['moov', 'trak', 'mdia', 'minf', 'stbl', 'udta', 'edts'].includes(t);
}

function hasMp3Sync(b) {
  // saute un éventuel tag ID3v2
  let off = 0;
  if (ascii(b, 0, 3) === 'ID3') {
    const size = (b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9];
    off = 10 + size;
  }
  return off + 1 < b.length && b[off] === 0xff && (b[off + 1] & 0xe0) === 0xe0;
}

const MP3_BITRATES = { // V1 L3
  1: [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320,0]
};
const MP3_SR = { 0: 44100, 1: 48000, 2: 32000 };

function parseMp3(b, dv) {
  let start = 0;
  if (ascii(b, 0, 3) === 'ID3') {
    const size = (b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9];
    start = 10 + size; // fin du tag ID3v2 (taille "synchsafe")
  }
  // Cherche une frame MP3 VALIDE : un 0xFF isolé (padding, données de pochette
  // débordantes…) ne suffit pas, on vérifie tous les champs du header.
  const found = findValidMp3Frame(b, start) ?? findValidMp3Frame(b, 0);
  if (!found) return { container: 'MP3', codec: 'MP3', lossless: false,
                       bitrateKbps: null, sampleRate: null, bits: null,
                       note: 'MP3 — avec perte (débit non lu).' };

  const { off, brIndex, srIndex, headerBitrate, sr } = found;

  // VBR : le vrai débit moyen est dans le tag Xing (champ "Bytes"), pas dans le
  // header de la frame. Position du tag = off + (offset dépendant du mode).
  let vbr = false, bitrate = headerBitrate;
  const xTag = ascii(b, off + 36, 4) === 'Xing' || ascii(b, off + 21, 4) === 'Xing'
             ? 'Xing' : (ascii(b, off + 36, 4) === 'Info' ? 'Info' : null);
  if (xTag === 'Xing') vbr = true;

  return {
    container: 'MP3', codec: 'MP3 (Layer III)', lossless: false,
    bitrateKbps: bitrate, sampleRate: sr, bits: null, vbr,
    note: `MP3 — avec perte${bitrate ? ' (' + bitrate + ' kbps' + (vbr ? ' VBR' : '') + ')' : ''}.`
  };
}

// Scanne à partir de `from` et renvoie la 1re frame MP3 dont TOUS les champs
// sont valides (évite les faux 0xFF). Limite de recherche raisonnable.
function findValidMp3Frame(b, from) {
  const limit = Math.min(b.length - 4, from + 3_000_000);
  for (let off = from; off < limit; off++) {
    if (b[off] !== 0xff || (b[off + 1] & 0xe0) !== 0xe0) continue;
    const h1 = b[off + 1], h2 = b[off + 2];
    const version = (h1 >> 3) & 0x03;   // 3=MPEG1, 2=MPEG2, 0=MPEG2.5 (1=réservé)
    const layer = (h1 >> 1) & 0x03;     // 1=Layer III (0=réservé)
    const brIndex = (h2 >> 4) & 0x0f;
    const srIndex = (h2 >> 2) & 0x03;
    if (version === 1 || layer === 0) continue;      // valeurs réservées
    if (brIndex === 0 || brIndex === 15) continue;   // "free"/"bad"
    if (srIndex === 3) continue;                      // réservé
    // On ne gère finement que MPEG1 Layer III (le cas courant du MP3 musical).
    if (!(version === 3 && layer === 1)) continue;
    const headerBitrate = MP3_BITRATES[1][brIndex] || null;
    const sr = MP3_SR[srIndex] || null;
    if (!headerBitrate || !sr) continue;
    return { off, brIndex, srIndex, headerBitrate, sr };
  }
  return null;
}

window.readMetadata = readMetadata;

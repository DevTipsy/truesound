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

// MP4 : on cherche récursivement les atomes; les codecs sont des "sample
// entries" dans stsd (mp4a, alac, ...). On scanne simplement les 4cc connus.
function findMp4Codec(b) {
  for (const cc of ['alac', 'mp4a', 'ac-3', 'ec-3']) {
    if (indexOfAscii(b, cc, 0, Math.min(b.length, 200000)) >= 0) {
      // alac prime sur mp4a : un fichier ALAC contient les deux 4cc parfois,
      // mais 'alac' comme sample entry signe le lossless.
      if (cc === 'alac') return 'alac';
    }
  }
  if (indexOfAscii(b, 'mp4a', 0, Math.min(b.length, 200000)) >= 0) return 'mp4a';
  if (indexOfAscii(b, 'ac-3', 0, Math.min(b.length, 200000)) >= 0) return 'ac-3';
  if (indexOfAscii(b, 'ec-3', 0, Math.min(b.length, 200000)) >= 0) return 'ec-3';
  return null;
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
  let off = 0;
  if (ascii(b, 0, 3) === 'ID3') {
    const size = (b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9];
    off = 10 + size;
  }
  // trouver la sync
  while (off + 4 < b.length && !(b[off] === 0xff && (b[off + 1] & 0xe0) === 0xe0)) off++;
  if (off + 4 >= b.length) return null;

  const h1 = b[off + 1], h2 = b[off + 2];
  const versionBits = (h1 >> 3) & 0x03;      // 3 = MPEG1
  const layerBits = (h1 >> 1) & 0x03;         // 1 = Layer III
  const brIndex = (h2 >> 4) & 0x0f;
  const srIndex = (h2 >> 2) & 0x03;
  const isV1L3 = versionBits === 3 && layerBits === 1;
  const bitrate = isV1L3 ? (MP3_BITRATES[1][brIndex] || null) : null;
  const sr = MP3_SR[srIndex] || null;

  // détecter Xing/Info (VBR) : présent ~36 octets après la sync
  let vbr = false;
  const xingOff = off + 36;
  if (xingOff + 4 <= b.length) {
    const tag = ascii(b, xingOff, 4);
    if (tag === 'Xing' || tag === 'Info') vbr = (tag === 'Xing');
  }

  return {
    container: 'MP3', codec: 'MP3 (Layer III)', lossless: false,
    bitrateKbps: bitrate, sampleRate: sr, bits: null,
    vbr,
    note: `MP3 — avec perte${bitrate ? ' (' + bitrate + ' kbps' + (vbr ? ' VBR nominal' : '') + ')' : ''}.`
  };
}

window.readMetadata = readMetadata;

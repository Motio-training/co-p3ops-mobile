// Constantes du protocole étendu SportIdent.

export const CMD = {
  GET_BACKUP: 0x81,
  SET_SYS_VAL: 0x82,
  GET_SYS_VAL: 0x83,
  SET_TIME: 0xf6,
  GET_SI5: 0xb1, // lecture SI-Card 5
  TRANS_REC: 0xd3, // poinçon transmis (autosend / radio)
  GET_SI6: 0xe1, // lecture d'un bloc SI-Card 6
  SI5_DET: 0xe5, // SI-Card 5 insérée
  SI6_DET: 0xe6, // SI-Card 6 insérée
  SI_REM: 0xe7, // puce retirée
  SI8_DET: 0xe8, // SI-Card 8/9/10/11/pCard/tCard/SIAC insérée
  GET_SI8: 0xef, // lecture d'un bloc SI-Card 8 et suivantes
  SET_MS: 0xf0, // mode maître/esclave
  GET_MS: 0xf1,
  GET_TIME: 0xf7,
  BEEP: 0xf9,
};

export const MS_DIRECT = 0x4d; // « M » : la station maître répond directement
export const MS_REMOTE = 0x53; // « S » : les commandes passent au boîtier posé sur la station maître

// Fonctions programmables d'un boîtier (adresse système 0x71)
export const CONFIG_MODES = [
  { value: 0x02, label: 'Poste de contrôle' },
  { value: 0x32, label: 'Poste de contrôle sans contact (SIAC)' },
  { value: 0x03, label: 'Départ' },
  { value: 0x33, label: 'Départ sans contact (SIAC)' },
  { value: 0x04, label: 'Arrivée' },
  { value: 0x34, label: 'Arrivée sans contact (SIAC)' },
  { value: 0x07, label: 'Effacement' },
  { value: 0x0a, label: 'Vérification' },
  { value: 0x05, label: 'Lecture (mini reader)' },
];

export const MODE_NAMES = {
  0x01: 'SIAC spécial',
  0x02: 'Contrôle',
  0x03: 'Départ',
  0x04: 'Arrivée',
  0x05: 'Lecture',
  0x06: 'Effacement (ancien)',
  0x07: 'Effacement',
  0x0a: 'Vérification',
  0x0b: 'Impression',
  0x0c: 'Départ (déclencheur)',
  0x0d: 'Arrivée (déclencheur)',
  0x12: 'Contrôle (BC)',
  0x32: 'Contrôle sans contact',
  0x33: 'Départ sans contact',
  0x34: 'Arrivée sans contact',
};

/** Fonctions « poste de contrôle » (avec ou sans contact) : le numéro est celui d'une balise du circuit. */
export const isControlMode = (mode) => mode === 0x02 || mode === 0x32 || mode === 0x12;

export const MODE_READOUT = 0x05;

const MODELS = {
  0x8003: 'BSF3',
  0x8004: 'BSF4',
  0x8084: 'BSM4',
  0x8086: 'BSM6',
  0x8115: 'BSF5',
  0x8146: 'BSF6',
  0x8117: 'BSF7',
  0x8118: 'BSF8',
  0x8187: 'BS7-SI-Master',
  0x8188: 'BS8-SI-Master',
  0x8197: 'BSF7',
  0x8198: 'BSF8',
  0x9197: 'BSM7',
  0x9198: 'BSM8',
  0x9199: 'BS11',
  0x9597: 'BS7-S',
  0xb197: 'BS7-P',
  0xb198: 'BS8-P',
  0xb897: 'BS7-GSM',
  0xcd98: 'BS8-SRR',
};

export function modelName(id) {
  return MODELS[id] || (id ? `Station 0x${id.toString(16).toUpperCase()}` : 'Station SportIdent');
}

export const CARD_LABELS = {
  SI5: 'SI-Card 5',
  SI6: 'SI-Card 6',
  SI8: 'SI-Card 8',
  SI9: 'SI-Card 9',
  SI10: 'SI-Card 10',
  SI11: 'SI-Card 11',
  SIAC: 'SIAC',
  pCard: 'pCard',
  tCard: 'tCard',
  fCard: 'fCard',
};

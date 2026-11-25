// CRC 16 bits du protocole étendu SportIdent (polynôme 0x8005).
// Portage fidèle de l'algorithme du « SPORTident PC Programmer's Guide ».
// Le CRC porte sur CMD + LEN + DATA.
const POLYNOM = 0x8005;

export function crc16(data) {
  const n = data.length;
  if (n < 2) return 0;
  let crc = ((data[0] << 8) | data[1]) & 0xffff;
  if (n === 2) return crc;
  let i = 2;
  for (let k = n >> 1; k > 0; k--) {
    let val;
    if (k > 1) {
      val = ((data[i] << 8) | data[i + 1]) & 0xffff;
      i += 2;
    } else {
      val = n & 1 ? (data[i] << 8) & 0xffff : 0;
    }
    for (let b = 0; b < 16; b++) {
      if (crc & 0x8000) {
        crc = (crc << 1) & 0xffff;
        if (val & 0x8000) crc++;
        crc ^= POLYNOM;
      } else {
        crc = (crc << 1) & 0xffff;
        if (val & 0x8000) crc++;
      }
      val = (val << 1) & 0xffff;
    }
  }
  return crc & 0xffff;
}

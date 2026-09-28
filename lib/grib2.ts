// Minimal GRIB2 decoder for what NOAA GFS uses for surface fields: grid template 3.0 (regular
// lat/lon) + data template 5.3 (complex packing with spatial differencing), no bitmap.
// Spec: WMO Manual on Codes FM 92 GRIB2; algorithm mirrors NCEP g2clib comunpack.c.
// Anything else throws, so a format change fails loudly instead of drawing garbage.

export type Grib = { ni: number; nj: number; la1: number; lo1: number; dj: number; di: number; values: Float32Array };

class Bits {
  pos = 0; // bit offset
  constructor(private b: Uint8Array) {}
  read(n: number): number {
    let v = 0;
    for (let k = 0; k < n; k++) {
      const byte = this.b[(this.pos + k) >> 3];
      v = v * 2 + ((byte >> (7 - ((this.pos + k) & 7))) & 1);
    }
    this.pos += n;
    return v;
  }
  align() { this.pos = (this.pos + 7) & ~7; }
}

const u32 = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
const u16 = (b: Uint8Array, i: number) => (b[i] << 8) + b[i + 1];
// GRIB2 signed integers are sign-magnitude (top bit = sign), not two's complement
const s16 = (b: Uint8Array, i: number) => (b[i] & 0x80 ? -1 : 1) * (((b[i] & 0x7f) << 8) + b[i + 1]);
const s32 = (b: Uint8Array, i: number) => (b[i] & 0x80 ? -1 : 1) * (((b[i] & 0x7f) * 2 ** 24) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3]);
const signed = (v: number, bytes: number) => {
  const top = 2 ** (bytes * 8 - 1);
  return v >= top ? -(v - top) : v;
};

// Decode the first GRIB2 message in `b`.
export function decodeGrib2(b: Uint8Array): Grib {
  if (String.fromCharCode(...b.subarray(0, 4)) !== "GRIB" || b[7] !== 2) throw new Error("not GRIB2");
  let i = 16;
  let grid: Omit<Grib, "values"> | null = null;
  let tpl: Uint8Array | null = null; // section 5 bytes
  let npts = 0;
  let values: Float32Array | null = null;
  while (String.fromCharCode(...b.subarray(i, i + 4)) !== "7777") {
    const len = u32(b, i);
    const sec = b[i + 4];
    const s = b.subarray(i, i + len);
    if (sec === 3) {
      if (u16(s, 12) !== 0) throw new Error(`grid template ${u16(s, 12)} unsupported`);
      if (s[71] !== 0) throw new Error(`scanning mode ${s[71]} unsupported`); // W->E, N->S rows
      grid = {
        ni: u32(s, 30), nj: u32(s, 34),
        la1: s32(s, 46) / 1e6, lo1: s32(s, 50) / 1e6,
        di: u32(s, 63) / 1e6, dj: u32(s, 67) / 1e6,
      };
    } else if (sec === 5) {
      npts = u32(s, 5);
      if (u16(s, 9) !== 3) throw new Error(`data template 5.${u16(s, 9)} unsupported`);
      tpl = s;
    } else if (sec === 6) {
      if (s[5] !== 255) throw new Error("bitmap unsupported");
    } else if (sec === 7) {
      if (!tpl) throw new Error("section 7 before 5");
      values = unpackComplex(tpl, s.subarray(5), npts);
    }
    i += len;
  }
  if (!grid || !values) throw new Error("incomplete GRIB2 message");
  if (grid.ni * grid.nj !== values.length) throw new Error("grid/value count mismatch");
  return { ...grid, values };
}

function unpackComplex(t: Uint8Array, data: Uint8Array, npts: number): Float32Array {
  // Section 5, template 5.3 (0-based offsets within the section)
  const R = new DataView(t.buffer, t.byteOffset + 11, 4).getFloat32(0, false);
  const E = s16(t, 15), D = s16(t, 17);
  const refBits = t[19];
  if (t[22] !== 0) throw new Error("missing-value management unsupported");
  const ng = u32(t, 31);
  const widthRef = t[35], widthBits = t[36];
  const lenRef = u32(t, 37), lenInc = t[41], lastLen = u32(t, 42), lenBits = t[46];
  const order = t[47], extraOctets = t[48];

  const bits = new Bits(data);
  const ival: number[] = [];
  for (let k = 0; k < order; k++) ival.push(signed(bits.read(extraOctets * 8), extraOctets));
  const minsd = signed(bits.read(extraOctets * 8), extraOctets);

  const refs = new Int32Array(ng);
  for (let g = 0; g < ng; g++) refs[g] = bits.read(refBits);
  bits.align();
  const widths = new Int32Array(ng);
  for (let g = 0; g < ng; g++) widths[g] = widthRef + bits.read(widthBits);
  bits.align();
  const lens = new Int32Array(ng);
  for (let g = 0; g < ng; g++) lens[g] = lenRef + lenInc * bits.read(lenBits);
  lens[ng - 1] = lastLen;
  bits.align();

  const x = new Float64Array(npts);
  let n = 0;
  for (let g = 0; g < ng; g++)
    for (let k = 0; k < lens[g]; k++) x[n++] = refs[g] + (widths[g] ? bits.read(widths[g]) : 0);
  if (n !== npts) throw new Error(`unpacked ${n} of ${npts} values`);

  // Undo spatial differencing
  if (order === 1) {
    x[0] = ival[0];
    for (let k = 1; k < npts; k++) x[k] = x[k] + minsd + x[k - 1];
  } else if (order === 2) {
    x[0] = ival[0];
    x[1] = ival[1];
    for (let k = 2; k < npts; k++) x[k] = x[k] + minsd + 2 * x[k - 1] - x[k - 2];
  } else throw new Error(`spatial differencing order ${order} unsupported`);

  const out = new Float32Array(npts);
  const bscale = 2 ** E, dscale = 10 ** -D;
  for (let k = 0; k < npts; k++) out[k] = (R + x[k] * bscale) * dscale;
  return out;
}

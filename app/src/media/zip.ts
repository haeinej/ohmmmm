// A .zip with every file stored as it is. Images are compressed already, and storing keeps the
// archive quick to build inside a drag, with no dependency. Names are UTF-8.

const TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) crc = TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

export type ZipEntry = { name: string; bytes: Uint8Array; crc?: number }

/** The archive's bytes. `when` sets every entry's date, so the same files make the same archive. */
export function zip(entries: readonly ZipEntry[], when = new Date()): Uint8Array {
  const time = (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1)
  const date = ((Math.max(1980, when.getFullYear()) - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate()
  const encoder = new TextEncoder()
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const entry of entries) {
    const name = encoder.encode(entry.name)
    const crc = entry.crc ?? crc32(entry.bytes)
    const size = entry.bytes.length
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true)
    local.setUint16(6, 0x0800, true) // the name is UTF-8
    local.setUint16(8, 0, true) // stored
    local.setUint16(10, time, true)
    local.setUint16(12, date, true)
    local.setUint32(14, crc, true)
    local.setUint32(18, size, true)
    local.setUint32(22, size, true)
    local.setUint16(26, name.length, true)
    parts.push(new Uint8Array(local.buffer), name, entry.bytes)
    const record = new DataView(new ArrayBuffer(46))
    record.setUint32(0, 0x02014b50, true)
    record.setUint16(4, 20, true)
    record.setUint16(6, 20, true)
    record.setUint16(8, 0x0800, true)
    record.setUint16(10, 0, true)
    record.setUint16(12, time, true)
    record.setUint16(14, date, true)
    record.setUint32(16, crc, true)
    record.setUint32(20, size, true)
    record.setUint32(24, size, true)
    record.setUint16(28, name.length, true)
    record.setUint32(42, offset, true)
    central.push(new Uint8Array(record.buffer), name)
    offset += 30 + name.length + size
  }
  const directory = central.reduce((sum, part) => sum + part.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, entries.length, true)
  end.setUint16(10, entries.length, true)
  end.setUint32(12, directory, true)
  end.setUint32(16, offset, true)
  const all = [...parts, ...central, new Uint8Array(end.buffer)]
  const out = new Uint8Array(all.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of all) { out.set(part, at); at += part.length }
  return out
}

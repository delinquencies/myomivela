import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { stripJpeg, stripPng, stripWebp } from '../lib/image.mjs';
import { startServer, adminLogin, password, iso, hours } from './helpers.mjs';

function exifSegment(orientation) {
  const tiff = Buffer.concat([
    Buffer.from([0x49,0x49,0x2a,0,8,0,0,0, 2,0]),
    Buffer.from([0x12,0x01,3,0,1,0,0,0,orientation,0,0,0]),
    Buffer.from([0x25,0x88,4,0,1,0,0,0,26,0,0,0]),
    Buffer.from([0,0,0,0]),
    Buffer.from('GPSLatitude=42.36N GPSLongitude=71.05W'),
  ]);
  const payload = Buffer.concat([Buffer.from('Exif\0\0','latin1'), tiff]);
  const header = Buffer.from([0xff,0xe1,0,0]); header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}
const comment = Buffer.concat([Buffer.from([0xff,0xfe,0,9]), Buffer.from('secret!')]);
const dqt = Buffer.concat([Buffer.from([0xff,0xdb,0,4,0,1])]);
const sos = Buffer.from([0xff,0xda,0,4,0,0, 1,2,3,0xff,0xd9]);
const jpeg = orientation => Buffer.concat([Buffer.from([0xff,0xd8]), Buffer.from([0xff,0xe0,0,4,0x4a,0x46]), exifSegment(orientation), comment, dqt, sos]);

test('JPEG: GPS, EXIF and comments are removed; orientation survives; image data is untouched', () => {
  const out = stripJpeg(jpeg(6));
  assert.ok(!out.includes('GPSLatitude') && !out.includes('secret!'));
  assert.ok(out.includes(Buffer.from([0x01,0x12,0,3,0,0,0,1,0,6])), 'orientation tag retained');
  assert.ok(out.includes(dqt) && out.includes(sos));
  assert.deepEqual([...out.subarray(0,2)], [0xff,0xd8]);
  assert.deepEqual([...out.subarray(2,4)], [0xff,0xe0], 'JFIF header stays first');
});
test('JPEG: orientation 1 needs no EXIF at all', () => {
  const out = stripJpeg(jpeg(1));
  assert.ok(!out.includes('Exif'));
});
test('JPEG: truncated or corrupt input is rejected', () => {
  assert.throws(() => stripJpeg(Buffer.from([0xff,0xd8,0xff,0xe1,0xff,0xff,1,2])));
});
test('PNG: text and EXIF chunks are removed, others kept', () => {
  const chunk = (type, data) => { const h = Buffer.alloc(8); h.writeUInt32BE(data.length,0); h.write(type,4,'ascii'); return Buffer.concat([h,data,Buffer.alloc(4)]); };
  const png = Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'), chunk('IHDR',Buffer.alloc(13)), chunk('eXIf',Buffer.from('GPSLatitude')), chunk('tEXt',Buffer.from('Author\0me')), chunk('IDAT',Buffer.from('data')), chunk('IEND',Buffer.alloc(0))]);
  const out = stripPng(png);
  assert.ok(!out.includes('GPSLatitude') && !out.includes('Author'));
  assert.ok(out.includes('IDAT') && out.includes('IHDR') && out.includes('IEND'));
});
test('WebP: EXIF and XMP chunks are removed, size and flags updated', () => {
  const chunk = (type, data) => { const h = Buffer.alloc(8); h.write(type,0,'ascii'); h.writeUInt32LE(data.length,4); return Buffer.concat([h,data,data.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]); };
  const vp8x = Buffer.alloc(10); vp8x[0] = 0x2c;
  const body = Buffer.concat([Buffer.from('WEBP'), chunk('VP8X',vp8x), chunk('VP8 ',Buffer.from('imagedat')), chunk('EXIF',Buffer.from('GPSLatitude')), chunk('XMP ',Buffer.from('xmp!'))]);
  const header = Buffer.from('RIFF\0\0\0\0'); header.writeUInt32LE(body.length,4);
  const out = stripWebp(Buffer.concat([header, body]));
  assert.ok(!out.includes('GPSLatitude') && !out.includes('xmp!'));
  assert.equal(out.readUInt32LE(4), out.length - 8);
  assert.equal(out[20] & 0x0c, 0, 'EXIF/XMP flags cleared');
  assert.equal(out[20] & 0x20, 0x20, 'other flags kept');
});

let app;
before(async () => { app = await startServer(); await app.call('s','POST','/api/login',adminLogin); });
after(() => app.stop());
test('uploaded photos are stored without GPS metadata', async () => {
  const { call } = app;
  await call('s','POST','/api/services',{ name:'Dog walking', minutes:30, cents:3000 });
  const starts = Date.now() + hours(72);
  await call('s','POST','/api/slots',{ starts:iso(starts), ends:iso(starts + hours(1)) });
  await call('c','POST','/api/register',{ name:'c', email:'c@example.test', password });
  await call('c','POST','/api/pets',{ name:'Rex', species:'Dog', details:'{}' });
  const data = (await call('c','GET','/api/portal')).json;
  const slot = data.slots[0];
  const booking = await call('c','POST','/api/bookings',{ service:data.services[0].id, cents:3000, pets:[data.pets[0].id], slot:slot.id, start:slot.starts, notes:'' });
  const id = booking.json.id;
  await call('s','POST','/api/status',{ id, status:'Confirmed' });
  await call('s','POST','/api/status',{ id, status:'In Progress' });
  const upload = await call('s','POST','/api/events',{ id, pet:data.pets[0].id, kind:'Observation', notes:'', photo:'data:image/jpeg;base64,'+jpeg(6).toString('base64') });
  assert.equal(upload.status, 200);
  const eventId = (await call('c','GET','/api/diary')).json.events[0].id;
  const photo = await call('c','GET','/api/photos/'+eventId);
  assert.equal(photo.status, 200);
  assert.equal(photo.headers.get('cache-control'), 'private, max-age=3600', 'photos may be cached privately');
  assert.ok(!photo.bytes.includes('GPSLatitude'), 'GPS removed before storage');
  const garbage = await call('s','POST','/api/events',{ id, pet:data.pets[0].id, kind:'Observation', notes:'', photo:'data:image/jpeg;base64,'+Buffer.from([0xff,0xd8,0xff,0xe1,0xff,0xff,1]).toString('base64') });
  assert.equal(garbage.status, 400, 'corrupt JPEG is refused');
});

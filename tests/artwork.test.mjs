import test from 'node:test';
import assert from 'node:assert/strict';
import { validateArtwork, validateSnapshot, NEBULA_SEED, artworkCard, validateCard } from '../src/artwork.ts';
import { pixelsToParticles } from '../src/photoToParticles.ts';

const base = () => ({ version: 1, id: 'fictional-artwork', title: '虚构作品', createdAt: 123456,
  thumbnail: 'data:image/jpeg;base64,/9j/2Q==', scene: { version: 1, kind: 'nebula', seed: NEBULA_SEED,
    phase: 18.25, visual: { dispersion: 0.3, motion: 0.2, warmth: 0.7 }, photo: null } });
function photoWork() {
  const data = new Uint8ClampedArray(8 * 6 * 4).fill(255);
  const photo = pixelsToParticles({ width: 8, height: 6, data }, 8 / 6);
  return { ...base(), scene: { ...base().scene, kind: 'photo', photo } };
}
test('snapshot retains deterministic phase, source and bounded artwork parameters', () => {
  const work = validateArtwork(base());
  assert.deepEqual(work, base());
  assert.deepEqual(validateArtwork(structuredClone(work)), work);
  for (const change of [{ version: 2 }, { seed: 1 }, { phase: NaN }, { phase: -1 }, { kind: 'unknown' }, { visual: {} }]) {
    assert.throws(() => validateSnapshot({ ...work.scene, ...change }));
  }
});
test('photo round-trip retains every render attribute and never shares mutable buffers', () => {
  const original = photoWork(), work = validateArtwork(original);
  const restored = validateArtwork(structuredClone(work));
  assert.deepEqual(restored, work);
  for (const key of ['positions', 'colors', 'alphas', 'sizes', 'phases', 'flows', 'glows']) {
    assert.notEqual(work.scene.photo[key].buffer, original.scene.photo[key].buffer);
    assert.deepEqual(restored.scene.photo[key], original.scene.photo[key]);
  }
  original.scene.photo.positions[0] = 100;
  assert.notEqual(work.scene.photo.positions[0], 100);
});
test('mismatched lengths, nonfinite points, unknown versions and excessive samples cannot reach renderer', () => {
  const work = photoWork();
  for (const key of ['positions', 'colors', 'alphas', 'sizes', 'phases', 'flows', 'glows']) {
    const broken = structuredClone(work); broken.scene.photo[key][0] = Infinity;
    assert.throws(() => validateArtwork(broken));
  }
  const broken = structuredClone(work); broken.scene.photo.colors = new Float32Array(3);
  assert.throws(() => validateArtwork(broken));
  assert.throws(() => validateArtwork({ ...work, scene: { ...work.scene, photo: { ...work.scene.photo, sampledWidth: 361 } } }));
});
test('storage projection drops conversations, recordings, original images and unknown properties', () => {
  const value = { ...photoWork(), conversation: 'fictional private sentence', recording: 'fictional audio', apiKey: 'fictional key' };
  value.scene.photo.originalImage = 'fictional original file';
  const result = validateArtwork(value);
  assert.deepEqual(Object.keys(result).sort(), ['version', 'id', 'title', 'createdAt', 'thumbnail', 'scene'].sort());
  assert.equal(result.scene.photo.originalImage, undefined);
  const card = validateCard(artworkCard(result));
  assert.equal(card.scene, undefined); assert.equal(card.removedAt, null);
  assert.equal(validateCard({ ...card, removedAt: 54321 }).removedAt, 54321);
});
test('invalid titles, unsafe preview URLs and unsupported card schema leave records unreadable instead of executing', () => {
  for (const patch of [{ title: '' }, { title: 'x'.repeat(41) }, { thumbnail: 'https://foreign.invalid/photo' },
    { thumbnail: 'data:text/html;base64,SGVsbG8=' }, { id: '../bad' }, { createdAt: NaN }]) {
    assert.throws(() => validateArtwork({ ...base(), ...patch }));
  }
  assert.throws(() => validateCard({ ...artworkCard(validateArtwork(base())), version: 99 }));
});
const reliefWork = () => ({ ...base(), version: 3, scene: { version: 3, kind: 'relief', seed: NEBULA_SEED, phase: 4.5,
  visual: { dispersion: 0.4, motion: 0.6, warmth: 0.3, openness: 0.5, tension: 0.5, coherence: 0.5, weight: 0.5, luminosity: 0.7 },
  photo: null, relief: { image: 'data:image/jpeg;base64,/9j/2Q==', width: 768, height: 512 } } });
test('v3 relief keeps its downscaled photo and full parameters, while v1/v2 rules stay unchanged', () => {
  const work = validateArtwork(reliefWork());
  assert.deepEqual(validateArtwork(structuredClone(work)), work);
  assert.equal(work.scene.relief.image, reliefWork().scene.relief.image);
  assert.equal(validateCard(artworkCard(work)).kind, 'relief');
  assert.equal('relief' in validateArtwork(base()).scene, false);
  const scene = reliefWork().scene;
  for (const change of [
    { relief: { ...scene.relief, image: 'https://foreign.invalid/photo.jpg' } },
    { relief: { ...scene.relief, image: 'data:image/jpeg;base64,' + 'A'.repeat(330_001) } },
    { relief: { ...scene.relief, width: 1025 } }, { relief: { ...scene.relief, height: 1.5 } },
    { relief: undefined }, { photo: photoWork().scene.photo }, { kind: 'photo' }, { kind: 'nebula', relief: undefined },
    { version: 2 },
  ]) assert.throws(() => validateSnapshot({ ...scene, ...change }));
  assert.throws(() => validateSnapshot({ ...base().scene, relief: scene.relief }));
});
test('v3 sculpture is a seeded default form without photo data; old nebula records keep their own kind', () => {
  const scene = { ...reliefWork().scene, kind: 'sculpture', relief: undefined };
  delete scene.relief;
  const work = validateArtwork({ ...reliefWork(), scene });
  assert.equal(work.scene.kind, 'sculpture');
  assert.equal('relief' in work.scene, false);
  assert.equal(validateCard(artworkCard(work)).kind, 'sculpture');
  assert.throws(() => validateSnapshot({ ...scene, relief: reliefWork().scene.relief }));
  assert.throws(() => validateSnapshot({ ...scene, photo: photoWork().scene.photo }));
  assert.throws(() => validateSnapshot({ ...scene, version: 2 }));
  assert.equal(validateArtwork(base()).scene.kind, 'nebula');
});
test('optional AI summary is kept on works and cards, bounded, and absent on older records', () => {
  const work = validateArtwork({ ...base(), summary: '  你终于把那件事说出口了。 ' });
  assert.equal(work.summary, '你终于把那件事说出口了。');
  assert.equal(validateCard(artworkCard(work)).summary, '你终于把那件事说出口了。');
  assert.equal('summary' in validateArtwork(base()), false);
  assert.equal('summary' in artworkCard(validateArtwork(base())), false);
  for (const summary of ['', '   ', 'x'.repeat(121), 42]) assert.throws(() => validateArtwork({ ...base(), summary }));
});

test('a sculpture keeps the imagery the model chose; older sculptures and photos never carry one', () => {
  const visual = { dispersion: 0.4, motion: 0.6, warmth: 0.8, openness: 0.5, tension: 0.7, coherence: 0.5, weight: 0.5, luminosity: 0.7 };
  const scene = { version: 3, kind: 'sculpture', seed: NEBULA_SEED, phase: 2, visual, photo: null };
  const form = { image: 'flame', name: '压着的火', variant: 0.42 };
  const work = validateArtwork({ ...base(), version: 3, scene: { ...scene, form } });
  assert.deepEqual(validateArtwork(structuredClone(work)).scene.form, form);
  assert.equal('form' in validateArtwork({ ...base(), version: 3, scene }).scene, false);
  for (const bad of [{ image: 'unknown', name: 'x', variant: 0 }, null, 'flame']) {
    assert.throws(() => validateArtwork({ ...base(), version: 3, scene: { ...scene, form: bad } }));
  }
  assert.throws(() => validateArtwork({ ...reliefWork(), scene: { ...reliefWork().scene, form } }));
});

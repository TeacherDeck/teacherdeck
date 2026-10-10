// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { connect } from '@deck/sdk';
import { createMockHost } from '@deck/sdk/testing';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_OPTIONS, SETTINGS_KEY, chooseOutput, loadOptions, runBatch, saveOptions } from './batch.ts';
import { dimensions, imageHeader, outputName, signatureExtension } from './image.ts';
const file = { handle: 'input-a', name: 'sample.png', ext: 'png', size: 4, modifiedAt: 0 };
function setup() {
  const store = new Map<string, unknown>();
  const host = createMockHost({ module: { id: 'image-compress', version: '0.1.0' }, caps: { fs: '1.1.0', storage: '1.0.0' }, granted: ['fs', 'storage'], handlers: {
    'storage.get': (args) => store.get((args as {key: string}).key) ?? null,
    'storage.set': (args) => { const {key, value} = args as {key: string; value: unknown}; store.set(key, value); return null; },
    'fs.createOutputFolder': () => ({ batchId: 'batch', folder: { handle: 'output', name: '압축 이미지' } }),
    'fs.closeOutputFolder': () => null,
  } });
  return {host, store};
}
describe('image compression', () => {
  it('scales down without enlarging and rejects oversized decoding', () => {
    expect(dimensions(4000, 2000, 1600)).toEqual({width: 1600, height: 800});
    expect(dimensions(400, 200, 1600)).toEqual({width: 400, height: 200});
    expect(() => dimensions(10000, 10000, 1600)).toThrow();
  });
  it('keeps originals when compression offers no saving and sanitizes names', () => {
    const original = new Blob(['1234']);
    expect(chooseOutput(original, new Blob(['1234']), 'sample.png', 'png').blob).toBe(original);
    expect(chooseOutput(original, new Blob(['12'], {type: 'image/webp'}), 'sample.png', 'png').name).toBe('sample_작게.webp');
    expect(outputName('../sample', 'webp')).not.toContain('/');
  });
  it('names an unchanged PNG copy by its bytes even when the picked extension is JPG', () => {
    const bytes = new Uint8Array([137,80,78,71,13,10,26,10]);
    const original = new Blob([bytes]);
    const output = chooseOutput(original,new Blob([bytes]),'sample.jpg',signatureExtension(bytes));
    expect(output.name).toBe('sample_작게.png'); expect(output.keptOriginal).toBe(true);
    expect(signatureExtension(new Uint8Array([255,216,255]))).toBe('jpg');
    expect(() => signatureExtension(new Uint8Array([0,1,2]))).toThrow('INVALID_IMAGE');
  });
  it('checks synthetic PNG dimensions and rejects APNG and unknown bytes', () => {
    const bytes = new Uint8Array(45); bytes.set([137,80,78,71]); bytes.set([73,72,68,82],12);
    const view = new DataView(bytes.buffer); view.setUint32(8,13); view.setUint32(16,20); view.setUint32(20,10);
    expect(imageHeader(bytes)).toMatchObject({width: 20, height: 10, ext: 'png'});
    bytes.set([97,99,84,76],37);
    expect(() => imageHeader(bytes)).toThrow('ANIMATED_IMAGE');
    expect(() => imageHeader(new Uint8Array([0,1,2]))).toThrow();
  });
  it('loads and saves settings through the mock host', async () => {
    const {host,store} = setup(); const deck = await connect({window: host.window});
    expect(await loadOptions(deck)).toEqual(DEFAULT_OPTIONS);
    await saveOptions(deck, {...DEFAULT_OPTIONS,quality: 70}); expect(store.get(SETTINGS_KEY)).toMatchObject({quality: 70});
    store.set(SETTINGS_KEY,{quality: 999}); expect(await loadOptions(deck)).toEqual(DEFAULT_OPTIONS); deck.dispose();
  });
  it('continues after individual failure and closes the output grant', async () => {
    const {host} = setup(); const deck = await connect({window: host.window});
    vi.spyOn(deck.fs, 'readChunks').mockImplementation(async function* () { yield new Uint8Array([1,2,3,4]); });
    const write = vi.spyOn(deck.fs, 'writeBlob').mockImplementation(async ({blob}) => ({...file,handle:'saved',size:blob.size}));
    const encoder = vi.fn().mockRejectedValueOnce(new Error('BAD_INPUT')).mockResolvedValue(new Blob(['12'],{type:'image/webp'}));
    const output = await runBatch(deck,[file,{...file,handle:'input-b'}],'parent',DEFAULT_OPTIONS,new AbortController().signal,encoder,()=>undefined);
    expect(output.results.map((result)=>result.status)).toEqual(['failed','compressed']); expect(write).toHaveBeenCalledOnce();
    expect(host.requests.at(-1)?.method).toBe('closeOutputFolder'); deck.dispose();
  });
  it('handles 500 files sequentially with bounded reads', async () => {
    const {host} = setup(); const deck = await connect({window: host.window});
    vi.spyOn(deck.fs,'readChunks').mockImplementation(async function* () { yield new Uint8Array([1,2,3,4]); });
    const write = vi.spyOn(deck.fs,'writeBlob').mockImplementation(async ({blob}) => ({...file,handle:'saved',size:blob.size}));
    const progress = vi.fn();
    const output = await runBatch(deck,Array.from({length:500},(_,i)=>({...file,handle:`input-${i}`})),'parent',DEFAULT_OPTIONS,new AbortController().signal,async()=>new Blob(['12'],{type:'image/webp'}),progress);
    expect(output.results).toHaveLength(500); expect(write).toHaveBeenCalledTimes(500); expect(progress).toHaveBeenCalledTimes(500);
    expect(host.requests.filter((request)=>request.method==='createOutputFolder')).toHaveLength(1); deck.dispose();
  });
  it('cancels an active image before writing and retains previous results', async () => {
    const {host} = setup(); const deck = await connect({window: host.window}); const abort = new AbortController();
    vi.spyOn(deck.fs,'readChunks').mockImplementation(async function* () { yield new Uint8Array([1,2,3,4]); });
    const write = vi.spyOn(deck.fs,'writeBlob');
    const output = await runBatch(deck,[file],'parent',DEFAULT_OPTIONS,abort.signal,async()=>{abort.abort();throw new Error('CANCELLED');},()=>undefined);
    expect(output.results).toEqual([]); expect(write).not.toHaveBeenCalled(); expect(host.requests.at(-1)?.method).toBe('closeOutputFolder'); deck.dispose();
  });
});
// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { describe, expect, it } from 'vitest';
import { connect } from './client.ts';
import { createMockHost } from './testing.ts';
import { DeckCallError } from './protocol.ts';
describe('clipboard output helpers', () => {
  it('sends only the approved typed write methods through the bridge', async () => {
    const host = createMockHost({granted:['clipboard'], handlers:{'clipboard.writeText':()=>null,'clipboard.writeRichText':()=>null}});
    const deck = await connect({window:host.window});
    expect(deck.has('clipboard')).toBe(true);
    await deck.clipboard.writeText({text:'합성 문서'});
    const args = {plainText:'가상 발언',blocks:[{kind:'paragraph' as const,runs:[{text:'가상 화자',bold:true},{text:'\n발언'}]}]};
    await deck.clipboard.writeRichText(args);
    expect(host.requests).toEqual([{cap:'clipboard',method:'writeText',args:{text:'합성 문서'}},{cap:'clipboard',method:'writeRichText',args}]);
    expect(Object.keys(deck.clipboard).sort()).toEqual(['writeRichText','writeText']); deck.dispose();
  });
  it('refuses an undeclared clipboard before posting a request', async () => {
    const host = createMockHost({granted:['storage']}); const deck = await connect({window:host.window});
    expect(deck.has('clipboard')).toBe(false);
    await expect(deck.clipboard.writeText({text:'가상'})).rejects.toMatchObject({code:'PERMISSION_DENIED'});
    expect(host.requests).toHaveLength(0); deck.dispose();
  });
  it('returns fixed host errors without claiming a successful copy', async () => {
    const host = createMockHost({granted:['clipboard'],handlers:{'clipboard.writeText':()=>{throw new DeckCallError('BUSY','잠시 후 다시 복사해 주세요.');}}});
    const deck = await connect({window:host.window});
    await expect(deck.clipboard.writeText({text:'가상'})).rejects.toMatchObject({code:'BUSY'}); deck.dispose();
  });
  it('preserves the existing envelope size guard', async () => {
    const host = createMockHost({granted:['clipboard']}); const deck = await connect({window:host.window});
    await expect(deck.clipboard.writeText({text:'a'.repeat(1024*1024)})).rejects.toMatchObject({code:'INVALID_ARGS'});
    expect(host.requests).toHaveLength(0); deck.dispose();
  });
});
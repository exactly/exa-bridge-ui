import { MultiProtocolProvider, Token } from '@hyperlane-xyz/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EXA_ROUTER_ADDRESS, EXA_TOKEN_ADDRESS, EXA_WARP_ROUTE_ID } from '../../consts/exa';
import type { QuoteParams } from '../api/RouterClient';
import {
  AvailableRoutesResponseSchema,
  ChainsResponseSchema,
  TokensResponseSchema,
} from '../api/types';
import { validateRouteSecurity } from '../routeSecurity/validateRouteSecurity';
import { EXA_CHAINS, LocalExaEngine, ExaRoute } from './engine';

const engine = new LocalExaEngine();
engine.setMultiProvider({} as MultiProtocolProvider);

const AMOUNT = 1000000000000000000n;
const IGP_AMOUNT = 30000000000000n;
const TX_DATA = '0xdeadbeef';

const quoteParams: QuoteParams = {
  srcChain: 10,
  dstChain: 8453,
  srcToken: EXA_TOKEN_ADDRESS,
  dstToken: EXA_TOKEN_ADDRESS,
  amount: AMOUNT,
  sender: '0x1111111111111111111111111111111111111111',
};

function stubAdapter() {
  return vi.spyOn(Token.prototype, 'getHypAdapter').mockReturnValue({
    quoteTransferRemoteGas: async () => ({
      igpQuote: { amount: IGP_AMOUNT, addressOrDenom: undefined },
    }),
    populateTransferRemoteTx: async () => ({
      to: EXA_ROUTER_ADDRESS,
      data: TX_DATA,
      value: IGP_AMOUNT,
    }),
  } as unknown as ReturnType<Token['getHypAdapter']>);
}

const securityContext = {
  chainMetadata: {},
  chainAddresses: {},
  registryWarpRoutes: ExaRoute({}),
  chains: EXA_CHAINS,
  srcChain: 10,
  dstChain: 8453,
  srcToken: EXA_TOKEN_ADDRESS,
  dstToken: EXA_TOKEN_ADDRESS,
};

afterEach(() => vi.restoreAllMocks());

describe('LocalExaEngine discovery', () => {
  it('serves schema-valid chains and tokens', async () => {
    ChainsResponseSchema.parse(await engine.chains());
    const { tokens } = TokensResponseSchema.parse(await engine.tokens());
    expect(tokens.map((t) => t.chainId)).toEqual([10, 8453]);
    for (const token of tokens) expect(token.address).toBe(EXA_TOKEN_ADDRESS);
  });

  it('filters tokens by chain and ids', async () => {
    expect((await engine.tokens({ chain: 10 })).tokens.map((t) => t.chainId)).toEqual([10]);
    expect((await engine.tokens({ chain: 'base' })).tokens.map((t) => t.chainId)).toEqual([8453]);
    expect((await engine.tokens({ chain: 1 })).tokens).toEqual([]);
    expect((await engine.tokens({ search: 'exa' })).tokens.map((t) => t.chainId)).toEqual([
      10, 8453,
    ]);
    expect(
      (await engine.tokens({ chain: 10, search: 'exactly' })).tokens.map((t) => t.chainId),
    ).toEqual([10]);
    expect((await engine.tokens({ search: 'usdc' })).tokens).toEqual([]);
    expect(
      (await engine.tokens({ ids: [`optimism-${EXA_TOKEN_ADDRESS.toLowerCase()}`] })).tokens.map(
        (t) => t.chainId,
      ),
    ).toEqual([10]);
  });

  it('returns the opposite chain token for available routes', async () => {
    const fromSource = await engine.availableRoutes({
      srcChain: 10,
      srcToken: EXA_TOKEN_ADDRESS,
    });
    AvailableRoutesResponseSchema.parse(fromSource);
    expect(fromSource.direction).toBe('fromSource');
    expect(fromSource.tokens.map((t) => t.chainId)).toEqual([8453]);

    const toDestination = await engine.availableRoutes({
      dstChain: 8453,
      dstToken: EXA_TOKEN_ADDRESS.toLowerCase(),
    });
    expect(toDestination.direction).toBe('toDestination');
    expect(toDestination.tokens.map((t) => t.chainId)).toEqual([10]);

    const unknown = await engine.availableRoutes({ srcChain: 10, srcToken: EXA_ROUTER_ADDRESS });
    expect(unknown.tokens).toEqual([]);
  });
});

describe('LocalExaEngine quote', () => {
  it('builds a single warpDirect bridge step with no approval', async () => {
    stubAdapter();
    const { routes, expiresAt } = await engine.quote(quoteParams);
    expect(expiresAt).toBeGreaterThan(Date.now() / 1000);
    expect(routes).toHaveLength(1);
    const route = routes[0];
    expect(route.executionKind).toBe('warpDirect');
    expect(route.approval).toBeNull();
    expect(route.output).toBe(AMOUNT.toString());
    expect(route.tx).toEqual({
      to: EXA_ROUTER_ADDRESS,
      data: TX_DATA,
      value: IGP_AMOUNT.toString(),
    });
    expect(route.steps).toHaveLength(1);
    const step = route.steps[0];
    if (step.type !== 'bridge') throw new Error('expected bridge step');
    expect(step.asset).toBe(EXA_TOKEN_ADDRESS);
    expect(step.router).toBe(EXA_ROUTER_ADDRESS);
    expect(step.warpRouteId).toBe(EXA_WARP_ROUTE_ID);
    expect(step.fee.igpAmount).toBe(IGP_AMOUNT.toString());
  });

  it('returns no routes for unsupported chains or tokens', async () => {
    const spy = stubAdapter();
    expect((await engine.quote({ ...quoteParams, dstChain: 1 })).routes).toEqual([]);
    expect((await engine.quote({ ...quoteParams, dstChain: 10 })).routes).toEqual([]);
    expect((await engine.quote({ ...quoteParams, srcToken: EXA_ROUTER_ADDRESS })).routes).toEqual(
      [],
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it('passes validateRouteSecurity with the injected registry route', async () => {
    stubAdapter();
    const { routes } = await engine.quote(quoteParams);
    expect(validateRouteSecurity(routes[0], securityContext)).toEqual({ valid: true });
  });

  it('rejects a tampered tx target', async () => {
    stubAdapter();
    const { routes } = await engine.quote(quoteParams);
    const route = {
      ...routes[0],
      tx: { ...routes[0].tx!, to: '0x000000000000000000000000000000000000dEaD' },
    };
    expect(validateRouteSecurity(route, securityContext).valid).toBe(false);
  });
});

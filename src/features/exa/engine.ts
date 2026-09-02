import { MultiProtocolProvider, Token, TokenStandard } from '@hyperlane-xyz/sdk';

import { EXA_ROUTER_ADDRESS, EXA_TOKEN_ADDRESS, EXA_WARP_ROUTE_ID } from '../../consts/exa';
import type { AvailableRoutesParams, QuoteParams, RouterClient } from '../api/RouterClient';
import type {
  AvailableRoutesResponse,
  ChainDiscovery,
  ChainsResponse,
  QuoteResponse,
  ReadinessResponse,
  RouteResponse,
  TokenDiscovery,
  TokensQuery,
  TokensResponse,
} from '../api/types';
import type { RegistryWarpRouteMap } from '../warpRoutes/registryWarpRoutes';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const QUOTE_TTL_SECONDS = 45;

export const EXA_CHAINS: ChainDiscovery[] = [
  {
    id: 10,
    name: 'optimism',
    chainName: 'optimism',
    displayName: 'Optimism',
    protocol: 'ethereum',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    universalRouter: ZERO_ADDRESS,
    dex: null,
    canSwap: false,
    canExecute: true,
    supportsNative: false,
    gasCurrencyCoinGeckoId: 'ethereum',
    blockExplorers: [{ name: 'Etherscan', url: 'https://optimistic.etherscan.io' }],
  },
  {
    id: 8453,
    name: 'base',
    chainName: 'base',
    displayName: 'Base',
    protocol: 'ethereum',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    universalRouter: ZERO_ADDRESS,
    dex: null,
    canSwap: false,
    canExecute: true,
    supportsNative: false,
    gasCurrencyCoinGeckoId: 'ethereum',
    blockExplorers: [{ name: 'Basescan', url: 'https://basescan.org' }],
  },
];

export const EXA_TOKENS: TokenDiscovery[] = EXA_CHAINS.map((chain) => ({
  chainId: chain.id,
  address: EXA_TOKEN_ADDRESS,
  symbol: 'EXA',
  name: 'exactly',
  decimals: 18,
  isNative: false,
  isBridgeToken: true,
  isPoolToken: false,
  canBridge: true,
  canSwap: false,
  bridgeSymbols: ['EXA'],
  warpRouteIds: [EXA_WARP_ROUTE_ID],
  logoURI: '/logos/exa.svg',
  coinGeckoId: 'exa',
}));

export function ExaRoute(routes: RegistryWarpRouteMap): RegistryWarpRouteMap {
  return {
    ...routes,
    [EXA_WARP_ROUTE_ID.toLowerCase()]: {
      id: EXA_WARP_ROUTE_ID,
      tokens: EXA_CHAINS.map((chain) => ({
        chainName: chain.chainName,
        addressOrDenom: EXA_ROUTER_ADDRESS,
        collateralAddressOrDenom: EXA_TOKEN_ADDRESS,
        standard: 'EvmHypCollateral',
      })),
    },
  };
}

function chainOf(chainId: number | string | undefined | null): ChainDiscovery | undefined {
  return EXA_CHAINS.find((c) => c.id === Number(chainId) || c.chainName === chainId);
}

function isExaToken(address: string | undefined | null): boolean {
  return address?.toLowerCase() === EXA_TOKEN_ADDRESS.toLowerCase();
}

// Serves the RouterClient API locally for the EXA warp route only, instead
// of the hosted Universal Router Engine.
export class LocalExaEngine implements Pick<
  RouterClient,
  'readiness' | 'chains' | 'tokens' | 'availableRoutes' | 'quote'
> {
  private multiProvider: MultiProtocolProvider | undefined;

  // Injected from initAppContext so quotes share the app's RPC config
  // (env/user overrides) instead of the packaged registry defaults.
  setMultiProvider(multiProvider: MultiProtocolProvider): void {
    this.multiProvider = multiProvider;
  }

  async readiness(_options?: unknown): Promise<ReadinessResponse> {
    return {
      ok: true,
      graphReady: true,
      graphConnections: EXA_CHAINS.length,
      coreConfigChains: EXA_CHAINS.length,
      chainCacheHydrated: true,
      lastRouteCacheRefreshAt: null,
      lastRouteCacheRefreshStatus: null,
    };
  }

  async chains(_options?: unknown): Promise<ChainsResponse> {
    return { chains: EXA_CHAINS };
  }

  async tokens(query: TokensQuery = {}, _options?: unknown): Promise<TokensResponse> {
    if (query.ids?.length) {
      const ids = new Set(query.ids.map((id) => id.toLowerCase()));
      return {
        tokens: EXA_TOKENS.filter((t) =>
          ids.has(`${chainOf(t.chainId)!.chainName}-${t.address}`.toLowerCase()),
        ),
      };
    }
    const chain = query.chain != null ? chainOf(query.chain) : undefined;
    const search = query.search?.trim().toLowerCase();
    return {
      tokens: EXA_TOKENS.filter(
        (t) =>
          (query.chain == null || t.chainId === chain?.id) &&
          (!search ||
            t.symbol.toLowerCase().includes(search) ||
            t.name?.toLowerCase().includes(search) ||
            t.address.toLowerCase().includes(search)),
      ),
    };
  }

  async availableRoutes(
    params: AvailableRoutesParams,
    _options?: unknown,
  ): Promise<AvailableRoutesResponse> {
    const fromSource = params.srcChain != null;
    const chain = chainOf(fromSource ? params.srcChain : params.dstChain);
    const token = fromSource ? params.srcToken : params.dstToken;
    const direction = fromSource ? ('fromSource' as const) : ('toDestination' as const);
    if (!chain || !isExaToken(token)) return { direction, tokens: [] };
    return { direction, tokens: EXA_TOKENS.filter((t) => t.chainId !== chain.id) };
  }

  async quote(params: QuoteParams, _options?: unknown): Promise<QuoteResponse> {
    const expiresAt = Math.floor(Date.now() / 1000) + QUOTE_TTL_SECONDS;
    const src = chainOf(params.srcChain);
    const dst = chainOf(params.dstChain);
    if (
      !src ||
      !dst ||
      src === dst ||
      !isExaToken(params.srcToken) ||
      !isExaToken(params.dstToken)
    ) {
      return { routes: [], expiresAt };
    }

    const token = new Token({
      chainName: src.chainName,
      standard: TokenStandard.EvmHypXERC20,
      addressOrDenom: EXA_ROUTER_ADDRESS,
      collateralAddressOrDenom: EXA_TOKEN_ADDRESS,
      decimals: 18,
      symbol: 'EXA',
      name: 'exactly',
    });
    if (!this.multiProvider) throw new Error('LocalExaEngine: multiProvider not set');
    const adapter = token.getHypAdapter(this.multiProvider);
    const recipient = params.recipient ?? params.sender;
    const interchainGas = await adapter.quoteTransferRemoteGas({
      destination: dst.id,
      sender: params.sender,
      recipient,
      amount: params.amount,
    });
    // EXA's burn needs no allowance, so no approval step is emitted
    const populated = (await adapter.populateTransferRemoteTx({
      weiAmountOrId: params.amount.toString(),
      destination: dst.id,
      recipient,
      interchainGas,
    })) as { to?: string; data?: string; value?: { toString(): string } };
    if (!populated.to || !populated.data) {
      throw new Error('LocalExaEngine: transferRemote tx is missing to/data');
    }

    const amount = params.amount.toString();
    const route: RouteResponse = {
      steps: [
        {
          type: 'bridge',
          chain: src.id,
          destChain: dst.id,
          asset: EXA_TOKEN_ADDRESS,
          router: EXA_ROUTER_ADDRESS,
          amountIn: amount,
          amountOut: amount,
          bridgeSymbol: 'EXA',
          warpRouteId: EXA_WARP_ROUTE_ID,
          fee: {
            tokenFee: (interchainGas.tokenFeeQuote?.amount ?? 0n).toString(),
            igpToken: interchainGas.igpQuote.addressOrDenom ?? ZERO_ADDRESS,
            igpAmount: interchainGas.igpQuote.amount.toString(),
            localNativeFee: '0',
          },
        },
      ],
      output: amount,
      outputMin: amount,
      executionKind: 'warpDirect',
      connection: { symbol: 'EXA', warpRouteId: EXA_WARP_ROUTE_ID },
      gas: { originGas: '0', destGas: '0' },
      tx: { to: populated.to, data: populated.data, value: populated.value?.toString() ?? '0' },
      approval: null,
    };
    return { routes: [route], expiresAt };
  }
}

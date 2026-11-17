import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createPublicClient,
  createWalletClient,
  custom,
  erc20Abi,
  formatUnits,
  http,
  isAddress,
  parseAbi,
  parseAbiItem,
  parseUnits,
  type Address,
} from 'viem';
import {
  AMMORA_NATIVE_TOKEN,
  AmmoraRouteClient,
  ammoraV3NativeRouterAbi,
  discoverAmmoraPools,
  giwaSepoliaAutoRoute,
  giwaSepoliaAutoRouteCatalog,
  giwaSepoliaAutoRouteDeployment,
  giwaSepoliaAutoRouteDeploymentCatalog,
  giwaSepoliaAutoRoutePoolProfiles,
} from '@ammora-protocol/sdk';

declare global {
  interface Window {
    ethereum?: any;
  }
}

interface TokenInfo {
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
  isNative?: boolean;
  color: string;
}

interface RecentSwapItem {
  txHash: string;
  type: 'BUY' | 'SELL';
  tammAmount: string;
  trader: string;
  blockNumber: bigint;
}

const TAMM_ADDRESS = '0x10B3Cc2fc981277Ada576891CF649D0ABA768B06' as Address;
const TAMM_V3_POOL = '0x1EF92A6a9BB4bBed2b385Dd5E688F88e7965BCf8' as Address;
const AMMORA_V3_NATIVE_ROUTER = '0x4fc91b90087288520a7bb4aa7ab5441bb4e9c496' as Address;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;
const QUOTE_SIM_ACCOUNT = '0x000000000000000000000000000000000000dEaD' as Address;

const WETH_ADDRESS = giwaSepoliaAutoRouteDeployment.contracts.tokens
  .wrappedNative as Address;

const WETH_ABI = parseAbi([
  'function deposit() payable',
  'function withdraw(uint256 wad)',
]);

const TRANSFER_EVENT = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 value)'
);

const GIWA_CHAIN = {
  id: giwaSepoliaAutoRouteDeployment.chain.id,
  name: giwaSepoliaAutoRouteDeployment.chain.name,
  nativeCurrency: giwaSepoliaAutoRouteDeployment.chain.nativeCurrency,
  rpcUrls: {
    default: { http: [...giwaSepoliaAutoRouteDeployment.chain.rpcUrls] },
  },
  blockExplorers: {
    default: {
      name: 'GIWA Explorer',
      url: giwaSepoliaAutoRouteDeployment.chain.blockExplorerUrl,
    },
  },
} as const;

const DEFAULT_TOKENS: TokenInfo[] = [
  {
    address: AMMORA_NATIVE_TOKEN as Address,
    symbol: 'ETH',
    name: 'Ethereum',
    decimals: 18,
    isNative: true,
    color: 'linear-gradient(135deg, #627eea 0%, #4f46e5 100%)',
  },
  {
    address: WETH_ADDRESS,
    symbol: 'WETH',
    name: 'Wrapped Ether',
    decimals: 18,
    color: 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)',
  },
  {
    address: TAMM_ADDRESS,
    symbol: 'tAMM',
    name: 'Ammora Testnet Token',
    decimals: 6,
    color: 'linear-gradient(135deg, #2dd4bf 0%, #38bdf8 50%, #7c3aed 100%)',
  },
];

function isSameAddr(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}

function PrismLogo() {
  return (
    <svg width="34" height="34" viewBox="0 0 64 64" fill="none">
      <defs>
        <linearGradient id="prismGrad1" x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#5eead4" />
          <stop offset="50%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#7c3aed" />
        </linearGradient>
        <linearGradient id="prismGrad2" x1="12" y1="52" x2="54" y2="22" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#2dd4bf" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="#151923" />
      <path
        d="M32 11L51 46H13L32 11Z"
        stroke="url(#prismGrad1)"
        strokeWidth="4.5"
        strokeLinejoin="round"
      />
      <path
        d="M32 11L41 46H23L32 11Z"
        fill="url(#prismGrad2)"
        fillOpacity="0.28"
      />
      <circle cx="32" cy="35" r="3.5" fill="#5eead4" />
    </svg>
  );
}

export default function App() {
  const [account, setAccount] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [showWalletMenu, setShowWalletMenu] = useState<boolean>(false);
  const [copiedAddr, setCopiedAddr] = useState<boolean>(false);
  const walletMenuRef = useRef<HTMLDivElement | null>(null);

  const [tokens, setTokens] = useState<TokenInfo[]>(DEFAULT_TOKENS);
  const [balances, setBalances] = useState<Record<string, bigint>>({});
  const [discoveredPools, setDiscoveredPools] = useState<any[]>([]);

  const [tokenIn, setTokenIn] = useState<TokenInfo>(DEFAULT_TOKENS[0]); // ETH
  const [tokenOut, setTokenOut] = useState<TokenInfo>(DEFAULT_TOKENS[2]); // tAMM

  const [selectorSide, setSelectorSide] = useState<'in' | 'out' | null>(null);
  const [tokenSearch, setTokenSearch] = useState<string>('');
  const [isImportingToken, setIsImportingToken] = useState<boolean>(false);

  const [amountIn, setAmountIn] = useState<string>('0.001');
  const [slippageBps, setSlippageBps] = useState<number>(200);
  const [showSettings, setShowSettings] = useState<boolean>(false);

  const [lastQuote, setLastQuote] = useState<any | null>(null);
  const [quoteOutDisplay, setQuoteOutDisplay] = useState<string>('');
  const [rateDisplay, setRateDisplay] = useState<string | null>(null);
  const [routeLabel, setRouteLabel] = useState<string | null>(null);

  const [recentSwaps, setRecentSwaps] = useState<RecentSwapItem[]>([]);
  const [isLoadingFeed, setIsLoadingFeed] = useState<boolean>(false);

  const [isQuoting, setIsQuoting] = useState<boolean>(false);
  const [isSwapping, setIsSwapping] = useState<boolean>(false);
  const [swapStepText, setSwapStepText] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const publicClient = useMemo(
    () =>
      createPublicClient({
        chain: GIWA_CHAIN,
        transport: http(giwaSepoliaAutoRouteDeployment.chain.rpcUrls[0]),
      }),
    []
  );

  // Close wallet dropdown when clicking outside
  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      if (
        walletMenuRef.current &&
        !walletMenuRef.current.contains(e.target as Node)
      ) {
        setShowWalletMenu(false);
      }
    }
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const loadRecentSwaps = useCallback(async () => {
    setIsLoadingFeed(true);
    try {
      const head = await publicClient.getBlockNumber();
      const fromBlock = head > 1500n ? head - 1500n : 0n;
      const logs = await publicClient.getLogs({
        address: TAMM_ADDRESS,
        event: TRANSFER_EVENT,
        fromBlock,
        toBlock: head,
      });

      const items: RecentSwapItem[] = [];
      for (let i = logs.length - 1; i >= 0 && items.length < 6; i--) {
        const log = logs[i];
        const from = log.args.from;
        const to = log.args.to;
        const val = log.args.value ?? 0n;
        if (!from || !to || val === 0n) continue;

        const isBuy = isSameAddr(from, TAMM_V3_POOL);
        const isSell = isSameAddr(to, TAMM_V3_POOL);
        if (!isBuy && !isSell) continue;

        items.push({
          txHash: log.transactionHash,
          type: isBuy ? 'BUY' : 'SELL',
          tammAmount: Number(formatUnits(val, 6)).toLocaleString('en-US', {
            maximumFractionDigits: 4,
          }),
          trader: isBuy ? to : from,
          blockNumber: log.blockNumber,
        });
      }
      setRecentSwaps(items);
    } catch {
      // ignore transient RPC errors
    } finally {
      setIsLoadingFeed(false);
    }
  }, [publicClient]);

  useEffect(() => {
    loadRecentSwaps();
  }, [loadRecentSwaps]);

  const refreshBalances = useCallback(async () => {
    if (!account) {
      setBalances({});
      return;
    }
    const next: Record<string, bigint> = {};
    await Promise.all(
      tokens.map(async (t) => {
        try {
          if (t.isNative || isSameAddr(t.address, AMMORA_NATIVE_TOKEN)) {
            next[t.address.toLowerCase()] = await publicClient.getBalance({
              address: account,
            });
          } else {
            next[t.address.toLowerCase()] = await publicClient.readContract({
              address: t.address,
              abi: erc20Abi,
              functionName: 'balanceOf',
              args: [account],
            });
          }
        } catch {
          next[t.address.toLowerCase()] = 0n;
        }
      })
    );
    setBalances(next);
  }, [account, publicClient, tokens]);

  useEffect(() => {
    refreshBalances();
  }, [refreshBalances]);

  useEffect(() => {
    if (!window.ethereum) return;
    if (localStorage.getItem('prism_wallet_disconnected') !== '1') {
      window.ethereum
        .request({ method: 'eth_accounts' })
        .then((accs: Address[]) => {
          if (accs?.[0]) {
            setAccount(accs[0]);
            window.ethereum.request({ method: 'eth_chainId' }).then((hex: string) => {
              setChainId(parseInt(hex, 16));
            });
          }
        })
        .catch(() => {});
    }

    const onAccounts = (accs: Address[]) => {
      if (accs?.[0]) {
        localStorage.removeItem('prism_wallet_disconnected');
        setAccount(accs[0]);
      } else {
        setAccount(null);
        setShowWalletMenu(false);
      }
    };
    const onChain = (hex: string) => setChainId(parseInt(hex, 16));

    window.ethereum.on?.('accountsChanged', onAccounts);
    window.ethereum.on?.('chainChanged', onChain);
    return () => {
      window.ethereum.removeListener?.('accountsChanged', onAccounts);
      window.ethereum.removeListener?.('chainChanged', onChain);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function initTokensAndPools() {
      const map = new Map<string, TokenInfo>();
      for (const dt of DEFAULT_TOKENS) {
        map.set(dt.address.toLowerCase(), { ...dt });
      }

      try {
        const [sym, nm, dec] = await Promise.all([
          publicClient.readContract({
            address: TAMM_ADDRESS,
            abi: erc20Abi,
            functionName: 'symbol',
          }),
          publicClient.readContract({
            address: TAMM_ADDRESS,
            abi: erc20Abi,
            functionName: 'name',
          }),
          publicClient.readContract({
            address: TAMM_ADDRESS,
            abi: erc20Abi,
            functionName: 'decimals',
          }),
        ]);
        const updatedTamm: TokenInfo = {
          address: TAMM_ADDRESS,
          symbol: String(sym),
          name: String(nm),
          decimals: Number(dec),
          color: 'linear-gradient(135deg, #2dd4bf 0%, #38bdf8 50%, #7c3aed 100%)',
        };
        map.set(TAMM_ADDRESS.toLowerCase(), updatedTamm);
        if (!cancelled) {
          setTokenIn((prev) =>
            isSameAddr(prev.address, TAMM_ADDRESS) ? updatedTamm : prev
          );
          setTokenOut((prev) =>
            isSameAddr(prev.address, TAMM_ADDRESS) ? updatedTamm : prev
          );
        }
      } catch {
        // fallback 6 decimals
      }

      try {
        const head = await publicClient.getBlockNumber();
        const toBlock = head > 12n ? head - 12n : head;

        const pools = await discoverAmmoraPools({
          clients: [publicClient as any],
          deployment: giwaSepoliaAutoRoute,
          toBlock,
          initialWindow: 25000n,
          maximumWindow: 100000n,
        });

        for (const p of pools as any[]) {
          const candidates = [p.token, p.baseToken, p.token0, p.token1, p.asset];
          for (const addr of candidates) {
            if (addr && isAddress(addr) && !map.has(addr.toLowerCase())) {
              try {
                const [s, n, d] = await Promise.all([
                  publicClient.readContract({
                    address: addr,
                    abi: erc20Abi,
                    functionName: 'symbol',
                  }),
                  publicClient.readContract({
                    address: addr,
                    abi: erc20Abi,
                    functionName: 'name',
                  }),
                  publicClient.readContract({
                    address: addr,
                    abi: erc20Abi,
                    functionName: 'decimals',
                  }),
                ]);
                map.set(addr.toLowerCase(), {
                  address: addr,
                  symbol: String(s),
                  name: String(n),
                  decimals: Number(d),
                  color: 'linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%)',
                });
              } catch {
                // skip invalid ERC-20
              }
            }
          }
        }

        if (!cancelled) {
          setDiscoveredPools(pools as any[]);
          setTokens(Array.from(map.values()));
        }
      } catch {
        if (!cancelled) setTokens(Array.from(map.values()));
      }
    }

    initTokensAndPools();
    return () => {
      cancelled = true;
    };
  }, [publicClient]);

  const simulateNativeBuyQuote = useCallback(
    async (ethAmountRaw: bigint, deadline: bigint) => {
      const simAccount = account ?? QUOTE_SIM_ACCOUNT;
      const virtualBalance = ethAmountRaw + parseUnits('10', 18);

      try {
        const sim = await publicClient.simulateContract({
          address: AMMORA_V3_NATIVE_ROUTER,
          abi: ammoraV3NativeRouterAbi,
          functionName: 'swapPoolExactInNative',
          args: [TAMM_V3_POOL, 1n, simAccount, deadline, ZERO_ADDRESS],
          value: ethAmountRaw,
          account: simAccount,
          stateOverride: [
            {
              address: simAccount,
              balance: virtualBalance,
            },
          ],
        });
        return BigInt((sim.result as any) ?? 0n);
      } catch {
        const sim = await publicClient.simulateContract({
          address: AMMORA_V3_NATIVE_ROUTER,
          abi: ammoraV3NativeRouterAbi,
          functionName: 'swapPoolExactInNative',
          args: [TAMM_V3_POOL, 1n, simAccount, deadline, ZERO_ADDRESS],
          value: ethAmountRaw,
          account: simAccount,
        });
        return BigInt((sim.result as any) ?? 0n);
      }
    },
    [account, publicClient]
  );

  useEffect(() => {
    let cancelled = false;
    const numericIn = Number(amountIn);

    if (!amountIn || isNaN(numericIn) || numericIn <= 0) {
      setLastQuote(null);
      setQuoteOutDisplay('');
      setRateDisplay(null);
      setRouteLabel(null);
      setErrorMsg(null);
      return;
    }

    if (isSameAddr(tokenIn.address, tokenOut.address)) {
      setLastQuote(null);
      setQuoteOutDisplay(amountIn);
      setRateDisplay(`1 ${tokenIn.symbol} = 1 ${tokenOut.symbol}`);
      setRouteLabel(null);
      return;
    }

    const inIsEth = Boolean(tokenIn.isNative || isSameAddr(tokenIn.address, AMMORA_NATIVE_TOKEN));
    const outIsEth = Boolean(tokenOut.isNative || isSameAddr(tokenOut.address, AMMORA_NATIVE_TOKEN));
    const inIsWeth = isSameAddr(tokenIn.address, WETH_ADDRESS);
    const outIsWeth = isSameAddr(tokenOut.address, WETH_ADDRESS);
    const inIsTamm = isSameAddr(tokenIn.address, TAMM_ADDRESS);
    const outIsTamm = isSameAddr(tokenOut.address, TAMM_ADDRESS);

    if ((inIsEth && outIsWeth) || (inIsWeth && outIsEth)) {
      const raw = parseUnits(amountIn, 18);
      setLastQuote({ mode: 'weth', expectedOut: raw, minOut: raw });
      setQuoteOutDisplay(amountIn);
      setRateDisplay(`1 ${tokenIn.symbol} = 1 ${tokenOut.symbol}`);
      setRouteLabel('WETH9 Direct Wrap');
      setErrorMsg(null);
      return;
    }

    const timer = setTimeout(async () => {
      if (cancelled) return;
      setIsQuoting(true);
      setErrorMsg(null);

      try {
        const amountInRaw = parseUnits(amountIn, tokenIn.decimals);
        const recipient = account ?? QUOTE_SIM_ACCOUNT;
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800);

        if ((inIsEth || inIsWeth) && outIsTamm) {
          const expectedOut = await simulateNativeBuyQuote(amountInRaw, deadline);
          const minOut =
            expectedOut > 0n
              ? (expectedOut * BigInt(10000 - slippageBps)) / 10000n
              : 1n;

          if (!cancelled) {
            const outNum = Number(formatUnits(expectedOut, tokenOut.decimals));
            setLastQuote({
              mode: inIsWeth ? 'weth-to-tamm' : 'eth-to-tamm',
              expectedOut,
              minOut,
            });
            setQuoteOutDisplay(
              outNum.toLocaleString('en-US', {
                useGrouping: false,
                maximumFractionDigits: 6,
              })
            );
            setRateDisplay(
              `1 ${tokenIn.symbol} ≈ ${(outNum / numericIn).toLocaleString('en-US', {
                maximumFractionDigits: 4,
              })} ${tokenOut.symbol}`
            );
            setRouteLabel(
              inIsWeth
                ? 'WETH → ETH → Ammora V3 Pool'
                : 'Ammora V3 Native Router'
            );
          }
          return;
        }

        if (inIsTamm && (outIsEth || outIsWeth)) {
          let expectedOut = 0n;
          const userTammBal = account ? balances[TAMM_ADDRESS.toLowerCase()] ?? 0n : 0n;

          if (account && userTammBal >= amountInRaw) {
            const allow = await publicClient.readContract({
              address: TAMM_ADDRESS,
              abi: erc20Abi,
              functionName: 'allowance',
              args: [account, AMMORA_V3_NATIVE_ROUTER],
            });

            if (allow >= amountInRaw) {
              const sim = await publicClient.simulateContract({
                address: AMMORA_V3_NATIVE_ROUTER,
                abi: ammoraV3NativeRouterAbi,
                functionName: 'swapPoolExactInForNative',
                args: [
                  TAMM_V3_POOL,
                  TAMM_ADDRESS,
                  amountInRaw,
                  1n,
                  account,
                  deadline,
                  ZERO_ADDRESS,
                ],
                account,
              });
              expectedOut = BigInt((sim.result as any) ?? 0n);
            }
          }

          if (expectedOut === 0n) {
            const probeEth = parseUnits('0.001', 18);
            const probeTammOut = await simulateNativeBuyQuote(probeEth, deadline);
            expectedOut =
              probeTammOut > 0n ? (amountInRaw * probeEth) / probeTammOut : 1n;
          }

          const minOut =
            expectedOut > 10n
              ? (expectedOut * BigInt(10000 - slippageBps)) / 10000n
              : 1n;

          if (!cancelled) {
            const outNum = Number(formatUnits(expectedOut, tokenOut.decimals));
            setLastQuote({
              mode: outIsWeth ? 'tamm-to-weth' : 'tamm-to-eth',
              expectedOut,
              minOut,
            });
            setQuoteOutDisplay(
              outNum.toLocaleString('en-US', {
                useGrouping: false,
                maximumFractionDigits: 8,
              })
            );
            setRateDisplay(
              `1 ${tokenIn.symbol} ≈ ${(outNum / numericIn).toLocaleString('en-US', {
                maximumFractionDigits: 8,
              })} ${tokenOut.symbol}`
            );
            setRouteLabel(
              outIsWeth
                ? 'Ammora V3 Pool → ETH → WETH'
                : 'Ammora V3 Native Router'
            );
          }
          return;
        }

        const head = await publicClient.getBlockNumber();
        const routes = await AmmoraRouteClient.create({
          client: publicClient as any,
          routeCatalog: giwaSepoliaAutoRouteCatalog,
          deploymentCatalog: giwaSepoliaAutoRouteDeploymentCatalog,
          factoryProfiles: giwaSepoliaAutoRoutePoolProfiles,
          pools: discoveredPools,
          aggregationPools: discoveredPools,
          verificationBlock: head,
        });

        const quote = await routes.quoteExactIn({
          tokenIn: tokenIn.address,
          tokenOut: tokenOut.address,
          amountIn: amountInRaw,
          slippageBps,
          recipient,
        });

        const rawOut: bigint =
          (quote as any).amountOut ??
          (quote as any).expectedAmountOut ??
          (quote as any).quote?.amountOut ??
          0n;

        if (!cancelled) {
          const outNum = Number(formatUnits(rawOut, tokenOut.decimals));
          setLastQuote({ mode: 'route', quote, expectedOut: rawOut });
          setQuoteOutDisplay(
            outNum.toLocaleString('en-US', {
              useGrouping: false,
              maximumFractionDigits: 6,
            })
          );
          setRateDisplay(
            `1 ${tokenIn.symbol} ≈ ${(outNum / numericIn).toLocaleString('en-US', {
              maximumFractionDigits: 6,
            })} ${tokenOut.symbol}`
          );
          setRouteLabel('Ammora AutoRoute');
        }
      } catch (err: any) {
        if (!cancelled) {
          setLastQuote(null);
          setQuoteOutDisplay('');
          setRateDisplay(null);
          setRouteLabel(null);
          setErrorMsg(err?.shortMessage || 'No route available for this pair');
        }
      } finally {
        if (!cancelled) setIsQuoting(false);
      }
    }, 380);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    amountIn,
    tokenIn,
    tokenOut,
    slippageBps,
    account,
    balances,
    publicClient,
    discoveredPools,
    simulateNativeBuyQuote,
  ]);

  async function connectWallet() {
    if (!window.ethereum) {
      setErrorMsg('Please install MetaMask or Rabby Wallet');
      return;
    }
    try {
      setErrorMsg(null);
      localStorage.removeItem('prism_wallet_disconnected');
      const accounts: Address[] = await window.ethereum.request({
        method: 'eth_requestAccounts',
      });
      setAccount(accounts[0]);

      const hexChainId = await window.ethereum.request({ method: 'eth_chainId' });
      const currentChain = parseInt(hexChainId, 16);
      setChainId(currentChain);

      if (currentChain !== GIWA_CHAIN.id) {
        await switchToGiwaSepolia();
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to connect wallet');
    }
  }

  async function disconnectWallet() {
    localStorage.setItem('prism_wallet_disconnected', '1');
    setAccount(null);
    setBalances({});
    setShowWalletMenu(false);
    setSuccessMsg(null);
    setErrorMsg(null);

    try {
      await window.ethereum?.request?.({
        method: 'wallet_revokePermissions',
        params: [{ eth_accounts: {} }],
      });
    } catch {
      // Some wallets don't implement wallet_revokePermissions; local state is already cleared
    }
  }

  function handleCopyAddress() {
    if (!account) return;
    navigator.clipboard?.writeText(account);
    setCopiedAddr(true);
    setTimeout(() => setCopiedAddr(false), 1800);
  }

  async function switchToGiwaSepolia() {
    if (!window.ethereum) return;
    const targetHex = `0x${GIWA_CHAIN.id.toString(16)}`;
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: targetHex }],
      });
      setChainId(GIWA_CHAIN.id);
      setErrorMsg(null);
    } catch (switchError: any) {
      if (switchError.code === 4902) {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: targetHex,
              chainName: GIWA_CHAIN.name,
              nativeCurrency: GIWA_CHAIN.nativeCurrency,
              rpcUrls: giwaSepoliaAutoRouteDeployment.chain.rpcUrls,
              blockExplorerUrls: [giwaSepoliaAutoRouteDeployment.chain.blockExplorerUrl],
            },
          ],
        });
        setChainId(GIWA_CHAIN.id);
      } else {
        setErrorMsg('Could not switch network to GIWA Sepolia');
      }
    }
  }

  function handleSelectToken(selected: TokenInfo) {
    if (selectorSide === 'in') {
      if (isSameAddr(selected.address, tokenOut.address)) {
        setTokenOut(tokenIn);
      }
      setTokenIn(selected);
    } else if (selectorSide === 'out') {
      if (isSameAddr(selected.address, tokenIn.address)) {
        setTokenIn(tokenOut);
      }
      setTokenOut(selected);
    }
    setSelectorSide(null);
    setTokenSearch('');
  }

  async function handleImportCustomToken(addr: string) {
    if (!isAddress(addr)) return;
    setIsImportingToken(true);
    try {
      const [sym, nm, dec] = await Promise.all([
        publicClient.readContract({
          address: addr,
          abi: erc20Abi,
          functionName: 'symbol',
        }),
        publicClient.readContract({
          address: addr,
          abi: erc20Abi,
          functionName: 'name',
        }),
        publicClient.readContract({
          address: addr,
          abi: erc20Abi,
          functionName: 'decimals',
        }),
      ]);
      const imported: TokenInfo = {
        address: addr,
        symbol: String(sym),
        name: String(nm),
        decimals: Number(dec),
        color: 'linear-gradient(135deg, #2dd4bf 0%, #6366f1 100%)',
      };
      setTokens((prev) =>
        prev.some((t) => isSameAddr(t.address, addr)) ? prev : [...prev, imported]
      );
      handleSelectToken(imported);
    } catch {
      setErrorMsg('Address is not a valid ERC-20 token contract');
    } finally {
      setIsImportingToken(false);
    }
  }

  function handleFlipTokens() {
    setTokenIn(tokenOut);
    setTokenOut(tokenIn);
    if (quoteOutDisplay && Number(quoteOutDisplay) > 0) {
      setAmountIn(quoteOutDisplay);
    }
  }

  function handleSetPercentage(pct: number) {
    const bal = balances[tokenIn.address.toLowerCase()] ?? 0n;
    if (bal <= 0n) return;
    let target = (bal * BigInt(pct)) / 100n;
    if (tokenIn.isNative && pct === 100) {
      const reserve = parseUnits('0.0005', 18);
      target = target > reserve ? target - reserve : 0n;
    }
    const formatted = formatUnits(target, tokenIn.decimals);
    setAmountIn(
      Number(formatted)
        .toFixed(tokenIn.decimals === 6 ? 4 : 5)
        .replace(/\.?0+$/, '')
    );
  }

  async function handleSwap() {
    if (!account) {
      await connectWallet();
      return;
    }
    if (chainId !== GIWA_CHAIN.id) {
      await switchToGiwaSepolia();
      return;
    }
    if (!lastQuote) return;

    setIsSwapping(true);
    setSwapStepText(null);
    setErrorMsg(null);
    setSuccessMsg(null);
    setTxHash(null);

    try {
      const walletClient = createWalletClient({
        account,
        chain: GIWA_CHAIN,
        transport: custom(window.ethereum),
      });

      const rawAmount = parseUnits(amountIn, tokenIn.decimals);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800);

      if (lastQuote.mode === 'weth') {
        const isWrap = Boolean(tokenIn.isNative);
        setSwapStepText(isWrap ? 'Wrapping ETH into WETH...' : 'Unwrapping WETH to ETH...');
        const hash = isWrap
          ? await walletClient.writeContract({
              address: WETH_ADDRESS,
              abi: WETH_ABI,
              functionName: 'deposit',
              value: rawAmount,
            })
          : await walletClient.writeContract({
              address: WETH_ADDRESS,
              abi: WETH_ABI,
              functionName: 'withdraw',
              args: [rawAmount],
            });
        setTxHash(hash);
        await publicClient.waitForTransactionReceipt({ hash });
        setSuccessMsg(`Swapped ${amountIn} ${tokenIn.symbol} → ${tokenOut.symbol}`);
        await refreshBalances();
        return;
      }

      if (lastQuote.mode === 'eth-to-tamm') {
        setSwapStepText('Confirm ETH → tAMM swap in wallet...');
        const hash = await walletClient.writeContract({
          address: AMMORA_V3_NATIVE_ROUTER,
          abi: ammoraV3NativeRouterAbi,
          functionName: 'swapPoolExactInNative',
          args: [
            TAMM_V3_POOL,
            lastQuote.minOut ?? 1n,
            account,
            deadline,
            ZERO_ADDRESS,
          ],
          value: rawAmount,
        });
        setTxHash(hash);
        await publicClient.waitForTransactionReceipt({ hash });
        setSuccessMsg(`Received ~${quoteOutDisplay} tAMM for ${amountIn} ETH`);
        await Promise.all([refreshBalances(), loadRecentSwaps()]);
        return;
      }

      if (lastQuote.mode === 'weth-to-tamm') {
        setSwapStepText('Step 1/2: Unwrapping WETH to ETH...');
        const unwrapHash = await walletClient.writeContract({
          address: WETH_ADDRESS,
          abi: WETH_ABI,
          functionName: 'withdraw',
          args: [rawAmount],
        });
        await publicClient.waitForTransactionReceipt({ hash: unwrapHash });

        setSwapStepText('Step 2/2: Swapping ETH for tAMM...');
        const swapHash = await walletClient.writeContract({
          address: AMMORA_V3_NATIVE_ROUTER,
          abi: ammoraV3NativeRouterAbi,
          functionName: 'swapPoolExactInNative',
          args: [
            TAMM_V3_POOL,
            lastQuote.minOut ?? 1n,
            account,
            deadline,
            ZERO_ADDRESS,
          ],
          value: rawAmount,
        });
        setTxHash(swapHash);
        await publicClient.waitForTransactionReceipt({ hash: swapHash });
        setSuccessMsg(`Received ~${quoteOutDisplay} tAMM for ${amountIn} WETH`);
        await Promise.all([refreshBalances(), loadRecentSwaps()]);
        return;
      }

      if (lastQuote.mode === 'tamm-to-eth' || lastQuote.mode === 'tamm-to-weth') {
        const isToWeth = lastQuote.mode === 'tamm-to-weth';
        const allow = await publicClient.readContract({
          address: TAMM_ADDRESS,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [account, AMMORA_V3_NATIVE_ROUTER],
        });

        if (allow < rawAmount) {
          setSwapStepText('Approving tAMM spend...');
          const approveHash = await walletClient.writeContract({
            address: TAMM_ADDRESS,
            abi: erc20Abi,
            functionName: 'approve',
            args: [AMMORA_V3_NATIVE_ROUTER, rawAmount],
          });
          await publicClient.waitForTransactionReceipt({ hash: approveHash });
        }

        const ethBefore = isToWeth
          ? await publicClient.getBalance({ address: account })
          : 0n;

        setSwapStepText(
          isToWeth ? 'Step 1/2: Swapping tAMM → ETH...' : 'Swapping tAMM → ETH...'
        );
        const swapHash = await walletClient.writeContract({
          address: AMMORA_V3_NATIVE_ROUTER,
          abi: ammoraV3NativeRouterAbi,
          functionName: 'swapPoolExactInForNative',
          args: [
            TAMM_V3_POOL,
            TAMM_ADDRESS,
            rawAmount,
            lastQuote.minOut ?? 1n,
            account,
            deadline,
            ZERO_ADDRESS,
          ],
        });
        setTxHash(swapHash);
        await publicClient.waitForTransactionReceipt({ hash: swapHash });

        if (isToWeth) {
          const ethAfter = await publicClient.getBalance({ address: account });
          const receivedEth =
            ethAfter > ethBefore ? ethAfter - ethBefore : lastQuote.expectedOut;
          if (receivedEth > 0n) {
            setSwapStepText('Step 2/2: Wrapping ETH into WETH...');
            const wrapHash = await walletClient.writeContract({
              address: WETH_ADDRESS,
              abi: WETH_ABI,
              functionName: 'deposit',
              value: receivedEth,
            });
            setTxHash(wrapHash);
            await publicClient.waitForTransactionReceipt({ hash: wrapHash });
          }
        }

        setSuccessMsg(
          `Sold ${amountIn} tAMM for ~${quoteOutDisplay} ${tokenOut.symbol}`
        );
        await Promise.all([refreshBalances(), loadRecentSwaps()]);
        return;
      }

      setSwapStepText('Executing swap via Ammora AutoRoute...');
      const head = await publicClient.getBlockNumber();
      const routes = await AmmoraRouteClient.create({
        client: publicClient as any,
        routeCatalog: giwaSepoliaAutoRouteCatalog,
        deploymentCatalog: giwaSepoliaAutoRouteDeploymentCatalog,
        factoryProfiles: giwaSepoliaAutoRoutePoolProfiles,
        pools: discoveredPools,
        aggregationPools: discoveredPools,
        verificationBlock: head,
      });

      const prepared = await routes.prepareExactIn(lastQuote.quote, {
        payer: account,
        recipient: account,
      });

      const receipt = await routes.execute(prepared, {
        wallet: walletClient as any,
        sendApprovals: true,
        exactApproval: true,
        simulate: true,
      });

      const hash =
        (receipt as any)?.transactionHash ||
        (typeof receipt === 'string' ? receipt : null);
      if (hash) setTxHash(hash);
      setSuccessMsg(`Swapped ${amountIn} ${tokenIn.symbol} → ${tokenOut.symbol}`);
      await Promise.all([refreshBalances(), loadRecentSwaps()]);
    } catch (err: any) {
      setErrorMsg(err?.shortMessage || err?.message || 'Transaction rejected');
    } finally {
      setIsSwapping(false);
      setSwapStepText(null);
    }
  }

  const inBalRaw = balances[tokenIn.address.toLowerCase()] ?? 0n;
  const outBalRaw = balances[tokenOut.address.toLowerCase()] ?? 0n;

  const formattedInBal = Number(formatUnits(inBalRaw, tokenIn.decimals)).toLocaleString(
    'en-US',
    { maximumFractionDigits: tokenIn.decimals === 6 ? 4 : 5 }
  );
  const formattedOutBal = Number(
    formatUnits(outBalRaw, tokenOut.decimals)
  ).toLocaleString('en-US', {
    maximumFractionDigits: tokenOut.decimals === 6 ? 4 : 5,
  });

  const insufficientBalance =
    account !== null &&
    Number(amountIn) > 0 &&
    parseUnits(amountIn || '0', tokenIn.decimals) > inBalRaw;

  const filteredTokens = tokens.filter(
    (t) =>
      t.symbol.toLowerCase().includes(tokenSearch.toLowerCase()) ||
      t.name.toLowerCase().includes(tokenSearch.toLowerCase()) ||
      t.address.toLowerCase().includes(tokenSearch.toLowerCase())
  );

  return (
    <div style={styles.page}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap');
        * { box-sizing: border-box; }
        body {
          margin: 0;
          background: #0b0d12;
          font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
        }
        input[type=number]::-webkit-inner-spin-button,
        input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
        button { font-family: inherit; transition: all 0.15s ease; }
        button:hover:not(:disabled) { filter: brightness(1.08); }
        button:active:not(:disabled) { transform: scale(0.985); }
      `}</style>

      {/* Ambient Brand Glow */}
      <div style={styles.ambientGlow} />

      {/* Top Header */}
      <header style={styles.navbar}>
        <div style={styles.brand}>
          <PrismLogo />
          <div style={styles.brandRow}>
            <span style={styles.brandTitle}>Prism</span>
            <span style={styles.brandTag}>Built with Ammora SDK</span>
          </div>
        </div>

        <div style={styles.navActions}>
          <div style={styles.networkBadge}>
            <span style={styles.networkDot} />
            <span>GIWA Sepolia</span>
          </div>

          {!account ? (
            <button style={styles.connectBtn} onClick={connectWallet}>
              Connect Wallet
            </button>
          ) : chainId !== GIWA_CHAIN.id ? (
            <button style={styles.warnBtn} onClick={switchToGiwaSepolia}>
              Wrong Network
            </button>
          ) : (
            <div style={styles.walletMenuWrap} ref={walletMenuRef}>
              <button
                style={styles.accountBadgeBtn}
                onClick={() => setShowWalletMenu((prev) => !prev)}
                title="Wallet options"
              >
                <span style={styles.accountBal}>
                  {Number(
                    formatUnits(balances[AMMORA_NATIVE_TOKEN.toLowerCase()] ?? 0n, 18)
                  ).toFixed(4)}{' '}
                  ETH
                </span>
                <span style={styles.accountAddr}>
                  {account.slice(0, 6)}...{account.slice(-4)} ▾
                </span>
              </button>

              {showWalletMenu && (
                <div style={styles.walletDropdown}>
                  <button
                    style={styles.walletMenuItem}
                    onClick={handleCopyAddress}
                  >
                    <span>{copiedAddr ? 'Copied!' : 'Copy Address'}</span>
                    <span style={styles.menuSubIcon}>{copiedAddr ? '✓' : '⧉'}</span>
                  </button>

                  <a
                    href={`${GIWA_CHAIN.blockExplorers.default.url}/address/${account}`}
                    target="_blank"
                    rel="noreferrer"
                    style={styles.walletMenuLink}
                    onClick={() => setShowWalletMenu(false)}
                  >
                    <span>View on Explorer</span>
                    <span style={styles.menuSubIcon}>↗</span>
                  </a>

                  <div style={styles.menuDivider} />

                  <button
                    style={styles.disconnectBtn}
                    onClick={disconnectWallet}
                  >
                    <span>Disconnect</span>
                    <span>⏻</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main style={styles.main}>
        {/* Swap Card */}
        <div style={styles.card}>
          <div style={styles.cardTop}>
            <span style={styles.cardTitle}>Swap</span>
            <button
              style={styles.settingsBtn}
              onClick={() => setShowSettings(!showSettings)}
            >
              Slippage {slippageBps / 100}% ⚙
            </button>
          </div>

          {showSettings && (
            <div style={styles.settingsDrawer}>
              <div style={styles.settingsLabel}>Max Slippage Tolerance</div>
              <div style={styles.slippageGrid}>
                {[50, 100, 200, 500].map((bps) => (
                  <button
                    key={bps}
                    style={{
                      ...styles.slippageOption,
                      ...(slippageBps === bps ? styles.slippageOptionActive : {}),
                    }}
                    onClick={() => setSlippageBps(bps)}
                  >
                    {bps / 100}%
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input Field (Sell) */}
          <div style={styles.inputCard}>
            <div style={styles.fieldMeta}>
              <span>You pay</span>
              <div style={styles.balanceGroup}>
                <span>Balance: {account ? formattedInBal : '0'}</span>
                {account && inBalRaw > 0n && (
                  <>
                    <button
                      style={styles.miniChip}
                      onClick={() => handleSetPercentage(50)}
                    >
                      50%
                    </button>
                    <button
                      style={styles.miniChip}
                      onClick={() => handleSetPercentage(100)}
                    >
                      MAX
                    </button>
                  </>
                )}
              </div>
            </div>

            <div style={styles.fieldMain}>
              <input
                style={styles.amountInput}
                type="number"
                min="0"
                step="any"
                placeholder="0"
                value={amountIn}
                onChange={(e) => setAmountIn(e.target.value)}
              />

              <button
                style={styles.tokenSelectBtn}
                onClick={() => {
                  setSelectorSide('in');
                  setTokenSearch('');
                }}
              >
                <span
                  style={{ ...styles.tokenAvatar, background: tokenIn.color }}
                >
                  {tokenIn.symbol[0]}
                </span>
                <span style={styles.tokenTicker}>{tokenIn.symbol}</span>
                <span style={styles.chevron}>▾</span>
              </button>
            </div>
          </div>

          {/* Flip Arrow */}
          <div style={styles.flipContainer}>
            <button
              style={styles.flipBtn}
              onClick={handleFlipTokens}
              title="Switch tokens"
            >
              ↓
            </button>
          </div>

          {/* Output Field (Buy) */}
          <div style={{ ...styles.inputCard, marginTop: -8 }}>
            <div style={styles.fieldMeta}>
              <span>You receive</span>
              <span>Balance: {account ? formattedOutBal : '0'}</span>
            </div>

            <div style={styles.fieldMain}>
              <input
                style={{
                  ...styles.amountInput,
                  color: isQuoting ? '#64748b' : '#f8fafc',
                }}
                type="text"
                readOnly
                placeholder="0"
                value={isQuoting ? 'Quoting...' : quoteOutDisplay}
              />

              <button
                style={styles.tokenSelectBtn}
                onClick={() => {
                  setSelectorSide('out');
                  setTokenSearch('');
                }}
              >
                <span
                  style={{ ...styles.tokenAvatar, background: tokenOut.color }}
                >
                  {tokenOut.symbol[0]}
                </span>
                <span style={styles.tokenTicker}>{tokenOut.symbol}</span>
                <span style={styles.chevron}>▾</span>
              </button>
            </div>
          </div>

          {/* Quote Info */}
          {rateDisplay && (
            <div style={styles.infoBox}>
              <div style={styles.infoRow}>
                <span>Rate</span>
                <span style={styles.infoStrong}>{rateDisplay}</span>
              </div>
              {routeLabel && (
                <div style={styles.infoRow}>
                  <span>Route</span>
                  <span style={styles.infoStrong}>{routeLabel}</span>
                </div>
              )}
            </div>
          )}

          {/* Main Action Button */}
          <button
            style={{
              ...styles.submitBtn,
              ...(insufficientBalance || isSwapping || isQuoting || !amountIn
                ? styles.submitBtnDisabled
                : {}),
            }}
            onClick={handleSwap}
            disabled={insufficientBalance || isSwapping || isQuoting || !amountIn}
          >
            {!account
              ? 'Connect Wallet'
              : chainId !== GIWA_CHAIN.id
              ? 'Switch to GIWA Sepolia'
              : !amountIn || Number(amountIn) <= 0
              ? 'Enter an amount'
              : insufficientBalance
              ? `Insufficient ${tokenIn.symbol} balance`
              : isSwapping
              ? swapStepText || 'Confirm in wallet...'
              : isQuoting
              ? 'Fetching quote...'
              : `Swap ${tokenIn.symbol} for ${tokenOut.symbol}`}
          </button>

          {errorMsg && <div style={styles.errorBox}>{errorMsg}</div>}

          {successMsg && (
            <div style={styles.successBox}>
              <div>{successMsg}</div>
              {txHash && (
                <a
                  href={`${GIWA_CHAIN.blockExplorers.default.url}/tx/${txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  style={styles.explorerLink}
                >
                  View on GIWA Explorer ↗
                </a>
              )}
            </div>
          )}
        </div>

        {/* Live On-Chain Pool Activity Feed */}
        <div style={styles.feedCard}>
          <div style={styles.feedHeader}>
            <div style={styles.feedTitleWrap}>
              <span style={styles.livePulse} />
              <span style={styles.feedTitle}>Recent Pool Swaps (tAMM)</span>
            </div>
            <button
              style={styles.refreshBtn}
              onClick={loadRecentSwaps}
              disabled={isLoadingFeed}
              title="Refresh on-chain activity"
            >
              {isLoadingFeed ? '...' : '↻'}
            </button>
          </div>

          {recentSwaps.length === 0 ? (
            <div style={styles.feedEmpty}>
              {isLoadingFeed
                ? 'Loading pool events from GIWA Sepolia...'
                : 'No recent swaps in the last 1,500 blocks'}
            </div>
          ) : (
            <div style={styles.feedList}>
              {recentSwaps.map((item, idx) => (
                <a
                  key={`${item.txHash}-${idx}`}
                  href={`${GIWA_CHAIN.blockExplorers.default.url}/tx/${item.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  style={styles.feedRow}
                >
                  <div style={styles.feedLeft}>
                    <span
                      style={{
                        ...styles.sideBadge,
                        ...(item.type === 'BUY'
                          ? styles.sideBuy
                          : styles.sideSell),
                      }}
                    >
                      {item.type}
                    </span>
                    <span style={styles.feedAmount}>{item.tammAmount} tAMM</span>
                  </div>

                  <div style={styles.feedRight}>
                    <span style={styles.feedTrader}>
                      {item.trader.slice(0, 6)}...{item.trader.slice(-4)}
                    </span>
                    <span style={styles.feedExt}>↗</span>
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Token Selector Modal */}
      {selectorSide && (
        <div
          style={styles.modalBackdrop}
          onClick={() => setSelectorSide(null)}
        >
          <div
            style={styles.modalCard}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={styles.modalHeader}>
              <span style={styles.modalTitle}>Select a token</span>
              <button
                style={styles.closeBtn}
                onClick={() => setSelectorSide(null)}
              >
                ✕
              </button>
            </div>

            <input
              style={styles.searchInput}
              placeholder="Search by name or paste address (0x...)"
              value={tokenSearch}
              onChange={(e) => setTokenSearch(e.target.value)}
              autoFocus
            />

            <div style={styles.quickRow}>
              {tokens.slice(0, 4).map((t) => (
                <button
                  key={t.address}
                  style={styles.quickPill}
                  onClick={() => handleSelectToken(t)}
                >
                  <span style={{ ...styles.quickDot, background: t.color }} />
                  <span>{t.symbol}</span>
                </button>
              ))}
            </div>

            <div style={styles.divider} />

            <div style={styles.tokenList}>
              {filteredTokens.map((t) => {
                const rawB = balances[t.address.toLowerCase()] ?? 0n;
                const fmtB = Number(formatUnits(rawB, t.decimals)).toLocaleString(
                  'en-US',
                  { maximumFractionDigits: t.decimals === 6 ? 4 : 5 }
                );
                const isSelected =
                  (selectorSide === 'in' && isSameAddr(t.address, tokenIn.address)) ||
                  (selectorSide === 'out' && isSameAddr(t.address, tokenOut.address));

                return (
                  <button
                    key={t.address}
                    style={{
                      ...styles.tokenRow,
                      ...(isSelected ? styles.tokenRowSelected : {}),
                    }}
                    onClick={() => handleSelectToken(t)}
                  >
                    <div style={styles.tokenRowLeft}>
                      <div
                        style={{ ...styles.tokenRowIcon, background: t.color }}
                      >
                        {t.symbol[0]}
                      </div>
                      <div style={{ textAlign: 'left' }}>
                        <div style={styles.tokenRowSymbol}>{t.symbol}</div>
                        <div style={styles.tokenRowName}>{t.name}</div>
                      </div>
                    </div>

                    <div style={styles.tokenRowRight}>
                      <div style={styles.tokenRowBal}>
                        {account ? fmtB : ''}
                      </div>
                      {isSelected && <span style={styles.checkMark}>✓</span>}
                    </div>
                  </button>
                );
              })}

              {filteredTokens.length === 0 && isAddress(tokenSearch.trim()) && (
                <button
                  style={styles.importBtn}
                  onClick={() => handleImportCustomToken(tokenSearch.trim())}
                  disabled={isImportingToken}
                >
                  {isImportingToken
                    ? 'Loading token...'
                    : `Import token ${tokenSearch.slice(0, 6)}...${tokenSearch.slice(-4)}`}
                </button>
              )}

              {filteredTokens.length === 0 && !isAddress(tokenSearch.trim()) && (
                <div style={styles.emptySearch}>No tokens found</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#0b0d12',
    color: '#f8fafc',
    display: 'flex',
    flexDirection: 'column',
    position: 'relative',
    overflow: 'hidden',
  },
  ambientGlow: {
    position: 'absolute',
    top: -160,
    left: '50%',
    transform: 'translateX(-50%)',
    width: 640,
    height: 380,
    background:
      'radial-gradient(circle, rgba(45, 212, 191, 0.12) 0%, rgba(124, 58, 237, 0.14) 45%, transparent 70%)',
    pointerEvents: 'none',
  },
  navbar: {
    width: '100%',
    maxWidth: 1180,
    margin: '0 auto',
    padding: '20px 24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    position: 'relative',
    zIndex: 10,
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: 11,
  },
  brandRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  brandTitle: {
    fontSize: 22,
    fontWeight: 800,
    letterSpacing: '-0.03em',
    color: '#ffffff',
  },
  brandTag: {
    fontSize: 11,
    fontWeight: 700,
    color: '#5eead4',
    background: 'rgba(45, 212, 191, 0.1)',
    border: '1px solid rgba(45, 212, 191, 0.25)',
    padding: '2px 8px',
    borderRadius: 999,
  },
  navActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  networkBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    background: '#141720',
    border: '1px solid #222634',
    borderRadius: 12,
    padding: '8px 12px',
    fontSize: 13,
    fontWeight: 600,
    color: '#cbd5e1',
  },
  networkDot: {
    width: 7,
    height: 7,
    borderRadius: '50%',
    background: '#34d399',
    boxShadow: '0 0 8px #34d399',
  },
  connectBtn: {
    background: 'linear-gradient(135deg, #2dd4bf 0%, #6366f1 55%, #7c3aed 100%)',
    color: '#ffffff',
    border: 'none',
    borderRadius: 12,
    padding: '9px 16px',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
  },
  warnBtn: {
    background: '#eab308',
    color: '#090d16',
    border: 'none',
    borderRadius: 12,
    padding: '9px 14px',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
  },
  walletMenuWrap: {
    position: 'relative',
  },
  accountBadgeBtn: {
    display: 'flex',
    alignItems: 'center',
    background: '#141720',
    border: '1px solid #222634',
    borderRadius: 12,
    padding: '4px',
    fontSize: 13,
    cursor: 'pointer',
  },
  accountBal: {
    padding: '4px 10px',
    color: '#94a3b8',
    fontWeight: 600,
  },
  accountAddr: {
    background: '#1e2230',
    color: '#f8fafc',
    padding: '5px 10px',
    borderRadius: 9,
    fontWeight: 600,
  },
  walletDropdown: {
    position: 'absolute',
    top: 'calc(100% + 8px)',
    right: 0,
    width: 210,
    background: '#161a24',
    border: '1px solid #262b3b',
    borderRadius: 14,
    padding: 6,
    boxShadow: '0 16px 40px rgba(0, 0, 0, 0.6)',
    zIndex: 30,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  walletMenuItem: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    background: 'transparent',
    border: 'none',
    borderRadius: 10,
    padding: '9px 12px',
    color: '#e2e8f0',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  walletMenuLink: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 10,
    padding: '9px 12px',
    color: '#e2e8f0',
    fontSize: 13,
    fontWeight: 600,
    textDecoration: 'none',
  },
  menuSubIcon: {
    color: '#94a3b8',
    fontSize: 12,
  },
  menuDivider: {
    height: 1,
    background: '#232838',
    margin: '4px 6px',
  },
  disconnectBtn: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    background: 'rgba(244, 63, 94, 0.1)',
    border: 'none',
    borderRadius: 10,
    padding: '9px 12px',
    color: '#fda4af',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
  },
  main: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    padding: '8px 16px 48px',
    position: 'relative',
    zIndex: 2,
  },
  card: {
    width: '100%',
    maxWidth: 440,
    background: '#141720',
    border: '1px solid #222634',
    borderRadius: 24,
    padding: 16,
    boxShadow: '0 24px 60px rgba(0, 0, 0, 0.5)',
  },
  cardTop: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '4px 6px 14px',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: 700,
    color: '#f8fafc',
  },
  settingsBtn: {
    background: '#1b1f2b',
    border: '1px solid #282d3e',
    color: '#94a3b8',
    borderRadius: 10,
    padding: '5px 10px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
  settingsDrawer: {
    background: '#0f1118',
    border: '1px solid #222634',
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
  },
  settingsLabel: {
    fontSize: 12,
    color: '#94a3b8',
    marginBottom: 8,
  },
  slippageGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 6,
  },
  slippageOption: {
    background: '#181b26',
    border: '1px solid transparent',
    color: '#94a3b8',
    borderRadius: 8,
    padding: '6px 0',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
  slippageOptionActive: {
    background: 'rgba(99, 102, 241, 0.2)',
    borderColor: '#6366f1',
    color: '#c7d2fe',
  },
  inputCard: {
    background: '#0f1118',
    border: '1px solid #1e212e',
    borderRadius: 18,
    padding: '14px 16px',
  },
  fieldMeta: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: 12,
    color: '#64748b',
    marginBottom: 10,
  },
  balanceGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  miniChip: {
    background: 'rgba(45, 212, 191, 0.14)',
    border: 'none',
    color: '#5eead4',
    borderRadius: 6,
    padding: '2px 6px',
    fontSize: 10,
    fontWeight: 700,
    cursor: 'pointer',
  },
  fieldMain: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  amountInput: {
    flex: 1,
    minWidth: 0,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: '#f8fafc',
    fontSize: 30,
    fontWeight: 700,
    letterSpacing: '-0.02em',
  },
  tokenSelectBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    background: '#1b1f2b',
    border: '1px solid #292f40',
    color: '#f8fafc',
    borderRadius: 999,
    padding: '6px 12px 6px 8px',
    cursor: 'pointer',
    flexShrink: 0,
  },
  tokenAvatar: {
    width: 24,
    height: 24,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    fontWeight: 800,
    color: '#fff',
  },
  tokenTicker: {
    fontSize: 15,
    fontWeight: 700,
  },
  chevron: {
    fontSize: 12,
    color: '#94a3b8',
  },
  flipContainer: {
    display: 'flex',
    justifyContent: 'center',
    position: 'relative',
    zIndex: 2,
    marginTop: -8,
  },
  flipBtn: {
    width: 34,
    height: 34,
    borderRadius: 11,
    background: '#1b1f2b',
    border: '3px solid #141720',
    color: '#cbd5e1',
    fontSize: 15,
    fontWeight: 700,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoBox: {
    marginTop: 10,
    padding: '10px 14px',
    background: '#0f1118',
    borderRadius: 14,
    border: '1px solid #1e212e',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  infoRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 12,
    color: '#64748b',
  },
  infoStrong: {
    color: '#cbd5e1',
    fontWeight: 600,
  },
  submitBtn: {
    width: '100%',
    marginTop: 12,
    background: 'linear-gradient(135deg, #2dd4bf 0%, #6366f1 55%, #7c3aed 100%)',
    color: '#ffffff',
    border: 'none',
    borderRadius: 16,
    padding: '16px',
    fontSize: 15,
    fontWeight: 700,
    cursor: 'pointer',
    boxShadow: '0 8px 24px rgba(99, 102, 241, 0.28)',
  },
  submitBtnDisabled: {
    background: '#1d202b',
    color: '#64748b',
    boxShadow: 'none',
    cursor: 'not-allowed',
  },
  errorBox: {
    marginTop: 10,
    background: 'rgba(239, 68, 68, 0.12)',
    border: '1px solid rgba(239, 68, 68, 0.25)',
    color: '#fca5a5',
    borderRadius: 12,
    padding: '10px 12px',
    fontSize: 12,
    textAlign: 'center',
  },
  successBox: {
    marginTop: 10,
    background: 'rgba(45, 212, 191, 0.12)',
    border: '1px solid rgba(45, 212, 191, 0.28)',
    color: '#5eead4',
    borderRadius: 12,
    padding: '10px 12px',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 1.5,
  },
  explorerLink: {
    display: 'inline-block',
    marginTop: 4,
    color: '#6ee7b7',
    fontWeight: 600,
    textDecoration: 'underline',
  },
  feedCard: {
    width: '100%',
    maxWidth: 440,
    background: '#141720',
    border: '1px solid #222634',
    borderRadius: 20,
    padding: '14px 16px',
  },
  feedHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  feedTitleWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  livePulse: {
    width: 7,
    height: 7,
    borderRadius: '50%',
    background: '#2dd4bf',
    boxShadow: '0 0 8px #2dd4bf',
  },
  feedTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: '#cbd5e1',
  },
  refreshBtn: {
    background: '#1b1f2b',
    border: '1px solid #282d3e',
    color: '#94a3b8',
    borderRadius: 8,
    padding: '3px 8px',
    fontSize: 12,
    cursor: 'pointer',
  },
  feedEmpty: {
    fontSize: 12,
    color: '#64748b',
    textAlign: 'center',
    padding: '10px 0',
  },
  feedList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  feedRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    background: '#0f1118',
    border: '1px solid #1e212e',
    borderRadius: 12,
    padding: '8px 12px',
    textDecoration: 'none',
    color: '#f8fafc',
  },
  feedLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  sideBadge: {
    fontSize: 10,
    fontWeight: 800,
    padding: '2px 6px',
    borderRadius: 6,
  },
  sideBuy: {
    background: 'rgba(45, 212, 191, 0.16)',
    color: '#5eead4',
  },
  sideSell: {
    background: 'rgba(244, 63, 94, 0.16)',
    color: '#fda4af',
  },
  feedAmount: {
    fontSize: 13,
    fontWeight: 600,
    color: '#e2e8f0',
  },
  feedRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    color: '#64748b',
  },
  feedTrader: {
    fontFamily: 'monospace',
  },
  feedExt: {
    color: '#818cf8',
  },
  modalBackdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0, 0, 0, 0.74)',
    backdropFilter: 'blur(6px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    zIndex: 50,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    background: '#141720',
    border: '1px solid #242838',
    borderRadius: 22,
    padding: 18,
    boxShadow: '0 24px 60px rgba(0, 0, 0, 0.65)',
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: 700,
  },
  closeBtn: {
    background: 'transparent',
    border: 'none',
    color: '#94a3b8',
    fontSize: 16,
    cursor: 'pointer',
  },
  searchInput: {
    width: '100%',
    background: '#0f1118',
    border: '1px solid #242838',
    borderRadius: 14,
    padding: '11px 14px',
    color: '#f8fafc',
    fontSize: 13,
    outline: 'none',
  },
  quickRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  quickPill: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    background: '#1b1f2b',
    border: '1px solid #282d3e',
    borderRadius: 999,
    padding: '5px 11px',
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  quickDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
  },
  divider: {
    height: 1,
    background: '#202432',
    margin: '14px 0 8px',
  },
  tokenList: {
    maxHeight: 280,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  tokenRow: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    background: 'transparent',
    border: 'none',
    borderRadius: 14,
    padding: '10px 10px',
    cursor: 'pointer',
    color: '#f8fafc',
  },
  tokenRowSelected: {
    background: 'rgba(99, 102, 241, 0.14)',
  },
  tokenRowLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  tokenRowIcon: {
    width: 34,
    height: 34,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 14,
    fontWeight: 800,
    color: '#fff',
  },
  tokenRowSymbol: {
    fontSize: 14,
    fontWeight: 700,
  },
  tokenRowName: {
    fontSize: 12,
    color: '#64748b',
  },
  tokenRowRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  tokenRowBal: {
    fontSize: 14,
    fontWeight: 600,
    color: '#cbd5e1',
  },
  checkMark: {
    color: '#34d399',
    fontWeight: 700,
  },
  importBtn: {
    width: '100%',
    marginTop: 8,
    background: 'linear-gradient(135deg, #2dd4bf 0%, #6366f1 100%)',
    color: '#fff',
    border: 'none',
    borderRadius: 12,
    padding: '12px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  emptySearch: {
    textAlign: 'center',
    color: '#64748b',
    fontSize: 13,
    padding: '20px 0',
  },
};

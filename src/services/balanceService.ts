import { ethers } from 'ethers';
import type { WalletBalances } from '../types';

const ETH_RPC = 'https://eth.drpc.org';
const BSC_RPC = 'https://bsc.drpc.org';
const ARB_RPC = 'https://arb1.arbitrum.io/rpc';

const RPC_TIMEOUT_MS = 12000;

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
];

const USDT_ETH = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const USDC_ETH = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const USDT_BSC = '0x55d398326f99059fF775485246999027B3197955';
const USDC_BSC = '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d';
const USDC_ARB = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';

const TOKEN_DECIMALS: Record<string, number> = {
  [USDT_ETH]: 6,
  [USDC_ETH]: 6,
  [USDT_BSC]: 18,
  [USDC_BSC]: 18,
  [USDC_ARB]: 6,
};

let ethProvider: ethers.JsonRpcProvider | null = null;
let bscProvider: ethers.JsonRpcProvider | null = null;
let arbProvider: ethers.JsonRpcProvider | null = null;

function getEthProvider(): ethers.JsonRpcProvider {
  if (!ethProvider) ethProvider = new ethers.JsonRpcProvider(ETH_RPC, undefined, { staticNetwork: true, batchMaxCount: 1, pollingInterval: 1000 });
  return ethProvider;
}

function getBscProvider(): ethers.JsonRpcProvider {
  if (!bscProvider) bscProvider = new ethers.JsonRpcProvider(BSC_RPC, undefined, { staticNetwork: true, batchMaxCount: 1, pollingInterval: 1000 });
  return bscProvider;
}

function getArbProvider(): ethers.JsonRpcProvider {
  if (!arbProvider) arbProvider = new ethers.JsonRpcProvider(ARB_RPC, undefined, { staticNetwork: true, batchMaxCount: 1, pollingInterval: 1000 });
  return arbProvider;
}

async function getTokenBalance(
  tokenAddress: string,
  walletAddress: string,
  provider: ethers.JsonRpcProvider
): Promise<number> {
  try {
    const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
    const balance = await contract.balanceOf(walletAddress);
    const decimals = TOKEN_DECIMALS[tokenAddress] ?? 18;
    return Number(ethers.formatUnits(balance, decimals));
  } catch {
    return 0;
  }
}

export async function getWalletBalances(address: string): Promise<WalletBalances> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('RPC balance query timed out')), RPC_TIMEOUT_MS)
  );

  const work = async (): Promise<WalletBalances> => {
    const [erc20Usdt, erc20Usdc, bep20Usdt, bep20Usdc, arbUsdc] = await Promise.all([
      getTokenBalance(USDT_ETH, address, getEthProvider()),
      getTokenBalance(USDC_ETH, address, getEthProvider()),
      getTokenBalance(USDT_BSC, address, getBscProvider()),
      getTokenBalance(USDC_BSC, address, getBscProvider()),
      getTokenBalance(USDC_ARB, address, getArbProvider()),
    ]);

    return { erc20Usdt, erc20Usdc, bep20Usdt, bep20Usdc, arbUsdc };
  };

  return Promise.race([work(), timeout]);
}

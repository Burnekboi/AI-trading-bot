import { ethers } from 'ethers';
import type { WalletBalances } from '../types';

const ETH_RPC = 'https://eth.drpc.org';
const BSC_RPC = 'https://bsc.drpc.org';

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
];

const USDT_ETH = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const USDC_ETH = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const USDT_BSC = '0x55d398326f99059fF775485246999027B3197955';
const USDC_BSC = '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d';

const TOKEN_DECIMALS: Record<string, number> = {
  [USDT_ETH]: 6,
  [USDC_ETH]: 6,
  [USDT_BSC]: 18,
  [USDC_BSC]: 18,
};

let ethProvider: ethers.JsonRpcProvider | null = null;
let bscProvider: ethers.JsonRpcProvider | null = null;

function getEthProvider(): ethers.JsonRpcProvider {
  if (!ethProvider) ethProvider = new ethers.JsonRpcProvider(ETH_RPC);
  return ethProvider;
}

function getBscProvider(): ethers.JsonRpcProvider {
  if (!bscProvider) bscProvider = new ethers.JsonRpcProvider(BSC_RPC);
  return bscProvider;
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
  const [erc20Usdt, erc20Usdc, bep20Usdt, bep20Usdc] = await Promise.all([
    getTokenBalance(USDT_ETH, address, getEthProvider()),
    getTokenBalance(USDC_ETH, address, getEthProvider()),
    getTokenBalance(USDT_BSC, address, getBscProvider()),
    getTokenBalance(USDC_BSC, address, getBscProvider()),
  ]);

  return { erc20Usdt, erc20Usdc, bep20Usdt, bep20Usdc };
}

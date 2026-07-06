import { supabase } from '../database';
import type { Wallet, WalletNetwork } from '../../types';
import { ethers } from 'ethers';

export async function getWallet(chatId: number): Promise<Wallet | null> {
  const { data, error } = await supabase
    .from('wallets')
    .select('*')
    .eq('chat_id', chatId)
    .maybeSingle();

  if (error || !data) return null;

  return {
    id: data.id,
    chatId: data.chat_id,
    address: data.address,
    privateKey: data.private_key,
    pin: data.pin,
    network: data.network as WalletNetwork,
    apiWalletAddress: data.api_wallet_address ?? undefined,
    apiWalletPrivateKey: data.api_wallet_private_key ?? undefined,
    masterAddress: data.master_address ?? undefined,
    createdAt: data.created_at,
  };
}

export async function updateApiWallet(
  chatId: number,
  apiWalletAddress: string,
  apiWalletPrivateKey: string
): Promise<void> {
  const { error } = await supabase
    .from('wallets')
    .update({
      api_wallet_address: apiWalletAddress,
      api_wallet_private_key: apiWalletPrivateKey,
    })
    .eq('chat_id', chatId);

  if (error) throw error;
}

export async function createWallet(
  chatId: number,
  privateKey: string,
  network: WalletNetwork,
  pin: string
): Promise<Wallet> {
  const wallet = new ethers.Wallet(privateKey);
  const address = wallet.address;

  const { data, error } = await supabase
    .from('wallets')
    .insert({
      chat_id: chatId,
      address,
      private_key: privateKey,
      network,
      pin,
    })
    .select('*')
    .single();

  if (error) throw new Error(`Wallet creation failed: ${error.message}`);

  return {
    id: data.id,
    chatId: data.chat_id,
    address: data.address,
    privateKey: data.private_key,
    pin: data.pin,
    network: data.network as WalletNetwork,
    createdAt: data.created_at,
  };
}

export async function verifyWalletPin(chatId: number, pin: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('wallets')
    .select('pin')
    .eq('chat_id', chatId)
    .maybeSingle();

  if (error || !data) return false;
  return data.pin === pin;
}

export async function updateWalletNetwork(chatId: number, network: WalletNetwork): Promise<void> {
  const { error } = await supabase
    .from('wallets')
    .update({ network })
    .eq('chat_id', chatId);

  if (error) throw error;
}

export async function deleteWallet(chatId: number): Promise<void> {
  const { error } = await supabase
    .from('wallets')
    .delete()
    .eq('chat_id', chatId);

  if (error) throw error;
}

export function isValidPrivateKey(pk: string): boolean {
  try {
    const cleaned = pk.startsWith('0x') ? pk.slice(2) : pk;
    return cleaned.length === 64 && /^[0-9a-fA-F]+$/.test(cleaned);
  } catch {
    return false;
  }
}

export function deriveAddress(privateKey: string): string {
  const wallet = new ethers.Wallet(privateKey);
  return wallet.address;
}

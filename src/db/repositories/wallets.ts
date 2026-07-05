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
    network: data.network as WalletNetwork,
    createdAt: data.created_at,
  };
}

export async function createWallet(
  chatId: number,
  privateKey: string,
  network: WalletNetwork
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
    })
    .select('*')
    .single();

  if (error) throw new Error(`Wallet creation failed: ${error.message}`);

  return {
    id: data.id,
    chatId: data.chat_id,
    address: data.address,
    privateKey: data.private_key,
    network: data.network as WalletNetwork,
    createdAt: data.created_at,
  };
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

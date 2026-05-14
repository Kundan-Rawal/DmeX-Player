import { load, Store } from "@tauri-apps/plugin-store";

let store: Store | null = null;

// Singleton pattern guarantees we only load the database into RAM once.
export const initVault = async (): Promise<Store> => {
  if (!store) {
    store = await load('library.json', { autoSave: false });
  }
  return store;
};

export const vaultSet = async (key: string, value: any): Promise<void> => {
  const s = await initVault();
  await s.set(key, value);
  await s.save();
};

export const vaultGet = async <T>(key: string): Promise<T | null> => {
  const s = await initVault();
  return await s.get<T>(key) || null;
};
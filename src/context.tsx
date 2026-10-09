import { createContext, useContext } from 'react';
import type { User, Config } from './types';

export type AppContextValue = {
  user: User | null;
  config: Config;
  setUser: (user: User | null) => void;
  notify: (message: string) => void;
};
export const AppContext = createContext<AppContextValue>(null!);
export const useApp = () => useContext(AppContext);

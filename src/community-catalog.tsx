import { createContext, useContext } from 'react';
import type { Community } from '../shared/communities.ts';

export const CommunityCatalog = createContext<Community[]>([]);
export const useCommunities = () => useContext(CommunityCatalog);

import { create } from 'zustand';

interface AppState {
  isLoading: boolean;
  setIsLoading: (isLoading: boolean) => void;
}

// Sample store showing the zustand pattern for this project.
// Replace with real feature stores as functionality is added.
const useAppStore = create<AppState>((set) => ({
  isLoading: false,
  setIsLoading: (isLoading) => set({ isLoading }),
}));

export default useAppStore;

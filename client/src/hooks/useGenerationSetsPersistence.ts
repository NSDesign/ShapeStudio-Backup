import { useQuery, useMutation } from '@tanstack/react-query';
import { useMemo } from 'react';
import { apiRequest, queryClient } from '@/lib/queryClient';
import type { GenerationSet } from '@shared/schema';
import { migrateBatchConfigSettings } from '@shared/schema';

export interface GenerationSetsData {
  generationSets: GenerationSet[];
  currentSetId: string | null;
}

export function useGenerationSetsPersistence() {
  // Load generation sets from server
  const { data: rawData, isLoading, error } = useQuery<GenerationSetsData>({
    queryKey: ['/api/user/generation-sets'],
    retry: 2,
    staleTime: 5 * 60 * 1000, // Consider data fresh for 5 minutes
  });
  
  // Apply migration to loaded data (memoized to prevent re-renders)
  const data = useMemo(() => {
    return rawData ? {
      ...rawData,
      generationSets: rawData.generationSets.map(set => ({
        ...set,
        batchConfig: migrateBatchConfigSettings(set.batchConfig) as typeof set.batchConfig,
        // Migrate locks field: add default locks if missing
        locks: set.locks ?? {
          composite: false
        }
      }))
    } : rawData;
  }, [rawData]);

  // Save generation sets to server
  const saveMutation = useMutation({
    mutationFn: async (data: GenerationSetsData) => {
      const response = await apiRequest('POST', '/api/user/generation-sets', data);
      return response.json();
    },
    onSuccess: (result, variables) => {
      // Update cache directly instead of invalidating to prevent refetch loops
      queryClient.setQueryData(['/api/user/generation-sets'], variables);
    },
    onError: (error) => {
      console.error('Failed to save generation sets:', error);
    },
  });

  // Auto-save function that can be called from components
  const saveGenerationSets = async (generationSets: GenerationSet[], currentSetId?: string | null) => {
    try {
      await saveMutation.mutateAsync({
        generationSets,
        currentSetId: currentSetId || null,
      });
    } catch (error) {
      console.error('Error saving generation sets:', error);
      throw error;
    }
  };

  // Memoize the generation sets array to prevent re-renders
  const generationSets = useMemo(() => data?.generationSets || [], [data?.generationSets]);
  
  return {
    // Data
    generationSets,
    currentSetId: data?.currentSetId || null,
    
    // Loading states
    isLoading,
    isSaving: saveMutation.isPending,
    
    // Error states
    error,
    saveError: saveMutation.error,
    
    // Actions
    saveGenerationSets,
    
    // Utility
    isReady: !isLoading && !error,
  };
}
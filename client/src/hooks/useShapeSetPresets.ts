import { useQuery, useMutation } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';
import type { GenerationSet, ShapeSetPreset } from '@shared/schema';

export interface ShapeSetPresetsData {
  presets: ShapeSetPreset[];
}

export function useShapeSetPresets() {
  // Load all shape set presets for the current user
  const { data, isLoading, error } = useQuery<ShapeSetPresetsData>({
    queryKey: ['/api/user/shape-set-presets'],
    retry: 2,
    staleTime: 5 * 60 * 1000, // Consider data fresh for 5 minutes
  });

  // Save a new preset
  const saveMutation = useMutation({
    mutationFn: async (params: {
      presetName: string;
      generationSetsData: GenerationSet[];
      currentSetId?: string | null;
    }) => {
      const response = await apiRequest('POST', '/api/user/shape-set-presets', params);
      return response.json();
    },
    onSuccess: () => {
      // Invalidate and refetch presets list
      queryClient.invalidateQueries({ queryKey: ['/api/user/shape-set-presets'] });
    },
    onError: (error) => {
      console.error('Failed to save shape set preset:', error);
    },
  });

  // Delete a preset
  const deleteMutation = useMutation({
    mutationFn: async (presetId: string) => {
      const response = await apiRequest('DELETE', `/api/user/shape-set-presets/${presetId}`, null);
      return response.json();
    },
    onSuccess: () => {
      // Invalidate and refetch presets list
      queryClient.invalidateQueries({ queryKey: ['/api/user/shape-set-presets'] });
    },
    onError: (error) => {
      console.error('Failed to delete shape set preset:', error);
    },
  });

  // Save preset function
  const savePreset = async (
    presetName: string,
    generationSetsData: GenerationSet[],
    currentSetId?: string | null
  ) => {
    try {
      const result = await saveMutation.mutateAsync({
        presetName,
        generationSetsData,
        currentSetId,
      });
      return result.preset;
    } catch (error) {
      console.error('Error saving preset:', error);
      throw error;
    }
  };

  // Delete preset function
  const deletePreset = async (presetId: string) => {
    try {
      await deleteMutation.mutateAsync(presetId);
    } catch (error) {
      console.error('Error deleting preset:', error);
      throw error;
    }
  };

  return {
    // Data
    presets: data?.presets || [],
    
    // Loading states
    isLoading,
    isSaving: saveMutation.isPending,
    isDeleting: deleteMutation.isPending,
    
    // Error states
    error,
    saveError: saveMutation.error,
    deleteError: deleteMutation.error,
    
    // Actions
    savePreset,
    deletePreset,
    
    // Utility
    isReady: !isLoading && !error,
  };
}

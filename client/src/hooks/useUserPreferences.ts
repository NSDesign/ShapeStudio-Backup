import { useQuery, useMutation } from '@tanstack/react-query';
import { useRef, useCallback, useMemo } from 'react';
import type { UserPreferences, SidebarSectionConfig, ExportSettingsConfig, AppSettingsDefaults, OverlayManagerState } from '@shared/schema';
import { DEFAULT_SIDEBAR_SECTIONS, DEFAULT_EXPORT_SETTINGS, DEFAULT_APP_SETTINGS } from '@shared/schema';
import { apiRequest, queryClient } from '@/lib/queryClient';

const DEBOUNCE_MS = 1000;

export function useUserPreferences() {
  const { data: preferences, isLoading, error } = useQuery<UserPreferences>({
    queryKey: ['/api/user/preferences'],
    retry: 2,
    staleTime: 0, // Always refetch when invalidated
  });

  // Refs for debouncing - accumulate updates and batch them
  const appSettingsPendingRef = useRef<Partial<AppSettingsDefaults> | null>(null);
  const appSettingsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const exportSettingsPendingRef = useRef<Partial<ExportSettingsConfig> | null>(null);
  const exportSettingsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Normalize sidebar sections from old boolean format to new object format
  const normalizeSidebarSections = (sections: any): SidebarSectionConfig => {
    // Start with defaults
    const normalized: SidebarSectionConfig = {} as SidebarSectionConfig;
    
    // First, populate all keys from defaults
    Object.keys(DEFAULT_SIDEBAR_SECTIONS).forEach((key) => {
      const defaultValue = DEFAULT_SIDEBAR_SECTIONS[key as keyof SidebarSectionConfig];
      normalized[key as keyof SidebarSectionConfig] = { ...defaultValue };
    });
    
    // If no persisted sections, return defaults
    if (!sections) return normalized;
    
    // For each persisted key, override the default
    Object.keys(sections).forEach((key) => {
      const value = sections[key];
      const typedKey = key as keyof SidebarSectionConfig;
      
      // If it's a boolean (old format), convert to object preserving the boolean value
      if (typeof value === 'boolean') {
        normalized[typedKey] = {
          enabled: value, // Preserve the actual boolean value (true or false)
          displayOrder: DEFAULT_SIDEBAR_SECTIONS[typedKey]?.displayOrder ?? 999
        };
      }
      // If it's already an object (new format), use it
      else if (typeof value === 'object' && value !== null) {
        normalized[typedKey] = {
          enabled: value.enabled !== undefined ? value.enabled : DEFAULT_SIDEBAR_SECTIONS[typedKey]?.enabled ?? true,
          displayOrder: value.displayOrder ?? DEFAULT_SIDEBAR_SECTIONS[typedKey]?.displayOrder ?? 999
        };
      }
    });
    
    return normalized;
  };

  // Extract sidebar sections with fallback to defaults and normalization
  const sidebarSections: SidebarSectionConfig = normalizeSidebarSections(preferences?.sidebarSections);

  // Migrate legacy export settings (e.g., 'lzw' -> 'deflate' for TIFF compression)
  const migrateExportSettings = (settings: Partial<ExportSettingsConfig>): ExportSettingsConfig => {
    const migrated = { ...DEFAULT_EXPORT_SETTINGS, ...settings };
    
    // Migrate legacy 'lzw' compression to 'deflate' (UTIF.js doesn't support LZW encoding)
    if ((migrated.tiffCompression as string) === 'lzw') {
      migrated.tiffCompression = 'deflate';
    }
    
    return migrated;
  };

  // Extract export settings with fallback to defaults and migration
  const exportSettings: ExportSettingsConfig = migrateExportSettings(
    preferences?.exportSettings as ExportSettingsConfig || {}
  );

  // Extract app settings defaults
  const appSettingsDefaults: AppSettingsDefaults | null = preferences?.appSettingsDefaults as AppSettingsDefaults || null;

  // Mutation for updating export settings with optimistic updates for instant UI response
  const updateExportSettings = useMutation({
    mutationFn: (newExportSettings: Partial<ExportSettingsConfig>) => {
      console.log('Updating export settings:', newExportSettings);
      return apiRequest('PUT', '/api/user/preferences', {
        exportSettings: {
          ...exportSettings,
          ...newExportSettings,
        },
      });
    },
    // Optimistic update - update UI immediately before server responds
    onMutate: async (newExportSettings) => {
      // Cancel any outgoing refetches to prevent overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: ['/api/user/preferences'] });
      
      // Snapshot the previous value for rollback
      const previousData = queryClient.getQueryData<UserPreferences>(['/api/user/preferences']);
      
      // Optimistically update the cache immediately.
      // Use an empty base when oldData is undefined (e.g. DB unreachable on startup)
      // so the toggle still responds visually even without a persisted preferences record.
      queryClient.setQueryData(['/api/user/preferences'], (oldData: UserPreferences | undefined) => {
        const base = oldData ?? ({} as UserPreferences);
        return {
          ...base,
          exportSettings: {
            ...(base.exportSettings as ExportSettingsConfig || {}),
            ...newExportSettings,
          },
        };
      });
      
      // Return context with previous data for rollback
      return { previousData };
    },
    onSuccess: (response, variables) => {
      // Cache already updated optimistically, no need to update again
    },
    onError: (error) => {
      console.error('Export settings update failed:', error);
      // No rollback — keep the optimistic value so sequential toggles (e.g.
      // Batch Export then Shape Sets) don't strip each other when the server
      // is unavailable. The user's intended state is preserved for the session.
    },
  });

  // Mutation for updating sidebar sections
  const updateSidebarSections = useMutation({
    mutationFn: (newSidebarSections: Partial<SidebarSectionConfig>) => {
      console.log('Updating sidebar sections:', newSidebarSections);
      return apiRequest('PUT', '/api/user/preferences', {
        sidebarSections: {
          ...sidebarSections,
          ...newSidebarSections,
        },
      });
    },
    onSuccess: (response, variables) => {
      console.log('Sidebar sections update successful:', variables);
      // Update cache directly with the new settings
      queryClient.setQueryData(['/api/user/preferences'], (oldData: UserPreferences | undefined) => {
        if (!oldData) return oldData;
        return {
          ...oldData,
          sidebarSections: {
            ...(oldData.sidebarSections as SidebarSectionConfig || {}),
            ...variables,
          },
        };
      });
      // Don't invalidate immediately - this causes race conditions
      // The cache update above is sufficient for immediate UI update
    },
    onError: (error) => {
      console.error('Sidebar sections update failed:', error);
    },
  });

  // Mutation for saving app settings defaults
  const saveAppSettings = useMutation({
    mutationFn: (newAppSettings: AppSettingsDefaults) => {
      console.log('Saving app settings defaults:', newAppSettings);
      return apiRequest('PUT', '/api/user/preferences', {
        appSettingsDefaults: newAppSettings,
      });
    },
    onSuccess: (response, variables) => {
      console.log('App settings saved successfully:', variables);
      // Update cache directly
      queryClient.setQueryData(['/api/user/preferences'], (oldData: UserPreferences | undefined) => {
        if (!oldData) return oldData;
        return {
          ...oldData,
          appSettingsDefaults: variables,
        };
      });
    },
    onError: (error) => {
      console.error('App settings save failed:', error);
    },
  });

  // Mutation for updating skip load project dialog preference
  const updateSkipLoadDialog = useMutation({
    mutationFn: (skip: boolean) => {
      console.log('Updating skip load project dialog preference:', skip);
      return apiRequest('PUT', '/api/user/preferences', {
        skipLoadProjectDialog: skip,
      });
    },
    onSuccess: (response, variables) => {
      console.log('Skip load dialog preference updated:', variables);
      // Update cache directly
      queryClient.setQueryData(['/api/user/preferences'], (oldData: UserPreferences | undefined) => {
        if (!oldData) return oldData;
        return {
          ...oldData,
          skipLoadProjectDialog: variables,
        };
      });
    },
    onError: (error) => {
      console.error('Skip load dialog preference update failed:', error);
    },
  });

  // Mutation for saving overlay manager state
  const saveOverlayManagerState = useMutation({
    mutationFn: (state: OverlayManagerState) =>
      apiRequest('PUT', '/api/user/preferences', { overlayManagerState: state }),
    onMutate: async (state) => {
      await queryClient.cancelQueries({ queryKey: ['/api/user/preferences'] });
      queryClient.setQueryData(['/api/user/preferences'], (old: UserPreferences | undefined) => {
        if (!old) return old;
        return { ...old, overlayManagerState: state };
      });
    },
    onError: () => {
      // Keep optimistic value — do not rollback on network errors
    },
  });

  // Debounced save for overlay manager state
  const overlayStatePendingRef = useRef<OverlayManagerState | null>(null);
  const overlayStateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const debouncedSaveOverlayManagerState = useCallback((state: OverlayManagerState) => {
    overlayStatePendingRef.current = state;
    if (overlayStateTimeoutRef.current) clearTimeout(overlayStateTimeoutRef.current);
    overlayStateTimeoutRef.current = setTimeout(() => {
      if (overlayStatePendingRef.current) {
        saveOverlayManagerState.mutate(overlayStatePendingRef.current);
        overlayStatePendingRef.current = null;
      }
      overlayStateTimeoutRef.current = null;
    }, 1000);
  }, [saveOverlayManagerState]);

  // Track last saved values to prevent redundant saves
  const lastSavedAppSettingsRef = useRef<string>('');

  // Debounced save for app settings - batches multiple updates into one API call
  const debouncedSaveAppSettings = useCallback((updates: Partial<AppSettingsDefaults>) => {
    // Accumulate updates
    appSettingsPendingRef.current = {
      ...appSettingsPendingRef.current,
      ...updates,
    };

    // Clear existing timeout
    if (appSettingsTimeoutRef.current) {
      clearTimeout(appSettingsTimeoutRef.current);
    }

    // Set new timeout
    appSettingsTimeoutRef.current = setTimeout(() => {
      const pending = appSettingsPendingRef.current;
      if (pending) {
        // Get current settings from cache
        const currentData = queryClient.getQueryData<UserPreferences>(['/api/user/preferences']);
        const currentSettings = currentData?.appSettingsDefaults as AppSettingsDefaults || {};
        
        const merged = {
          ...currentSettings,
          ...pending,
        } as AppSettingsDefaults;
        
        // Only save if values have actually changed
        const mergedJson = JSON.stringify(merged);
        if (mergedJson !== lastSavedAppSettingsRef.current) {
          lastSavedAppSettingsRef.current = mergedJson;
          saveAppSettings.mutate(merged);
        }
        
        appSettingsPendingRef.current = null;
      }
      appSettingsTimeoutRef.current = null;
    }, DEBOUNCE_MS);
  }, [saveAppSettings]);

  const cancelPendingPreferenceWrites = useCallback(() => {
    if (appSettingsTimeoutRef.current) clearTimeout(appSettingsTimeoutRef.current);
    if (overlayStateTimeoutRef.current) clearTimeout(overlayStateTimeoutRef.current);
    appSettingsTimeoutRef.current = null;
    overlayStateTimeoutRef.current = null;
    const pendingAppSettings = appSettingsPendingRef.current;
    appSettingsPendingRef.current = null;
    const pendingOverlayState = overlayStatePendingRef.current;
    overlayStatePendingRef.current = null;
    return { pendingAppSettings, pendingOverlayState };
  }, []);

  // Debounced save for export settings - batches multiple updates into one API call
  const debouncedUpdateExportSettings = useCallback((updates: Partial<ExportSettingsConfig>) => {
    // Accumulate updates
    exportSettingsPendingRef.current = {
      ...exportSettingsPendingRef.current,
      ...updates,
    };

    // Clear existing timeout
    if (exportSettingsTimeoutRef.current) {
      clearTimeout(exportSettingsTimeoutRef.current);
    }

    // Set new timeout
    exportSettingsTimeoutRef.current = setTimeout(() => {
      const pending = exportSettingsPendingRef.current;
      if (pending) {
        updateExportSettings.mutate(pending);
        exportSettingsPendingRef.current = null;
      }
    }, DEBOUNCE_MS);
  }, [updateExportSettings]);

  const savedOverlayManagerState = (preferences as any)?.overlayManagerState as OverlayManagerState | undefined;

  return {
    preferences,
    sidebarSections,
    exportSettings,
    appSettingsDefaults,
    savedOverlayManagerState,
    skipLoadProjectDialog: preferences?.skipLoadProjectDialog ?? false,
    isLoading,
    error,
    updateExportSettings,
    updateSidebarSections,
    saveAppSettings,
    saveOverlayManagerState,
    cancelPendingPreferenceWrites,
    updateSkipLoadDialog,
    // Debounced versions that batch multiple updates
    debouncedSaveAppSettings,
    debouncedUpdateExportSettings,
    debouncedSaveOverlayManagerState,
  };
}

// Helper hook for just export settings
export function useExportSettings() {
  const { exportSettings, updateExportSettings, isLoading, error } = useUserPreferences();
  return { exportSettings, updateExportSettings, isLoading, error };
}
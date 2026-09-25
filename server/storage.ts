import {
  users,
  userPreferences,
  shapeSetPresets,
  type User,
  type UpsertUser,
  type UserPreferences,
  type InsertUserPreferences,
  type UpdateUserPreferences,
  type SidebarSectionConfig,
  type GenerationSet,
  type ShapeSetPreset,
  DEFAULT_SIDEBAR_SECTIONS,
  migrateBatchConfigSettings,
} from "@shared/schema";
import { db } from "./db";
import { eq, and } from "drizzle-orm";

// Interface for storage operations
export interface IStorage {
  // User operations
  // (IMPORTANT) these user operations are mandatory for Replit Auth.
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  
  // User preferences operations
  getUserPreferences(userId: string): Promise<UserPreferences | undefined>;
  upsertUserPreferences(userId: string, preferences: UpdateUserPreferences): Promise<UserPreferences>;
  createDefaultUserPreferences(userId: string): Promise<UserPreferences>;
  
  // Generation sets operations
  saveUserGenerationSets(userId: string, generationSets: GenerationSet[], currentSetId?: string | null): Promise<void>;
  loadUserGenerationSets(userId: string): Promise<{ generationSets: GenerationSet[], currentSetId?: string | null }>;
  
  // Shape set presets operations
  saveUserShapeSetPreset(userId: string, presetName: string, generationSetsData: GenerationSet[], currentSetId?: string | null): Promise<ShapeSetPreset>;
  loadUserShapeSetPresets(userId: string): Promise<ShapeSetPreset[]>;
  deleteUserShapeSetPreset(userId: string, presetId: string): Promise<void>;
  
  // Other operations
}

export class DatabaseStorage implements IStorage {
  // User operations
  // (IMPORTANT) these user operations are mandatory for Replit Auth.

  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    return await db.select().from(users);
  }

  async deleteUser(id: string): Promise<boolean> {
    const result = await db.delete(users).where(eq(users.id, id)).returning();
    return result.length > 0;
  }

  // User preferences operations
  async getUserPreferences(userId: string): Promise<UserPreferences | undefined> {
    const [preferences] = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId));
    return preferences;
  }

  async upsertUserPreferences(userId: string, preferences: UpdateUserPreferences): Promise<UserPreferences> {
    const preferencesId = `${userId}-preferences`;
    
    // Check if preferences exist
    const existing = await this.getUserPreferences(userId);
    
    if (existing) {
      // Merge incoming partial updates with existing data
      const mergedPreferences = {
        sidebarSections: preferences.sidebarSections !== undefined 
          ? { ...existing.sidebarSections as any, ...preferences.sidebarSections as any }
          : existing.sidebarSections,
        exportSettings: preferences.exportSettings !== undefined
          ? { ...existing.exportSettings as any, ...preferences.exportSettings as any }
          : existing.exportSettings,
        generationSets: preferences.generationSets !== undefined
          ? preferences.generationSets
          : existing.generationSets,
        currentGenerationSetId: preferences.currentGenerationSetId !== undefined
          ? preferences.currentGenerationSetId
          : existing.currentGenerationSetId,
        appSettingsDefaults: preferences.appSettingsDefaults !== undefined
          ? preferences.appSettingsDefaults
          : existing.appSettingsDefaults,
        overlayManagerState: preferences.overlayManagerState !== undefined
          ? preferences.overlayManagerState
          : (existing as any).overlayManagerState,
      };
      
      // Update existing preferences with merged data
      const [result] = await db
        .update(userPreferences)
        .set({
          ...mergedPreferences,
          updatedAt: new Date(),
        })
        .where(eq(userPreferences.id, preferencesId))
        .returning();
      return result;
    } else {
      // Insert new preferences with defaults for undefined fields
      const [result] = await db
        .insert(userPreferences)
        .values({
          id: preferencesId,
          userId,
          sidebarSections: preferences.sidebarSections || DEFAULT_SIDEBAR_SECTIONS,
          exportSettings: preferences.exportSettings || {},
          generationSets: preferences.generationSets || [],
          currentGenerationSetId: preferences.currentGenerationSetId || null,
          appSettingsDefaults: preferences.appSettingsDefaults || null,
        })
        .returning();
      return result;
    }
  }

  async createDefaultUserPreferences(userId: string): Promise<UserPreferences> {
    const [result] = await db
      .insert(userPreferences)
      .values({
        id: `${userId}-preferences`,
        userId,
        sidebarSections: DEFAULT_SIDEBAR_SECTIONS,
        generationSets: [] as any,
        currentGenerationSetId: null,
      })
      .onConflictDoUpdate({
        target: userPreferences.id,  // Use primary key, not foreign key
        set: {
          sidebarSections: DEFAULT_SIDEBAR_SECTIONS,
          generationSets: [] as any,
          currentGenerationSetId: null,
          updatedAt: new Date(),
        },
      })
      .returning();
    return result;
  }

  // Generation sets operations
  async saveUserGenerationSets(
    userId: string, 
    generationSets: GenerationSet[], 
    currentSetId?: string | null
  ): Promise<void> {
    // Apply migration to remove legacy fields before saving
    const migratedSets = generationSets.map(set => ({
      ...set,
      batchConfig: migrateBatchConfigSettings(set.batchConfig) as typeof set.batchConfig
    }));
    
    await this.upsertUserPreferences(userId, {
      generationSets: migratedSets as any,
      currentGenerationSetId: currentSetId || null,
    });
  }

  async loadUserGenerationSets(
    userId: string
  ): Promise<{ generationSets: GenerationSet[], currentSetId?: string | null }> {
    const preferences = await this.getUserPreferences(userId);
    const loadedSets = (preferences?.generationSets as GenerationSet[]) || [];
    
    // Apply migration to ensure loaded sets have sizeConstraintMode
    const migratedSets = loadedSets.map(set => ({
      ...set,
      batchConfig: migrateBatchConfigSettings(set.batchConfig) as typeof set.batchConfig
    }));
    
    return {
      generationSets: migratedSets,
      currentSetId: preferences?.currentGenerationSetId || null,
    };
  }

  // Shape set presets operations
  async saveUserShapeSetPreset(
    userId: string,
    presetName: string,
    generationSetsData: GenerationSet[],
    currentSetId?: string | null
  ): Promise<ShapeSetPreset> {
    // Generate unique preset ID
    const presetId = `preset-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    
    const [preset] = await db
      .insert(shapeSetPresets)
      .values({
        id: presetId,
        userId,
        presetName,
        generationSetsData: generationSetsData as any,
        currentSetId: currentSetId || null,
      })
      .returning();
    
    return preset;
  }

  async loadUserShapeSetPresets(userId: string): Promise<ShapeSetPreset[]> {
    const presets = await db
      .select()
      .from(shapeSetPresets)
      .where(eq(shapeSetPresets.userId, userId))
      .orderBy(shapeSetPresets.createdAt);
    
    return presets;
  }

  async deleteUserShapeSetPreset(userId: string, presetId: string): Promise<void> {
    // Verify the preset belongs to the user before deleting
    await db
      .delete(shapeSetPresets)
      .where(and(
        eq(shapeSetPresets.id, presetId),
        eq(shapeSetPresets.userId, userId)
      ));
  }

  // Other operations
}

export const storage = new DatabaseStorage();
import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { registerExportRoutes } from "./routes/export";
import { setupLiveApiRoutes } from "./routes/liveApi";
import { registerCanvasTestRoutes } from "./routes/canvasTest";
import { migrateSizeConstraintMode } from "@shared/schema";

export async function registerRoutes(app: Express): Promise<Server> {
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  if (!isDevelopment) {
    // Auth middleware - only in production
    await setupAuth(app);
  }

  // API key authentication for external access
  const apiKeyAuth = (req: any, res: any, next: any) => {
    const apiKey = req.headers['x-api-key'];
    if (apiKey === process.env.API_KEY) {
      req.user = {
        claims: {
          sub: 'api-user',
          email: 'api@system',
          first_name: 'API',
          last_name: 'User'
        }
      };
      return next();
    }
    next();
  };

  // Conditional authentication middleware
  const conditionalAuth = isDevelopment ? 
    (req: any, res: any, next: any) => {
      // Mock user for development
      req.user = {
        claims: {
          sub: 'dev-user',
          email: 'dev@localhost',
          first_name: 'Dev',
          last_name: 'User'
        }
      };
      next();
    } : 
    (req: any, res: any, next: any) => {
      // Try API key first, then regular auth
      apiKeyAuth(req, res, () => {
        if (req.user) return next();
        isAuthenticated(req, res, next);
      });
    };

  // Auth routes
  app.get('/api/auth/user', conditionalAuth, async (req: any, res) => {
    try {
      if (isDevelopment) {
        // Return mock user for development
        res.json({
          id: 'dev-user',
          email: 'dev@localhost',
          firstName: 'Dev',
          lastName: 'User',
          profileImageUrl: null
        });
        return;
      }
      
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Protected route example
  app.get("/api/protected", conditionalAuth, async (req: any, res) => {
    const userId = req.user?.claims?.sub;
    // Do something with the user id.
    res.json({ message: "This is a protected route", userId });
  });

  // Admin routes for user management
  app.get("/api/admin/users", conditionalAuth, async (req, res) => {
    try {
      if (isDevelopment) {
        // Return mock users for development
        res.json([{
          id: 'dev-user',
          email: 'dev@localhost',
          firstName: 'Dev',
          lastName: 'User',
          profileImageUrl: null
        }]);
        return;
      }
      
      const allUsers = await storage.getAllUsers();
      res.json(allUsers);
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  app.delete("/api/admin/users/:userId", conditionalAuth, async (req, res) => {
    try {
      if (isDevelopment) {
        // Mock deletion for development
        res.json({ message: "User deletion not available in development mode" });
        return;
      }
      
      const { userId } = req.params;
      const deleted = await storage.deleteUser(userId);
      
      if (deleted) {
        res.json({ message: "User deleted successfully" });
      } else {
        res.status(404).json({ message: "User not found" });
      }
    } catch (error) {
      console.error("Error deleting user:", error);
      res.status(500).json({ message: "Failed to delete user" });
    }
  });

  // User preferences routes
  app.get("/api/user/preferences", conditionalAuth, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      // Use real storage for both development and production
      let preferences = await storage.getUserPreferences(userId);
      
      // If no preferences exist, create default ones
      if (!preferences) {
        preferences = await storage.createDefaultUserPreferences(userId);
      }

      res.json(preferences);
    } catch (error) {
      console.error("Error fetching user preferences:", error);
      res.status(500).json({ message: "Failed to fetch user preferences" });
    }
  });

  app.put("/api/user/preferences", conditionalAuth, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      if (isDevelopment) {
        // In development, use real storage to properly merge preferences
        const { updateUserPreferencesSchema } = await import("@shared/schema");
        const validatedData = updateUserPreferencesSchema.parse(req.body);
        
        const preferences = await storage.upsertUserPreferences(userId, validatedData);
        console.log('Mock preferences update:', preferences);
        res.json(preferences);
        return;
      }

      // Validate the request body
      const { updateUserPreferencesSchema } = await import("@shared/schema");
      const validatedData = updateUserPreferencesSchema.parse(req.body);

      const preferences = await storage.upsertUserPreferences(userId, validatedData);
      res.json(preferences);
    } catch (error: any) {
      console.error("Error updating user preferences:", error);
      if (error?.name === 'ZodError') {
        res.status(400).json({ message: "Invalid request data", errors: error.errors });
      } else {
        res.status(500).json({ message: "Failed to update user preferences" });
      }
    }
  });

  // Generation sets routes
  app.get("/api/user/generation-sets", conditionalAuth, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      if (isDevelopment) {
        // Use real persistence even in development
        const result = await storage.loadUserGenerationSets(userId);
        res.json(result);
        return;
      }

      const result = await storage.loadUserGenerationSets(userId);
      res.json(result);
    } catch (error) {
      console.error("Error loading generation sets:", error);
      res.status(500).json({ message: "Failed to load generation sets" });
    }
  });

  app.post("/api/user/generation-sets", conditionalAuth, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      const { generationSets, currentSetId } = req.body;

      // Validate request body
      if (!Array.isArray(generationSets)) {
        return res.status(400).json({ message: "generationSets must be an array" });
      }
      
      if (currentSetId !== null && currentSetId !== undefined && typeof currentSetId !== 'string') {
        return res.status(400).json({ message: "currentSetId must be a string or null" });
      }
      
      if (isDevelopment) {
        // Use real persistence even in development
        await storage.saveUserGenerationSets(userId, generationSets, currentSetId);
        res.json({ success: true });
        return;
      }

      await storage.saveUserGenerationSets(userId, generationSets, currentSetId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error saving generation sets:", error);
      res.status(500).json({ message: "Failed to save generation sets" });
    }
  });

  // Shape Set Presets routes
  app.get("/api/user/shape-set-presets", conditionalAuth, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      const presets = await storage.loadUserShapeSetPresets(userId);
      res.json({ presets });
    } catch (error) {
      console.error("Error loading shape set presets:", error);
      res.status(500).json({ message: "Failed to load shape set presets" });
    }
  });

  app.post("/api/user/shape-set-presets", conditionalAuth, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      const { presetName, generationSetsData, currentSetId } = req.body;

      // Validate request body
      if (!presetName || typeof presetName !== 'string') {
        return res.status(400).json({ message: "presetName is required and must be a string" });
      }
      
      if (!Array.isArray(generationSetsData)) {
        return res.status(400).json({ message: "generationSetsData must be an array" });
      }

      const preset = await storage.saveUserShapeSetPreset(userId, presetName, generationSetsData, currentSetId);
      res.json({ preset });
    } catch (error) {
      console.error("Error saving shape set preset:", error);
      res.status(500).json({ message: "Failed to save shape set preset" });
    }
  });

  app.delete("/api/user/shape-set-presets/:id", conditionalAuth, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      const { id } = req.params;
      if (!id) {
        return res.status(400).json({ message: "Preset ID is required" });
      }

      await storage.deleteUserShapeSetPreset(userId, id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting shape set preset:", error);
      res.status(500).json({ message: "Failed to delete shape set preset" });
    }
  });

  // Register export API routes
  registerExportRoutes(app);
  setupLiveApiRoutes(app, storage);
  
  // Register canvas test routes (for debugging)
  registerCanvasTestRoutes(app);

  const httpServer = createServer(app);
  return httpServer;
}

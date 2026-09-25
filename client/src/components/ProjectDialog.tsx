
import { useState, useRef } from 'react';
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Save, Upload, Download, FolderOpen } from "lucide-react";
import { ProjectManager } from '../lib/projectManager';
import { Shape, ShapeGroupClass } from '../lib/shapes';
import { Artboard } from '../lib/shapeTypes';
import { ArtboardConfig } from '../lib/projectManager';
import { useToast } from "@/hooks/use-toast";

interface ProjectDialogProps {
  shapes: Shape[];
  groups: ShapeGroupClass[];
  artboard: Artboard;
  onLoadProject: (data: {
    shapes: Shape[];
    groups: ShapeGroupClass[];
    artboard: ArtboardConfig;
    projectName: string;
  }) => void;
}

export default function ProjectDialog({
  shapes,
  groups,
  artboard,
  onLoadProject
}: ProjectDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const { toast } = useToast();

  const handleSaveProject = async () => {
    if (shapes.length === 0 && groups.length === 0) {
      toast({
        title: "No content to save",
        description: "Add some shapes to the canvas before saving.",
        variant: "destructive"
      });
      return;
    }

    setIsLoading(true);
    try {
      await ProjectManager.saveProject(
        shapes,
        groups,
        artboard,
        projectName || undefined
      );
      
      toast({
        title: "Project saved successfully",
        description: "Your project has been downloaded as a JSON file."
      });
      
      setIsOpen(false);
      setProjectName('');
    } catch (error) {
      toast({
        title: "Save failed",
        description: error instanceof Error ? error.message : "An unknown error occurred",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleLoadProject = async (file: File) => {
    setIsLoading(true);
    try {
      const projectData = await ProjectManager.loadProject(file);
      onLoadProject(projectData);
      
      toast({
        title: "Project loaded successfully",
        description: `Loaded project: ${projectData.projectName}`
      });
      
      setIsOpen(false);
    } catch (error) {
      toast({
        title: "Load failed",
        description: error instanceof Error ? error.message : "Failed to load project file",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleLoadProject(file);
    }
  };

  const triggerFileSelect = () => {
    fileInputRef.current?.click();
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleFileSelect}
        style={{ display: 'none' }}
      />
      
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogTrigger asChild>
          <div className="flex items-center space-x-3 cursor-pointer hover:bg-slate-800/50 rounded-md px-2 py-1 transition-colors">
            <FolderOpen className="w-5 h-5 text-blue-400" />
            <div>
              <span className="text-sm font-medium text-white">Project</span>
              <span className="text-xs text-slate-400 ml-2">Shape Editor</span>
            </div>
          </div>
        </DialogTrigger>
        <DialogContent className="sm:max-w-[500px] bg-[var(--surface)] border-slate-700">
          <DialogHeader>
            <DialogTitle className="flex items-center text-white">
              <FolderOpen className="w-5 h-5 mr-2" />
              Project Manager
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              Save your current work or load an existing project file.
            </DialogDescription>
          </DialogHeader>
          
          <Tabs defaultValue="save" className="w-full">
            <TabsList className="grid w-full grid-cols-2 bg-[var(--surface-light)]">
              <TabsTrigger value="save" className="text-slate-400 data-[state=active]:text-slate-800 data-[state=active]:bg-white">
                Save Project
              </TabsTrigger>
              <TabsTrigger value="load" className="text-slate-400 data-[state=active]:text-slate-800 data-[state=active]:bg-white">
                Load Project
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="save" className="space-y-4">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="project-name" className="text-slate-300">Project Name (Optional)</Label>
                  <Input
                    id="project-name"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    placeholder="Enter project name..."
                    className="bg-[var(--surface-light)] border-slate-600 text-white"
                  />
                </div>
                
                <div className="flex items-center justify-between pt-4">
                  <div className="text-sm text-slate-400">
                    {shapes.length} shapes, {groups.length} groups
                  </div>
                  <Button 
                    onClick={handleSaveProject}
                    disabled={isLoading}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    {isLoading ? (
                      <>
                        <Download className="w-4 h-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4 mr-2" />
                        Save Project
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </TabsContent>
            
            <TabsContent value="load" className="space-y-4">
              <div className="space-y-4">
                <div className="text-center py-8 border-2 border-dashed border-slate-600 rounded-lg">
                  <Upload className="w-12 h-12 mx-auto text-slate-400 mb-4" />
                  <div className="text-slate-300 mb-2">Load Project File</div>
                  <div className="text-xs text-slate-500 mb-4">
                    Select a JSON project file to load your shapes and settings
                  </div>
                  <Button 
                    onClick={triggerFileSelect}
                    disabled={isLoading}
                    variant="outline"
                    className="border-slate-600 text-slate-300 hover:bg-slate-700"
                  >
                    {isLoading ? (
                      <>
                        <Upload className="w-4 h-4 mr-2 animate-spin" />
                        Loading...
                      </>
                    ) : (
                      <>
                        <FolderOpen className="w-4 h-4 mr-2" />
                        Choose File
                      </>
                    )}
                  </Button>
                </div>
                
                <div className="text-xs text-amber-400">
                  ⚠ Loading a project will replace all current shapes and settings
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </>
  );
}

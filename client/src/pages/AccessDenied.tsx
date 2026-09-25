import { AlertTriangle, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function AccessDenied() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/20">
            <AlertTriangle className="h-8 w-8 text-red-600 dark:text-red-400" />
          </div>
          <CardTitle className="text-2xl text-red-600 dark:text-red-400">Access Denied</CardTitle>
          <CardDescription className="text-base">
            You don't have permission to access this application
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center space-y-4">
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Your account is not authorized to use Shape Editor Pro.
            </p>
            <p className="text-sm text-muted-foreground">
              Only pre-approved users can access this application.
            </p>
            <p className="text-sm text-muted-foreground">
              Please contact the administrator if you believe this is an error.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Button 
              onClick={() => window.location.href = '/api/logout'} 
              className="w-full"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Sign Out
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
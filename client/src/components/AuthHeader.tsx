import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LogOut, User, Settings } from "lucide-react";
import SidebarSettingsDialog, { type ApiTabProps } from "./SidebarSettingsDialog";

interface AuthHeaderProps {
  isCollapsed: boolean;
  apiTabProps?: ApiTabProps;
}

export default function AuthHeader({ isCollapsed, apiTabProps }: AuthHeaderProps) {
  const { user, isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-2">
        <div className="w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="p-2">
        {isCollapsed ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => window.location.href = '/api/login'}
            className="w-full h-8 p-0 text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            <User className="w-4 h-4" />
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.location.href = '/api/login'}
            className="w-full bg-slate-800 border-slate-600 text-slate-100 hover:bg-slate-700"
          >
            Sign In
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="p-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className={`relative hover:bg-slate-700 ${
              isCollapsed ? 'h-8 w-8 p-0 rounded-full' : 'w-full h-10 justify-start px-2'
            }`}
          >
            <Avatar className="h-6 w-6">
              <AvatarImage src={user?.profileImageUrl || undefined} />
              <AvatarFallback className="bg-slate-700 text-slate-100 text-xs">
                {user?.firstName?.[0] || user?.email?.[0] || <User className="w-3 h-3" />}
              </AvatarFallback>
            </Avatar>
            {!isCollapsed && (
              <div className="ml-2 text-left overflow-hidden">
                <div className="text-sm font-medium text-slate-100 truncate">
                  {user?.firstName && user?.lastName 
                    ? `${user.firstName} ${user.lastName}`
                    : user?.email || 'User'
                  }
                </div>
                <div className="text-xs text-slate-400 truncate">
                  {user?.email}
                </div>
              </div>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent 
          className="w-56 bg-slate-800 border-slate-700" 
          align={isCollapsed ? "start" : "end"} 
          side={isCollapsed ? "right" : "bottom"}
          forceMount
        >
          <DropdownMenuLabel className="font-normal text-slate-100">
            <div className="flex flex-col space-y-1">
              <p className="text-sm font-medium leading-none">
                {user?.firstName && user?.lastName 
                  ? `${user.firstName} ${user.lastName}`
                  : user?.email || 'User'
                }
              </p>
              <p className="text-xs leading-none text-slate-400">
                {user?.email}
              </p>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator className="bg-slate-700" />
          <DropdownMenuItem className="text-slate-100 hover:bg-slate-700">
            <User className="mr-2 h-4 w-4" />
            Profile
          </DropdownMenuItem>
          <SidebarSettingsDialog apiTabProps={apiTabProps}>
            <DropdownMenuItem 
              className="text-slate-100 hover:bg-slate-700"
              data-testid="menu-settings"
              onSelect={(e) => e.preventDefault()} // Prevent dropdown from closing
            >
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </DropdownMenuItem>
          </SidebarSettingsDialog>
          <DropdownMenuSeparator className="bg-slate-700" />
          <DropdownMenuItem 
            className="text-slate-100 hover:bg-slate-700"
            onClick={() => window.location.href = '/api/logout'}
          >
            <LogOut className="mr-2 h-4 w-4" />
            Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
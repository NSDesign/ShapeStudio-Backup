import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Palette, Shapes, Zap } from "lucide-react";

export default function Landing() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
      <div className="container mx-auto px-4 py-16">
        {/* Header */}
        <div className="text-center mb-16">
          <div className="flex justify-center mb-6">
            <div className="p-4 rounded-full bg-gradient-to-r from-blue-500 to-purple-600">
              <Shapes className="w-12 h-12 text-white" />
            </div>
          </div>
          <h1 className="text-5xl font-bold mb-4 bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
            Shape Editor Pro
          </h1>
          <p className="text-xl text-slate-300 max-w-2xl mx-auto mb-12">
            Create stunning geometric designs with advanced noise algorithms and procedural generation
          </p>
          
          {/* Call to Action - moved up */}
          <div className="bg-slate-800 rounded-lg p-8 max-w-md mx-auto">
            <h2 className="text-2xl font-bold mb-4 text-white">Get Started</h2>
            <p className="text-slate-300 mb-6">
              Sign in to access the full Shape Editor Pro experience
            </p>
            <Button 
              size="lg" 
              className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700"
              onClick={() => window.location.href = '/api/login'}
            >
              Sign In
            </Button>
          </div>
        </div>

        {/* Features */}
        <div className="grid md:grid-cols-3 gap-8 mb-16">
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader>
              <div className="w-12 h-12 rounded-lg bg-blue-500/10 flex items-center justify-center mb-4">
                <Palette className="w-6 h-6 text-blue-400" />
              </div>
              <CardTitle className="text-white">Advanced Canvas</CardTitle>
              <CardDescription className="text-slate-300">
                Infinite canvas with multi-touch support and real-time rendering
              </CardDescription>
            </CardHeader>
          </Card>

          <Card className="bg-slate-800 border-slate-700">
            <CardHeader>
              <div className="w-12 h-12 rounded-lg bg-purple-500/10 flex items-center justify-center mb-4">
                <Zap className="w-6 h-6 text-purple-400" />
              </div>
              <CardTitle className="text-white">Smart Generation</CardTitle>
              <CardDescription className="text-slate-300">
                7 unique noise algorithms for organic and procedural designs
              </CardDescription>
            </CardHeader>
          </Card>

          <Card className="bg-slate-800 border-slate-700">
            <CardHeader>
              <div className="w-12 h-12 rounded-lg bg-green-500/10 flex items-center justify-center mb-4">
                <Shapes className="w-6 h-6 text-green-400" />
              </div>
              <CardTitle className="text-white">Professional Tools</CardTitle>
              <CardDescription className="text-slate-300">
                Export to multiple formats with batch processing capabilities
              </CardDescription>
            </CardHeader>
          </Card>
        </div>


      </div>
    </div>
  );
}
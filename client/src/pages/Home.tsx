import ShapeEditor from "@/components/ShapeEditor";

export default function Home() {
  return (
    <div className="h-screen w-screen bg-slate-900 text-slate-50 overflow-hidden">
      {/* Main Shape Editor */}
      <ShapeEditor />
    </div>
  );
}
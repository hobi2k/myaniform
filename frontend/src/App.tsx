import { Route, Routes } from "react-router-dom";
import Layout from "./components/ui/Layout";
import EditStudioPage from "./pages/EditStudioPage";
import GenerationPage from "./pages/GenerationPage";
import ProjectEditorPage from "./pages/ProjectEditorPage";
import ProjectListPage from "./pages/ProjectListPage";
import WorkflowViewerPage from "./pages/WorkflowViewerPage";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<ProjectListPage />} />
        <Route path="/projects/:projectId" element={<ProjectEditorPage />} />
        <Route path="/projects/:projectId/edit-studio" element={<EditStudioPage />} />
        <Route path="/projects/:projectId/generate" element={<GenerationPage />} />
      </Route>
      {/* 워크플로우 뷰어: Layout 바깥 — iframe 전체 화면 */}
      <Route path="/workflows" element={<WorkflowViewerPage />} />
    </Routes>
  );
}

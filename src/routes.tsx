import { Navigate, type RouteObject } from "react-router-dom";
import { CreatePage } from "./features/templates/create/CreatePage";
import { PreviewPage } from "./features/templates/preview/PreviewPage";
import { PublishPage } from "./features/templates/publish/PublishPage";

export const routes: RouteObject[] = [
  { path: "/", element: <Navigate to="/create" replace /> },
  { path: "/create", element: <CreatePage /> },
  {
    path: "/:templateKey/:version/preview",
    element: <PreviewPage />,
  },
  {
    path: "/:templateKey/:version/publish",
    element: <PublishPage />,
  },
];

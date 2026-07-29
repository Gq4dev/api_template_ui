import { type RouteObject } from "react-router-dom";
import { ListPage } from "./features/templates/list/ListPage";
import { CreatePage } from "./features/templates/create/CreatePage";
import { EditDraftPage } from "./features/templates/edit/EditDraftPage";

export const routes: RouteObject[] = [
  { path: "/", element: <ListPage /> },
  { path: "/create", element: <CreatePage /> },
  // Only drafts are editable; the page enforces that itself rather than trusting
  // that the only way in was the list's Edit button.
  {
    path: "/templates/:templateKey/versions/:version/edit",
    element: <EditDraftPage />,
  },
];

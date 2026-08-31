import { type RouteObject } from "react-router-dom";
import { BrowsePage } from "./features/templates/browse/BrowsePage";
import { ListPage } from "./features/templates/list/ListPage";
import { CreatePage } from "./features/templates/create/CreatePage";
import { EditDraftPage } from "./features/templates/edit/EditDraftPage";

export const routes: RouteObject[] = [
  { path: "/", element: <BrowsePage /> },
  // The filter-and-scan table the browse view replaced. Kept reachable while it
  // is still the only place with status filtering and paging; delete it once
  // nothing is missing from the browse view.
  { path: "/list", element: <ListPage /> },
  { path: "/create", element: <CreatePage /> },
  // Only drafts are editable; the page enforces that itself rather than trusting
  // that the only way in was the list's Edit button.
  {
    path: "/templates/:templateKey/versions/:version/edit",
    element: <EditDraftPage />,
  },
];

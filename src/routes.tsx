import { type RouteObject } from "react-router-dom";
import { ListPage } from "./features/templates/list/ListPage";
import { CreatePage } from "./features/templates/create/CreatePage";

export const routes: RouteObject[] = [
  { path: "/", element: <ListPage /> },
  { path: "/create", element: <CreatePage /> },
];

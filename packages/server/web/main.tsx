import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { api, queryClient, type User } from "./api";
import { Layout } from "./components/Layout";
import { Spinner } from "./components/ui";
import { AccessPage } from "./pages/AccessPage";
import { ActivityPage } from "./pages/ActivityPage";
import { GroupDetailPage } from "./pages/GroupDetailPage";
import { GroupsPage } from "./pages/GroupsPage";
import { LoginPage } from "./pages/LoginPage";
import { OverviewPage } from "./pages/OverviewPage";
import { TokensPage } from "./pages/TokensPage";
import { MembersPage } from "./pages/MembersPage";
import "./app.css";

function App() {
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () =>
      api<{ user: User }>("/api/me")
        .then((r) => r.user)
        .catch((error) => {
          if (error.status === 401) return null;
          throw error;
        }),
  });

  if (me.isPending) {
    return (
      <div className="grid min-h-dvh place-items-center text-neutral-400">
        <Spinner className="size-5" />
      </div>
    );
  }

  if (!me.data) {
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<Layout user={me.data} />}>
        <Route index element={<OverviewPage />} />
        <Route path="groups" element={<GroupsPage />} />
        <Route path="groups/:groupId" element={<GroupDetailPage />} />
        <Route path="activity" element={<ActivityPage />} />
        <Route path="access" element={<AccessPage />} />
        <Route path="tokens" element={<TokensPage />} />
        <Route path="members" element={<MembersPage />} />
        <Route path="login" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

const app = (
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);

const elem = document.getElementById("root")!;
if (import.meta.hot) {
  // HMR keeps one React root across reloads; Bun requires this direct form.
  const root = (import.meta.hot.data.root ??= createRoot(elem));
  root.render(app);
} else {
  createRoot(elem).render(app);
}

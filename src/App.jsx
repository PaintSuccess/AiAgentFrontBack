import React, { useState } from "react";
import { Page, Layout, Frame, Navigation } from "@shopify/polaris";
import DashboardPage from "./pages/DashboardPage";
import ConversationPage from "./pages/ConversationPage";
import KnowledgeBasePage from "./pages/KnowledgeBasePage";

export default function App() {
  const [view, setView] = useState({ page: "dashboard", id: null });

  const navigation = (
    <Navigation location={view.page}>
      <Navigation.Section
        items={[
          {
            label: "Communications",
            onClick: () => setView({ page: "dashboard", id: null }),
            selected: view.page === "dashboard" || view.page === "conversation",
          },
          {
            label: "Knowledge Base",
            onClick: () => setView({ page: "knowledge-base", id: null }),
            selected: view.page === "knowledge-base",
          },
        ]}
      />
    </Navigation>
  );

  return (
    <Frame navigation={navigation}>
      {view.page === "dashboard" && (
        <DashboardPage
          onViewConversation={(id) => setView({ page: "conversation", id })}
        />
      )}
      {view.page === "conversation" && (
        <ConversationPage
          id={view.id}
          onBack={() => setView({ page: "dashboard", id: null })}
        />
      )}
      {view.page === "knowledge-base" && (
        <KnowledgeBasePage
          onBack={() => setView({ page: "dashboard", id: null })}
        />
      )}
    </Frame>
  );
}

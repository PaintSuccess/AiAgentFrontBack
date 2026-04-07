import React, { useState } from "react";
import { Page, Layout, Frame } from "@shopify/polaris";
import DashboardPage from "./pages/DashboardPage";
import ConversationPage from "./pages/ConversationPage";

export default function App() {
  const [view, setView] = useState({ page: "dashboard", id: null });

  return (
    <Frame>
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
    </Frame>
  );
}

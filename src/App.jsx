import React, { useState } from "react";
import { Frame, Navigation } from "@shopify/polaris";
import InboxPage from "./pages/InboxPage";
import KnowledgeBasePage from "./pages/KnowledgeBasePage";

export default function App() {
  const [view, setView] = useState({ page: "inbox" });

  const navigation = (
    <Navigation location={view.page}>
      <Navigation.Section
        items={[
          {
            label: "Inbox",
            onClick: () => setView({ page: "inbox" }),
            selected: view.page === "inbox",
          },
          {
            label: "Knowledge Base",
            onClick: () => setView({ page: "knowledge-base" }),
            selected: view.page === "knowledge-base",
          },
        ]}
      />
    </Navigation>
  );

  return (
    <Frame navigation={navigation}>
      {view.page === "inbox" && <InboxPage />}
      {view.page === "knowledge-base" && (
        <KnowledgeBasePage onBack={() => setView({ page: "inbox" })} />
      )}
    </Frame>
  );
}

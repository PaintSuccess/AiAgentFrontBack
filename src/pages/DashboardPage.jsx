import React, { useState, useEffect, useCallback } from "react";
import {
  Page,
  Layout,
  Card,
  IndexTable,
  Badge,
  Text,
  Filters,
  ChoiceList,
  TextField,
  Button,
  Spinner,
  Banner,
  InlineStack,
  BlockStack,
  Box,
  Pagination,
} from "@shopify/polaris";
import { dashboardFetch } from "../utils/fetch";

const TYPE_BADGE = {
  chat: { tone: "info", label: "Chat" },
  call: { tone: "attention", label: "Call" },
  sms: { tone: "success", label: "SMS" },
  whatsapp: { tone: "success", label: "WhatsApp" },
  email: { tone: "warning", label: "Email" },
};

export default function DashboardPage({ onViewConversation }) {
  const [conversations, setConversations] = useState([]);
  const [emails, setEmails] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [cursorHistory, setCursorHistory] = useState([]);

  // Filters
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState([]);
  const [successFilter, setSuccessFilter] = useState([]);

  const fetchData = useCallback(
    async (paginationCursor = null) => {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        params.set("page_size", "25");
        if (paginationCursor) params.set("cursor", paginationCursor);
        if (search) params.set("search", search);
        if (successFilter.length === 1) {
          params.set("call_successful", successFilter[0]);
        }

        const [convData, emailData] = await Promise.all([
          dashboardFetch(`/api/dashboard/conversations?${params}`),
          !paginationCursor
            ? dashboardFetch("/api/dashboard/emails?limit=50")
            : Promise.resolve(null),
        ]);

        setConversations(convData.items || []);
        setCursor(convData.cursor);
        setHasMore(convData.has_more);

        if (emailData) {
          setEmails(emailData.items || []);
        }
      } catch (err) {
        console.error("Failed to fetch dashboard data:", err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    },
    [search, successFilter]
  );

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Merge conversations + emails into unified timeline
  const allItems = mergeAndSort(conversations, emails, typeFilter);

  const handleNextPage = () => {
    if (cursor) {
      setCursorHistory((prev) => [...prev, cursor]);
      fetchData(cursor);
    }
  };

  const handlePrevPage = () => {
    const prev = [...cursorHistory];
    prev.pop();
    setCursorHistory(prev);
    fetchData(prev[prev.length - 1] || null);
  };

  const handleSearchChange = (value) => setSearch(value);
  const handleSearchClear = () => {
    setSearch("");
    setCursorHistory([]);
  };

  const handleFiltersClearAll = () => {
    setSearch("");
    setTypeFilter([]);
    setSuccessFilter([]);
    setCursorHistory([]);
  };

  const filters = [
    {
      key: "type",
      label: "Channel",
      filter: (
        <ChoiceList
          title="Channel"
          titleHidden
          choices={[
            { label: "Chat", value: "chat" },
            { label: "Call", value: "call" },
            { label: "SMS", value: "sms" },
            { label: "WhatsApp", value: "whatsapp" },
            { label: "Email", value: "email" },
          ]}
          selected={typeFilter}
          onChange={setTypeFilter}
          allowMultiple
        />
      ),
      shortcut: true,
    },
    {
      key: "success",
      label: "Result",
      filter: (
        <ChoiceList
          title="Result"
          titleHidden
          choices={[
            { label: "Successful", value: "true" },
            { label: "Failed", value: "false" },
          ]}
          selected={successFilter}
          onChange={setSuccessFilter}
        />
      ),
      shortcut: true,
    },
  ];

  const appliedFilters = [];
  if (typeFilter.length > 0) {
    appliedFilters.push({
      key: "type",
      label: `Channel: ${typeFilter.join(", ")}`,
      onRemove: () => setTypeFilter([]),
    });
  }
  if (successFilter.length > 0) {
    appliedFilters.push({
      key: "success",
      label: `Result: ${successFilter[0] === "true" ? "Successful" : "Failed"}`,
      onRemove: () => setSuccessFilter([]),
    });
  }

  const resourceName = { singular: "communication", plural: "communications" };

  const rowMarkup = allItems.map((item, index) => {
    const badge = TYPE_BADGE[item.type] || TYPE_BADGE.chat;
    const isConversation = item.type !== "email";

    return (
      <IndexTable.Row
        id={item.id}
        key={item.id}
        position={index}
        onClick={isConversation ? () => onViewConversation(item.id) : undefined}
      >
        <IndexTable.Cell>
          <Text variant="bodyMd" as="span">
            {formatDate(item.started_at)}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Badge tone={badge.tone}>{badge.label}</Badge>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text variant="bodyMd" fontWeight="semibold" as="span">
            {item.customer_name || item.customer_email || item.to || "Unknown"}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text variant="bodyMd" as="span" truncate>
            {item.summary || item.subject || "—"}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          {item.call_successful === "success" ? (
            <Badge tone="success">Success</Badge>
          ) : item.call_successful === "failure" ? (
            <Badge tone="critical">Failed</Badge>
          ) : item.status ? (
            <Badge>{item.status}</Badge>
          ) : (
            <Text as="span">—</Text>
          )}
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text variant="bodyMd" as="span">
            {item.duration_seconds ? formatDuration(item.duration_seconds) : "—"}
          </Text>
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  return (
    <Page title="Communications Hub" subtitle="All AI conversations, calls, SMS, and emails">
      <Layout>
        <Layout.Section>
          {error && (
            <Box paddingBlockEnd="400">
              <Banner tone="critical" onDismiss={() => setError(null)}>
                {error}
              </Banner>
            </Box>
          )}

          <Card padding="0">
            <IndexTable
              resourceName={resourceName}
              itemCount={allItems.length}
              headings={[
                { title: "Date" },
                { title: "Channel" },
                { title: "Customer" },
                { title: "Summary" },
                { title: "Result" },
                { title: "Duration" },
              ]}
              selectable={false}
              loading={loading}
              filterControl={
                <Filters
                  queryValue={search}
                  queryPlaceholder="Search conversations..."
                  onQueryChange={handleSearchChange}
                  onQueryClear={handleSearchClear}
                  onClearAll={handleFiltersClearAll}
                  filters={filters}
                  appliedFilters={appliedFilters}
                />
              }
            >
              {rowMarkup}
            </IndexTable>

            {!loading && allItems.length === 0 && (
              <Box padding="400">
                <Text as="p" alignment="center" tone="subdued">
                  No communications found
                </Text>
              </Box>
            )}

            <Box padding="400">
              <InlineStack align="center">
                <Pagination
                  hasPrevious={cursorHistory.length > 0}
                  onPrevious={handlePrevPage}
                  hasNext={hasMore}
                  onNext={handleNextPage}
                />
              </InlineStack>
            </Box>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

function mergeAndSort(conversations, emails, typeFilter) {
  let all = [
    ...conversations.map((c) => ({ ...c, _time: new Date(c.started_at).getTime() })),
    ...emails.map((e) => ({ ...e, _time: new Date(e.started_at).getTime() })),
  ];

  // Apply client-side type filter
  if (typeFilter.length > 0) {
    all = all.filter((item) => typeFilter.includes(item.type));
  }

  // Sort newest first
  all.sort((a, b) => b._time - a._time);
  return all;
}

function formatDate(isoString) {
  if (!isoString) return "—";
  const d = new Date(isoString);
  return d.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(seconds) {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

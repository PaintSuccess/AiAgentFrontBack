import React, { useState, useEffect } from "react";
import {
  Page,
  Layout,
  Card,
  Text,
  Badge,
  BlockStack,
  InlineStack,
  Box,
  Divider,
  Banner,
  Spinner,
  DescriptionList,
} from "@shopify/polaris";
import { dashboardFetch } from "../utils/fetch";

export default function ConversationPage({ id, onBack }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const conv = await dashboardFetch(`/api/dashboard/conversation?id=${id}`);
        setData(conv);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  if (loading) {
    return (
      <Page title="Conversation" backAction={{ onAction: onBack }}>
        <Layout>
          <Layout.Section>
            <Card>
              <Box padding="400">
                <InlineStack align="center">
                  <Spinner size="large" />
                </InlineStack>
              </Box>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  if (error) {
    return (
      <Page title="Conversation" backAction={{ onAction: onBack }}>
        <Layout>
          <Layout.Section>
            <Banner tone="critical">{error}</Banner>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  if (!data) return null;

  const TYPE_LABEL = { chat: "Chat", call: "Call", sms: "SMS", whatsapp: "WhatsApp" };
  const TYPE_TONE = { chat: "info", call: "attention", sms: "success", whatsapp: "success" };

  return (
    <Page
      title={data.title || `Conversation ${id}`}
      subtitle={data.customer_name || data.customer_email || "Unknown customer"}
      backAction={{ onAction: onBack }}
    >
      <Layout>
        {/* Metadata */}
        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text variant="headingSm" as="h3">Details</Text>
              <DescriptionList
                items={[
                  {
                    term: "Channel",
                    description: (
                      <Badge tone={TYPE_TONE[data.type] || "info"}>
                        {TYPE_LABEL[data.type] || data.type}
                      </Badge>
                    ),
                  },
                  {
                    term: "Result",
                    description:
                      data.call_successful === "success" ? (
                        <Badge tone="success">Success</Badge>
                      ) : data.call_successful === "failure" ? (
                        <Badge tone="critical">Failed</Badge>
                      ) : (
                        <Text as="span">—</Text>
                      ),
                  },
                  {
                    term: "Customer",
                    description: data.customer_name || "—",
                  },
                  {
                    term: "Email",
                    description: data.customer_email || "—",
                  },
                  {
                    term: "Date",
                    description: data.started_at
                      ? new Date(data.started_at).toLocaleString("en-AU")
                      : "—",
                  },
                  {
                    term: "Duration",
                    description: data.duration_seconds
                      ? `${Math.floor(data.duration_seconds / 60)}m ${data.duration_seconds % 60}s`
                      : "—",
                  },
                  {
                    term: "Ended",
                    description: data.termination_reason || "—",
                  },
                ]}
              />
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* AI Summary */}
        {data.summary && (
          <Layout.Section>
            <Card>
              <BlockStack gap="200">
                <Text variant="headingSm" as="h3">AI Summary</Text>
                <Text as="p">{data.summary}</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* Transcript */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text variant="headingSm" as="h3">
                Transcript ({data.transcript?.length || 0} messages)
              </Text>
              <Divider />
              {(data.transcript || []).map((entry, i) => (
                <Box
                  key={i}
                  padding="300"
                  background={entry.role === "agent" ? "bg-surface-secondary" : "bg-surface"}
                  borderRadius="200"
                >
                  <BlockStack gap="100">
                    <InlineStack gap="200" align="space-between">
                      <Text variant="bodySm" fontWeight="bold" as="span">
                        {entry.role === "agent" ? "AI Agent" : "Customer"}
                      </Text>
                      {entry.timestamp != null && (
                        <Text variant="bodySm" tone="subdued" as="span">
                          {Math.floor(entry.timestamp / 60)}:{String(Math.floor(entry.timestamp % 60)).padStart(2, "0")}
                        </Text>
                      )}
                    </InlineStack>
                    <Text as="p">{entry.message}</Text>
                  </BlockStack>
                </Box>
              ))}
              {(!data.transcript || data.transcript.length === 0) && (
                <Text as="p" tone="subdued">No transcript available</Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

import React, { useState, useEffect, useCallback } from "react";
import {
  Page,
  Layout,
  Card,
  IndexTable,
  Text,
  Button,
  Spinner,
  Banner,
  Modal,
  TextField,
  Select,
  InlineStack,
  BlockStack,
  Box,
  Badge,
  EmptyState,
} from "@shopify/polaris";
import { dashboardFetch } from "../utils/fetch";

const MODE_OPTIONS = [
  { label: "Always loaded (prompt)", value: "prompt" },
  { label: "Retrieved when relevant (auto/RAG)", value: "auto" },
];

export default function KnowledgeBasePage({ onBack }) {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingDoc, setEditingDoc] = useState(null); // null = creating new
  const [formName, setFormName] = useState("");
  const [formContent, setFormContent] = useState("");
  const [formMode, setFormMode] = useState("auto");

  // Delete confirmation
  const [deleteDoc, setDeleteDoc] = useState(null);

  const fetchDocs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await dashboardFetch("/api/dashboard/knowledge-base");
      setDocs(data.items || []);
    } catch (err) {
      console.error("Failed to fetch KB:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  const openCreate = () => {
    setEditingDoc(null);
    setFormName("");
    setFormContent("");
    setFormMode("auto");
    setModalOpen(true);
  };

  const openEdit = (doc) => {
    setEditingDoc(doc);
    setFormName(doc.name);
    setFormContent(doc.content || "");
    setFormMode(doc.usage_mode || "auto");
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!formName.trim() || !formContent.trim()) return;

    setSaving(true);
    setError(null);
    try {
      if (editingDoc) {
        // Update existing
        await dashboardFetch(`/api/dashboard/knowledge-base?id=${editingDoc.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            name: formName.trim(),
            content: formContent.trim(),
            usage_mode: formMode,
          }),
        });
      } else {
        // Create new
        await dashboardFetch("/api/dashboard/knowledge-base", {
          method: "POST",
          body: JSON.stringify({
            name: formName.trim(),
            content: formContent.trim(),
            usage_mode: formMode,
          }),
        });
      }
      setModalOpen(false);
      await fetchDocs();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteDoc) return;
    setSaving(true);
    setError(null);
    try {
      await dashboardFetch(`/api/dashboard/knowledge-base?id=${deleteDoc.id}`, {
        method: "DELETE",
      });
      setDeleteDoc(null);
      await fetchDocs();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const resourceName = { singular: "document", plural: "documents" };

  const rowMarkup = docs.map((doc, index) => (
    <IndexTable.Row id={doc.id} key={doc.id} position={index} onClick={() => openEdit(doc)}>
      <IndexTable.Cell>
        <Text variant="bodyMd" fontWeight="semibold" as="span">
          {doc.name}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone={doc.usage_mode === "prompt" ? "info" : "success"}>
          {doc.usage_mode === "prompt" ? "Always loaded" : "RAG (auto)"}
        </Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text variant="bodyMd" as="span" tone="subdued">
          {doc.content ? `${doc.content.length.toLocaleString()} chars` : "—"}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Button
          variant="plain"
          tone="critical"
          onClick={(e) => {
            e.stopPropagation();
            setDeleteDoc(doc);
          }}
        >
          Delete
        </Button>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page
      title="Knowledge Base"
      subtitle="Manage AI chatbot knowledge documents"
      backAction={{ content: "Dashboard", onAction: onBack }}
      primaryAction={{ content: "Add Document", onAction: openCreate }}
    >
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
              itemCount={docs.length}
              headings={[
                { title: "Document Name" },
                { title: "Mode" },
                { title: "Size" },
                { title: "Actions" },
              ]}
              selectable={false}
              loading={loading}
            >
              {rowMarkup}
            </IndexTable>

            {!loading && docs.length === 0 && (
              <Box padding="800">
                <EmptyState
                  heading="No knowledge documents yet"
                  image=""
                >
                  <p>Add documents to teach the AI chatbot about your products, policies, and FAQs.</p>
                </EmptyState>
              </Box>
            )}
          </Card>

          <Box paddingBlockStart="400">
            <Card>
              <BlockStack gap="200">
                <Text variant="headingSm" as="h3">How it works</Text>
                <Text as="p" tone="subdued">
                  <strong>Always loaded</strong> — Content is included in every conversation. Best for rules, company info, and critical policies (keeps content small).
                </Text>
                <Text as="p" tone="subdued">
                  <strong>RAG (auto)</strong> — Content is retrieved only when relevant to the customer's question. Best for large product catalogs, guides, and FAQs.
                </Text>
              </BlockStack>
            </Card>
          </Box>
        </Layout.Section>
      </Layout>

      {/* Create/Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingDoc ? `Edit: ${editingDoc.name}` : "Add Knowledge Document"}
        primaryAction={{
          content: editingDoc ? "Save Changes" : "Create Document",
          onAction: handleSave,
          loading: saving,
          disabled: !formName.trim() || !formContent.trim(),
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setModalOpen(false) }]}
        large
      >
        <Modal.Section>
          <BlockStack gap="400">
            <TextField
              label="Document Name"
              value={formName}
              onChange={setFormName}
              placeholder="e.g. Product Information, FAQ, Shipping Policy"
              autoComplete="off"
            />
            <Select
              label="Usage Mode"
              options={MODE_OPTIONS}
              value={formMode}
              onChange={setFormMode}
              helpText={
                formMode === "prompt"
                  ? "Content will be loaded into every conversation. Keep it concise (under 5000 chars)."
                  : "Content will be retrieved via RAG when relevant. Can be much larger."
              }
            />
            <TextField
              label="Content"
              value={formContent}
              onChange={setFormContent}
              multiline={15}
              placeholder="Enter the knowledge content here. Use plain text or markdown formatting."
              autoComplete="off"
              helpText={`${formContent.length.toLocaleString()} characters`}
            />
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        open={!!deleteDoc}
        onClose={() => setDeleteDoc(null)}
        title="Delete Document"
        primaryAction={{
          content: "Delete",
          destructive: true,
          onAction: handleDelete,
          loading: saving,
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setDeleteDoc(null) }]}
      >
        <Modal.Section>
          <Text as="p">
            Are you sure you want to delete <strong>{deleteDoc?.name}</strong>? This will remove it from the AI chatbot's knowledge base permanently.
          </Text>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
